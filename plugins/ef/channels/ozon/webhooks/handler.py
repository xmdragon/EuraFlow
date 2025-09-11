"""
Ozon Webhook 处理器
处理来自 Ozon 的 Webhook 回调
"""
import json
import hashlib
import hmac
from datetime import datetime
from typing import Dict, Any, Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_session
from ef_core.utils.logging import get_logger

from ..models.sync import OzonWebhookEvent
from ..services.order_sync import OrderSyncService
from ..services.product_sync import ProductSyncService

logger = get_logger(__name__)


class OzonWebhookHandler:
    """Ozon Webhook 处理器"""
    
    # 支持的事件类型
    SUPPORTED_EVENTS = {
        "posting.status_changed",
        "posting.cancelled", 
        "posting.delivered",
        "product.price_changed",
        "product.stock_changed",
        "return.created",
        "return.status_changed"
    }
    
    def __init__(self, shop_id: int, webhook_secret: str):
        """
        初始化 Webhook 处理器
        
        Args:
            shop_id: 店铺ID
            webhook_secret: Webhook 密钥
        """
        self.shop_id = shop_id
        self.webhook_secret = webhook_secret
    
    async def handle_webhook(
        self,
        event_type: str,
        payload: Dict[str, Any],
        headers: Dict[str, str],
        raw_body: bytes
    ) -> Dict[str, Any]:
        """
        处理 Webhook 请求
        
        Args:
            event_type: 事件类型
            payload: 事件载荷
            headers: 请求头
            raw_body: 原始请求体
            
        Returns:
            处理结果
        """
        # 验证签名
        signature = headers.get("X-Ozon-Signature", "")
        if not self._verify_signature(raw_body, signature):
            logger.warning(f"Invalid webhook signature for shop {self.shop_id}")
            return {"success": False, "error": "Invalid signature"}
        
        # 检查幂等性
        event_id = headers.get("X-Event-Id", f"{event_type}-{datetime.utcnow().timestamp()}")
        idempotency_key = f"{self.shop_id}-{event_id}"
        
        async with get_session() as session:
            # 检查是否已处理
            stmt = select(OzonWebhookEvent).where(
                OzonWebhookEvent.idempotency_key == idempotency_key
            )
            existing_event = await session.scalar(stmt)
            
            if existing_event:
                logger.info(f"Duplicate webhook event: {idempotency_key}")
                return {
                    "success": True,
                    "message": "Event already processed",
                    "event_id": existing_event.event_id
                }
            
            # 创建事件记录
            webhook_event = OzonWebhookEvent(
                event_id=event_id,
                event_type=event_type,
                shop_id=self.shop_id,
                payload=payload,
                headers=dict(headers),
                signature=signature,
                is_verified=True,
                status="processing",
                idempotency_key=idempotency_key
            )
            session.add(webhook_event)
            await session.commit()
        
        # 异步处理事件
        try:
            result = await self._process_event(event_type, payload, webhook_event)
            
            # 更新事件状态
            async with get_session() as session:
                webhook_event.status = "processed"
                webhook_event.processed_at = datetime.utcnow()
                session.add(webhook_event)
                await session.commit()
            
            return {
                "success": True,
                "event_id": event_id,
                "result": result
            }
            
        except Exception as e:
            logger.error(f"Failed to process webhook event {event_id}: {e}")
            
            # 更新事件为失败状态
            async with get_session() as session:
                webhook_event.status = "failed"
                webhook_event.error_message = str(e)
                webhook_event.retry_count += 1
                session.add(webhook_event)
                await session.commit()
            
            return {
                "success": False,
                "event_id": event_id,
                "error": str(e)
            }
    
    async def _process_event(
        self,
        event_type: str,
        payload: Dict[str, Any],
        webhook_event: OzonWebhookEvent
    ) -> Dict[str, Any]:
        """
        处理具体事件
        
        Args:
            event_type: 事件类型
            payload: 事件载荷
            webhook_event: Webhook事件记录
            
        Returns:
            处理结果
        """
        # 根据事件类型分发处理
        handlers = {
            "posting.status_changed": self._handle_posting_status_changed,
            "posting.cancelled": self._handle_posting_cancelled,
            "posting.delivered": self._handle_posting_delivered,
            "product.price_changed": self._handle_product_price_changed,
            "product.stock_changed": self._handle_product_stock_changed,
            "return.created": self._handle_return_created,
            "return.status_changed": self._handle_return_status_changed
        }
        
        handler = handlers.get(event_type)
        if not handler:
            logger.warning(f"Unsupported webhook event type: {event_type}")
            webhook_event.status = "ignored"
            return {"message": "Event type not supported"}
        
        return await handler(payload, webhook_event)
    
    async def _handle_posting_status_changed(
        self,
        payload: Dict[str, Any],
        webhook_event: OzonWebhookEvent
    ) -> Dict[str, Any]:
        """处理发货单状态变更"""
        posting_number = payload.get("posting_number")
        new_status = payload.get("status")
        
        logger.info(f"Posting {posting_number} status changed to {new_status}")
        
        # 更新本地状态
        from ..models.orders import OzonPosting
        
        async with get_session() as session:
            stmt = select(OzonPosting).where(
                and_(
                    OzonPosting.shop_id == self.shop_id,
                    OzonPosting.posting_number == posting_number
                )
            )
            posting = await session.scalar(stmt)
            
            if posting:
                posting.status = new_status
                posting.updated_at = datetime.utcnow()
                
                # 根据状态更新时间
                if new_status == "delivered":
                    posting.delivered_at = datetime.utcnow()
                elif new_status == "cancelled":
                    posting.cancelled_at = datetime.utcnow()
                
                session.add(posting)
                await session.commit()
                
                # 更新Webhook事件关联
                webhook_event.entity_type = "posting"
                webhook_event.entity_id = str(posting.id)
                
                return {"posting_id": posting.id, "status": new_status}
            else:
                # Posting不存在，触发同步
                logger.warning(f"Posting {posting_number} not found, triggering sync")
                # TODO: 触发订单同步任务
                return {"message": "Posting not found, sync triggered"}
    
    async def _handle_posting_cancelled(
        self,
        payload: Dict[str, Any],
        webhook_event: OzonWebhookEvent
    ) -> Dict[str, Any]:
        """处理发货单取消"""
        posting_number = payload.get("posting_number")
        cancel_reason = payload.get("cancel_reason")
        
        logger.info(f"Posting {posting_number} cancelled: {cancel_reason}")
        
        from ..models.orders import OzonPosting
        
        async with get_session() as session:
            stmt = select(OzonPosting).where(
                and_(
                    OzonPosting.shop_id == self.shop_id,
                    OzonPosting.posting_number == posting_number
                )
            )
            posting = await session.scalar(stmt)
            
            if posting:
                posting.status = "cancelled"
                posting.is_cancelled = True
                posting.cancel_reason = cancel_reason.get("reason")
                posting.cancel_reason_id = cancel_reason.get("reason_id")
                posting.cancelled_at = datetime.utcnow()
                
                session.add(posting)
                await session.commit()
                
                webhook_event.entity_type = "posting"
                webhook_event.entity_id = str(posting.id)
                
                return {"posting_id": posting.id, "cancelled": True}
            
            return {"message": "Posting not found"}
    
    async def _handle_posting_delivered(
        self,
        payload: Dict[str, Any],
        webhook_event: OzonWebhookEvent
    ) -> Dict[str, Any]:
        """处理发货单妥投"""
        posting_number = payload.get("posting_number")
        delivered_at = payload.get("delivered_at")
        
        logger.info(f"Posting {posting_number} delivered at {delivered_at}")
        
        from ..models.orders import OzonPosting, OzonOrder
        
        async with get_session() as session:
            stmt = select(OzonPosting).where(
                and_(
                    OzonPosting.shop_id == self.shop_id,
                    OzonPosting.posting_number == posting_number
                )
            )
            posting = await session.scalar(stmt)
            
            if posting:
                posting.status = "delivered"
                posting.delivered_at = datetime.fromisoformat(delivered_at.replace("Z", "+00:00"))
                
                # 更新订单状态
                order = await session.get(OzonOrder, posting.order_id)
                if order:
                    order.status = "delivered"
                    order.delivered_at = posting.delivered_at
                    session.add(order)
                
                session.add(posting)
                await session.commit()
                
                webhook_event.entity_type = "posting"
                webhook_event.entity_id = str(posting.id)
                
                return {"posting_id": posting.id, "delivered": True}
            
            return {"message": "Posting not found"}
    
    async def _handle_product_price_changed(
        self,
        payload: Dict[str, Any],
        webhook_event: OzonWebhookEvent
    ) -> Dict[str, Any]:
        """处理商品价格变更"""
        product_id = payload.get("product_id")
        old_price = payload.get("old_price")
        new_price = payload.get("new_price")
        
        logger.info(f"Product {product_id} price changed: {old_price} -> {new_price}")
        
        from ..models.products import OzonProduct, OzonPriceHistory
        from decimal import Decimal
        
        async with get_session() as session:
            stmt = select(OzonProduct).where(
                and_(
                    OzonProduct.shop_id == self.shop_id,
                    OzonProduct.ozon_product_id == product_id
                )
            )
            product = await session.scalar(stmt)
            
            if product:
                # 记录价格历史
                price_history = OzonPriceHistory(
                    product_id=product.id,
                    shop_id=self.shop_id,
                    price_before=Decimal(str(old_price)),
                    price_after=Decimal(str(new_price)),
                    change_reason="ozon_platform",
                    changed_by="ozon",
                    source="webhook"
                )
                session.add(price_history)
                
                # 更新商品价格
                product.price = Decimal(str(new_price))
                session.add(product)
                
                await session.commit()
                
                webhook_event.entity_type = "product"
                webhook_event.entity_id = str(product.id)
                
                return {"product_id": product.id, "price_updated": True}
            
            return {"message": "Product not found"}
    
    async def _handle_product_stock_changed(
        self,
        payload: Dict[str, Any],
        webhook_event: OzonWebhookEvent
    ) -> Dict[str, Any]:
        """处理商品库存变更"""
        product_id = payload.get("product_id")
        warehouse_id = payload.get("warehouse_id")
        old_stock = payload.get("old_stock")
        new_stock = payload.get("new_stock")
        
        logger.info(f"Product {product_id} stock changed: {old_stock} -> {new_stock}")
        
        from ..models.products import OzonProduct
        
        async with get_session() as session:
            stmt = select(OzonProduct).where(
                and_(
                    OzonProduct.shop_id == self.shop_id,
                    OzonProduct.ozon_product_id == product_id
                )
            )
            product = await session.scalar(stmt)
            
            if product:
                product.stock = new_stock
                product.available = new_stock - product.reserved
                session.add(product)
                await session.commit()
                
                webhook_event.entity_type = "product"
                webhook_event.entity_id = str(product.id)
                
                return {"product_id": product.id, "stock_updated": True}
            
            return {"message": "Product not found"}
    
    async def _handle_return_created(
        self,
        payload: Dict[str, Any],
        webhook_event: OzonWebhookEvent
    ) -> Dict[str, Any]:
        """处理退货创建"""
        return_id = payload.get("return_id")
        posting_number = payload.get("posting_number")
        
        logger.info(f"Return {return_id} created for posting {posting_number}")
        
        from ..models.orders import OzonRefund, OzonPosting
        
        async with get_session() as session:
            # 查找Posting
            stmt = select(OzonPosting).where(
                and_(
                    OzonPosting.shop_id == self.shop_id,
                    OzonPosting.posting_number == posting_number
                )
            )
            posting = await session.scalar(stmt)
            
            if posting:
                # 创建退款记录
                refund = OzonRefund(
                    order_id=posting.order_id,
                    shop_id=self.shop_id,
                    refund_id=str(return_id),
                    refund_type="return",
                    posting_id=posting.id,
                    refund_amount=Decimal(str(payload.get("amount", "0"))),
                    reason=payload.get("reason"),
                    status="pending",
                    requested_at=datetime.utcnow()
                )
                session.add(refund)
                await session.commit()
                
                webhook_event.entity_type = "refund"
                webhook_event.entity_id = str(refund.id)
                
                return {"refund_id": refund.id, "created": True}
            
            return {"message": "Posting not found"}
    
    async def _handle_return_status_changed(
        self,
        payload: Dict[str, Any],
        webhook_event: OzonWebhookEvent
    ) -> Dict[str, Any]:
        """处理退货状态变更"""
        return_id = payload.get("return_id")
        new_status = payload.get("status")
        
        logger.info(f"Return {return_id} status changed to {new_status}")
        
        from ..models.orders import OzonRefund
        
        async with get_session() as session:
            stmt = select(OzonRefund).where(
                and_(
                    OzonRefund.shop_id == self.shop_id,
                    OzonRefund.refund_id == str(return_id)
                )
            )
            refund = await session.scalar(stmt)
            
            if refund:
                refund.status = new_status
                
                if new_status == "approved":
                    refund.approved_at = datetime.utcnow()
                elif new_status == "completed":
                    refund.completed_at = datetime.utcnow()
                
                session.add(refund)
                await session.commit()
                
                webhook_event.entity_type = "refund"
                webhook_event.entity_id = str(refund.id)
                
                return {"refund_id": refund.id, "status": new_status}
            
            return {"message": "Return not found"}
    
    def _verify_signature(self, raw_body: bytes, signature: str) -> bool:
        """
        验证Webhook签名
        
        Args:
            raw_body: 原始请求体
            signature: 请求签名
            
        Returns:
            签名是否有效
        """
        expected_signature = hmac.new(
            self.webhook_secret.encode(),
            raw_body,
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(signature, expected_signature)