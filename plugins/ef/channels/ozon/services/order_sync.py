"""
订单同步服务
处理Ozon订单的拉取、状态同步、发货等
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
from decimal import Decimal

from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from ef_core.utils.logger import get_logger
from ef_core.utils.errors import ValidationError

from ..api.client import OzonAPIClient
from ..models.orders import (
    OzonOrder, OzonPosting, OzonOrderItem,
    OzonShipmentPackage, OzonRefund
)
from ..models.products import OzonProduct
from ..models.sync import OzonSyncCheckpoint, OzonSyncLog, OzonOutboxEvent

logger = get_logger(__name__)


class OrderSyncService:
    """订单同步服务"""
    
    # 订单状态映射
    STATUS_MAP = {
        "awaiting_approve": "pending",
        "awaiting_packaging": "confirmed",
        "awaiting_deliver": "processing",
        "delivering": "shipped",
        "delivered": "delivered",
        "cancelled": "cancelled",
        "not_accepted": "cancelled"
    }
    
    def __init__(self, shop_id: int, api_client: OzonAPIClient):
        """
        初始化订单同步服务

        Args:
            shop_id: 店铺ID
            api_client: Ozon API客户端
        """
        self.shop_id = shop_id
        self.api_client = api_client
        self.batch_size = 50

    @staticmethod
    def _parse_datetime(dt_str: Optional[str]) -> Optional[datetime]:
        """解析datetime字符串，确保返回UTC时区的datetime"""
        if not dt_str:
            return None
        try:
            # 替换Z为+00:00以支持fromisoformat
            dt_str = dt_str.replace("Z", "+00:00")
            dt = datetime.fromisoformat(dt_str)
            # 如果是naive datetime，添加UTC时区
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, AttributeError):
            return None
    
    async def sync_orders(
        self,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        full_sync: bool = False
    ) -> Dict[str, Any]:
        """
        同步订单主流程
        
        Args:
            date_from: 开始时间
            date_to: 结束时间
            full_sync: 是否全量同步
            
        Returns:
            同步结果统计
        """
        # 默认时间范围
        if not date_from:
            if full_sync:
                date_from = datetime.now(timezone.utc) - timedelta(days=90)  # 扩展到90天
            else:
                date_from = datetime.now(timezone.utc) - timedelta(hours=24)

        if not date_to:
            date_to = datetime.now(timezone.utc)
        
        sync_log = await self._create_sync_log("orders", "full" if full_sync else "incremental")
        
        try:
            # 获取检查点
            checkpoint = await self._get_checkpoint()
            
            # 更新检查点状态
            checkpoint.status = "running"
            await self._save_checkpoint(checkpoint)
            
            # 执行同步
            stats = {
                "total_processed": 0,
                "success": 0,
                "failed": 0,
                "skipped": 0
            }
            
            offset = 0
            has_more = True
            
            while has_more:
                # 拉取订单批次
                batch_result = await self._fetch_order_batch(
                    date_from, date_to, offset
                )
                
                if not batch_result["postings"]:
                    has_more = False
                    continue
                
                # 处理批次（注意：Ozon使用Posting维度）
                batch_stats = await self._process_posting_batch(batch_result["postings"])
                
                # 更新统计
                stats["total_processed"] += batch_stats["processed"]
                stats["success"] += batch_stats["success"]
                stats["failed"] += batch_stats["failed"]
                stats["skipped"] += batch_stats["skipped"]
                
                # 更新偏移量
                offset += self.batch_size
                
                # 检查是否还有更多数据
                has_more = len(batch_result["postings"]) == self.batch_size
                
                # 更新检查点
                checkpoint.last_sync_at = datetime.now(timezone.utc)
                checkpoint.total_processed = stats["total_processed"]
                checkpoint.total_success = stats["success"]
                checkpoint.total_failed = stats["failed"]
                await self._save_checkpoint(checkpoint)
                
                # 避免过快请求
                await asyncio.sleep(0.5)
            
            # 更新检查点为完成状态
            checkpoint.status = "idle"
            checkpoint.last_modified_at = date_to
            await self._save_checkpoint(checkpoint)
            
            # 记录同步日志
            await self._complete_sync_log(sync_log, "success", stats)
            
            logger.info(f"Order sync completed for shop {self.shop_id}", extra=stats)
            
            return stats
            
        except Exception as e:
            logger.error(f"Order sync failed for shop {self.shop_id}: {e}")
            
            # 更新检查点为失败状态
            checkpoint.status = "failed"
            checkpoint.error_message = str(e)
            await self._save_checkpoint(checkpoint)
            
            # 记录失败日志
            await self._complete_sync_log(sync_log, "failed", error=str(e))
            
            raise
    
    async def _fetch_order_batch(
        self,
        date_from: datetime,
        date_to: datetime,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        拉取订单批次（Posting维度）
        
        Args:
            date_from: 开始时间
            date_to: 结束时间
            offset: 偏移量
            
        Returns:
            Posting批次数据
        """
        try:
            response = await self.api_client.get_orders(
                date_from=date_from,
                date_to=date_to,
                limit=self.batch_size,
                offset=offset
            )
            
            return {
                "postings": response.get("result", {}).get("postings", []),
                "total": response.get("result", {}).get("count", 0)
            }
            
        except Exception as e:
            logger.error(f"Failed to fetch order batch: {e}")
            raise
    
    async def _process_posting_batch(self, postings: List[Dict]) -> Dict[str, int]:
        """
        处理Posting批次
        
        Args:
            postings: Posting数据列表
            
        Returns:
            处理统计
        """
        stats = {
            "processed": len(postings),
            "success": 0,
            "failed": 0,
            "skipped": 0
        }
        
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            for posting_data in postings:
                try:
                    # 处理单个Posting
                    await self._process_single_posting(session, posting_data)
                    stats["success"] += 1

                    # TODO: 发布Outbox事件（暂时禁用，需要 ozon_outbox_events 表）
                    # await self._publish_order_event(session, posting_data)

                except Exception as e:
                    logger.error(f"Failed to process posting {posting_data.get('posting_number')}: {e}")
                    stats["failed"] += 1
            
            # 批量提交
            await session.commit()
        
        return stats
    
    async def _process_single_posting(
        self,
        session: AsyncSession,
        posting_data: Dict[str, Any]
    ) -> OzonPosting:
        """
        处理单个Posting（发货单）
        
        Args:
            session: 数据库会话
            posting_data: Ozon Posting数据
            
        Returns:
            Posting实体
        """
        # 提取订单信息
        order_id = posting_data.get("order_id")
        order_number = posting_data.get("order_number")
        posting_number = posting_data.get("posting_number")

        # 先尝试通过 ozon_order_id 查找订单
        stmt = select(OzonOrder).where(
            and_(
                OzonOrder.shop_id == self.shop_id,
                OzonOrder.ozon_order_id == str(order_id)
            )
        )
        order = await session.scalar(stmt)

        # 如果没找到，尝试通过 posting_number 查找关联的临时订单（webhook创建的）
        if not order:
            posting_stmt = select(OzonPosting).where(
                and_(
                    OzonPosting.shop_id == self.shop_id,
                    OzonPosting.posting_number == posting_number
                )
            )
            existing_posting = await session.scalar(posting_stmt)
            if existing_posting and existing_posting.order_id:
                order = await session.get(OzonOrder, existing_posting.order_id)
                # 更新临时订单的 ozon_order_id 为真实值
                if order and order.ozon_order_id.startswith("webhook_"):
                    order.ozon_order_id = str(order_id)
                    order.order_id = f"OZ-{order_id}"

        if not order:
            # 创建新订单
            # ordered_at: 优先使用created_at，其次in_process_at，最后使用当前时间
            ordered_at = (
                self._parse_datetime(posting_data.get("created_at")) or
                self._parse_datetime(posting_data.get("in_process_at")) or
                datetime.now(timezone.utc)
            )

            order = OzonOrder(
                shop_id=self.shop_id,
                order_id=f"OZ-{order_id}",  # 生成本地订单号
                ozon_order_id=str(order_id),  # 转换为字符串
                ozon_order_number=order_number,
                status=self._map_order_status(posting_data.get("status")),
                ozon_status=posting_data.get("status"),
                ordered_at=ordered_at
            )
            session.add(order)
            await session.flush()  # 获取order.id

        # 更新订单信息
        order.status = self._map_order_status(posting_data.get("status"))
        order.ozon_status = posting_data.get("status")
        
        # 金额信息（API可能返回null，需要处理）
        analytics = posting_data.get("analytics_data") or {}
        financial = posting_data.get("financial_data") or {}

        order.total_price = Decimal(str(analytics.get("total_price", "0")))
        order.products_price = Decimal(str(analytics.get("products_price", "0")))
        order.delivery_price = Decimal(str(analytics.get("delivery_cost", "0")))
        order.commission_amount = Decimal(str(financial.get("commission_amount", "0")))
        
        # 客户信息（API可能返回null）
        customer = posting_data.get("customer") or {}
        if customer:
            order.customer_id = str(customer.get("id", ""))
            order.customer_phone = customer.get("phone")
            order.customer_email = customer.get("email")

        # 地址信息（API可能返回null）
        delivery = posting_data.get("delivery_method") or {}
        address = (posting_data.get("analytics_data") or {}).get("delivery_address") or {}
        
        order.delivery_address = {
            "city": address.get("city"),
            "region": address.get("region"),
            "postal_code": address.get("zip_code"),
            "address": address.get("address"),
            "comment": address.get("comment")
        }
        
        order.delivery_method = delivery.get("name")
        order.delivery_date = self._parse_date(posting_data.get("shipment_date"))
        
        # 原始数据
        order.raw_payload = posting_data
        
        # 同步信息
        order.last_sync_at = datetime.now(timezone.utc)
        order.sync_status = "success"
        
        # 查找或创建Posting
        stmt = select(OzonPosting).where(
            OzonPosting.posting_number == posting_number
        )
        posting = await session.scalar(stmt)
        
        if not posting:
            posting = OzonPosting(
                order_id=order.id,
                shop_id=self.shop_id,
                posting_number=posting_number,
                ozon_posting_number=posting_data.get("posting_number"),
                status=posting_data.get("status") or "awaiting_packaging",  # 设置初始状态（必填）
                operation_status='awaiting_stock'  # 设置初始操作状态
            )
            session.add(posting)
            # ✅ 立即 flush posting，确保 posting.id 有值（后续代码需要使用 posting.id）
            await session.flush()

        # 更新Posting信息
        # 如果 API 没返回状态，保持原状态（避免覆盖为 None）
        new_status = posting_data.get("status")
        if new_status:
            posting.status = new_status
        posting.substatus = posting_data.get("substatus")
        
        posting.shipment_date = self._parse_date(posting_data.get("shipment_date"))
        posting.in_process_at = self._parse_date(posting_data.get("in_process_at"))
        posting.shipped_at = self._parse_date(posting_data.get("shipped_at"))
        posting.delivered_at = self._parse_date(posting_data.get("delivered_at"))
        
        # 仓库信息
        posting.warehouse_id = delivery.get("warehouse_id")
        posting.warehouse_name = delivery.get("warehouse_name")
        
        # 配送方式
        posting.delivery_method_id = delivery.get("id")
        posting.delivery_method_name = delivery.get("name")
        
        # 取消信息
        cancellation = posting_data.get("cancellation", {})
        # 检查是否真的有取消信息（不只是空对象）
        has_cancellation = bool(
            cancellation.get("cancel_reason_id") or
            cancellation.get("cancel_reason") or
            cancellation.get("cancellation_type")
        )

        if has_cancellation:
            posting.is_cancelled = True
            posting.cancel_reason_id = cancellation.get("cancel_reason_id") or cancellation.get("reason_id")
            posting.cancel_reason = cancellation.get("cancel_reason") or cancellation.get("reason")
            posting.cancelled_at = self._parse_date(cancellation.get("cancelled_at"))
        else:
            # 重要：如果API不再返回有效的cancellation，说明订单未取消或已恢复，需要重置标志
            posting.is_cancelled = False

        posting.raw_payload = posting_data

        # 更新 has_tracking_number（反范式化字段，避免 JSONB 查询）
        tracking_number = posting_data.get("tracking_number")
        posting.has_tracking_number = bool(tracking_number and tracking_number.strip())

        # 计算并存储 order_total_price（预计算优化，避免统计查询时循环解析 raw_payload）
        products = posting_data.get("products", [])
        if products:
            total_price = sum(
                Decimal(str(p.get("price", "0"))) * int(p.get("quantity", 0))
                for p in products
            )
            posting.order_total_price = total_price

            # 提取并存储 product_skus（反范式化，优化 SKU 搜索性能）
            skus = list(set(
                str(p.get("sku")) for p in products
                if p.get("sku") is not None
            ))
            posting.product_skus = skus if skus else None

            # 计算 has_purchase_info（反范式化，避免 jsonb_array_elements 子查询）
            # 逻辑：所有商品都有采购信息时为 True
            if skus:
                # 查询这些 SKU 中有多少有采购信息
                sku_ints = [int(s) for s in skus if s.isdigit()]
                if sku_ints:
                    result = await session.execute(
                        select(func.count(OzonProduct.id))
                        .where(
                            OzonProduct.shop_id == self.shop_id,
                            OzonProduct.ozon_sku.in_(sku_ints),
                            OzonProduct.purchase_url.isnot(None),
                            OzonProduct.purchase_url != ''
                        )
                    )
                    products_with_purchase = result.scalar() or 0
                    posting.has_purchase_info = (products_with_purchase == len(sku_ints))
                else:
                    posting.has_purchase_info = False
            else:
                posting.has_purchase_info = False

        # 处理订单商品
        await self._process_order_items(session, order, posting_data.get("products", []))

        # 处理包裹信息
        # 对于需要追踪号码的状态，如果列表接口未返回packages，则调用详情接口
        posting_status = posting_data.get("status")
        needs_tracking = posting_status in ["awaiting_deliver", "delivering", "delivered"]

        if posting_data.get("packages"):
            # 列表接口有返回packages，直接处理
            await self._process_packages(session, posting, posting_data["packages"])
        elif needs_tracking:
            # 需要追踪号码但列表接口未返回，调用详情接口获取完整包裹信息
            try:
                detail_response = await self.api_client.get_posting_details(posting_number)
                detail_data = detail_response.get("result", {})
                if detail_data.get("packages"):
                    await self._process_packages(session, posting, detail_data["packages"])
                    logger.info(f"Fetched package details for posting {posting_number}, packages: {len(detail_data['packages'])}")
            except Exception as e:
                logger.warning(f"Failed to fetch package details for posting {posting_number}: {e}")

        # 处理顶层 tracking_number（如果没有 packages 数组但有 tracking_number 字段）
        if posting_data.get("tracking_number"):
            raw_tracking_number = posting_data["tracking_number"]

            # 验证tracking_number:如果等于posting_number,说明是OZON API返回的错误数据,应该忽略
            if raw_tracking_number == posting_number:
                logger.warning(f"Ignoring invalid tracking_number (same as posting_number) for posting {posting_number}")
            else:
                # 检查是否已有包裹记录
                stmt = select(OzonShipmentPackage).where(
                    OzonShipmentPackage.posting_id == posting.id
                )
                existing_packages = await session.scalars(stmt)
                package_count = len(list(existing_packages))

                if package_count == 0:
                    # 没有包裹记录，创建一个默认包裹
                    default_package = OzonShipmentPackage(
                        posting_id=posting.id,
                        package_number=f"PKG-{posting.id}-1",
                        tracking_number=raw_tracking_number
                    )
                    session.add(default_package)
                    logger.info(f"Created default package for posting {posting_number} with tracking_number: {raw_tracking_number}")

        # ========== 使用统一的状态管理器更新operation_status ==========
        from .posting_status_manager import PostingStatusManager

        await PostingStatusManager.update_posting_status(
            posting=posting,
            ozon_status=posting.status,
            db=session,
            source="single_posting_sync",  # 来源：单个posting同步
            preserve_manual=True  # 保留用户手动标记的printed状态
        )

        return posting
    
    async def _process_order_items(
        self,
        session: AsyncSession,
        order: OzonOrder,
        products: List[Dict]
    ):
        """处理订单商品明细"""

        # 删除旧商品（用于更新场景）- 使用异步查询而不是懒加载
        stmt = select(OzonOrderItem).where(OzonOrderItem.order_id == order.id)
        existing_items = await session.scalars(stmt)
        deleted_count = 0
        for item in existing_items:
            await session.delete(item)
            deleted_count += 1
        logger.info(f"[同步调试] 删除了 {deleted_count} 条旧商品记录")

        # 添加商品明细
        added_count = 0
        for product_data in products:
            quantity = product_data.get("quantity", 0)
            price = Decimal(str(product_data.get("price", "0")))
            item = OzonOrderItem(
                order_id=order.id,
                offer_id=product_data.get("offer_id"),
                ozon_sku=product_data.get("sku"),
                name=product_data.get("name"),
                quantity=quantity,
                price=price,
                total_amount=price * quantity  # 使用 total_amount 而不是 total_price
            )
            session.add(item)
            added_count += 1
            logger.info(f"[同步调试] 添加商品: offer_id={item.offer_id}, sku={item.ozon_sku}, name={item.name}")

        logger.info(f"[同步调试] _process_order_items完成: 添加了 {added_count} 条商品记录")
    
    async def _process_packages(
        self,
        session: AsyncSession,
        posting: OzonPosting,
        packages: List[Dict]
    ):
        """处理包裹信息"""
        for package_data in packages:
            package_number = package_data.get("package_number") or package_data.get("id") or f"PKG-{posting.id}-{len(packages)}"

            # 查找或创建包裹
            stmt = select(OzonShipmentPackage).where(
                and_(
                    OzonShipmentPackage.posting_id == posting.id,
                    OzonShipmentPackage.package_number == package_number
                )
            )
            package = await session.scalar(stmt)

            if not package:
                package = OzonShipmentPackage(
                    posting_id=posting.id,
                    package_number=package_number
                )
                session.add(package)

            # 更新包裹信息
            raw_tracking_number = package_data.get("tracking_number")
            # 验证tracking_number:如果等于posting_number,说明是错误数据,设为None
            if raw_tracking_number and raw_tracking_number == posting.posting_number:
                logger.warning(f"Ignoring invalid tracking_number (same as posting_number) for package {package_number}")
                package.tracking_number = None
            else:
                package.tracking_number = raw_tracking_number

            package.carrier_name = package_data.get("carrier_name")
            package.carrier_code = package_data.get("carrier_code")
            package.status = package_data.get("status")

            # 更新时间戳
            if package_data.get("status_updated_at"):
                package.status_updated_at = self._parse_date(package_data["status_updated_at"])
            
    async def ship_posting(
        self,
        posting_number: str,
        tracking_number: str,
        carrier_code: str,
        items: Optional[List[Dict]] = None
    ) -> Dict[str, Any]:
        """
        发货操作
        
        Args:
            posting_number: Posting编号
            tracking_number: 物流单号
            carrier_code: 承运商代码
            items: 发货商品列表（部分发货时使用）
            
        Returns:
            发货结果
        """
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            # 查找Posting
            stmt = select(OzonPosting).where(
                and_(
                    OzonPosting.shop_id == self.shop_id,
                    OzonPosting.posting_number == posting_number
                )
            )
            posting = await session.scalar(stmt)
            
            if not posting:
                raise ValidationError(
                    code="POSTING_NOT_FOUND",
                    detail=f"Posting {posting_number} not found"
                )

            # 验证状态
            if posting.status not in ["awaiting_packaging", "awaiting_deliver"]:
                raise ValidationError(
                    code="INVALID_POSTING_STATUS",
                    detail=f"Invalid posting status for shipping: {posting.status}"
                )
            
            # 获取承运商ID
            carrier_id = self._get_carrier_id(carrier_code)
            
            # 准备发货商品列表
            if not items:
                # 全部发货
                stmt = select(OzonOrderItem).where(
                    OzonOrderItem.order_id == posting.order_id
                )
                order_items = await session.scalars(stmt)
                
                items = [
                    {
                        "sku": item.ozon_sku,
                        "quantity": item.quantity
                    }
                    for item in order_items
                ]
            
            # 调用Ozon API
            try:
                result = await self.api_client.ship_posting(
                    posting_number=posting.ozon_posting_number,
                    tracking_number=tracking_number,
                    shipping_provider_id=carrier_id,
                    items=items
                )
                
                # 更新本地状态
                posting.status = "delivering"
                posting.shipped_at = datetime.now(timezone.utc)
                
                # 创建包裹记录
                package = OzonShipmentPackage(
                    posting_id=posting.id,
                    package_number=f"PKG-{posting.id}-1",
                    tracking_number=tracking_number,
                    carrier_id=carrier_id,
                    carrier_code=carrier_code,
                    status="shipped"
                )
                session.add(package)
                
                # 创建Outbox事件
                outbox_event = OzonOutboxEvent(
                    event_id=f"ship-{posting.id}-{datetime.now(timezone.utc).timestamp()}",
                    event_type="posting.shipped",
                    aggregate_type="posting",
                    aggregate_id=str(posting.id),
                    event_data={
                        "posting_number": posting_number,
                        "tracking_number": tracking_number,
                        "shipped_at": posting.shipped_at.isoformat()
                    }
                )
                session.add(outbox_event)
                
                await session.commit()
                
                return {
                    "success": True,
                    "posting_number": posting_number,
                    "tracking_number": tracking_number
                }
                
            except Exception as e:
                logger.error(f"Failed to ship posting {posting_number}: {e}")
                raise
    
    def _map_order_status(self, ozon_status: str) -> str:
        """映射Ozon订单状态到系统状态"""
        return self.STATUS_MAP.get(ozon_status, "pending")
    
    def _get_carrier_id(self, carrier_code: str) -> int:
        """获取承运商ID"""
        carriers = {
            "CDEK": 1,
            "BOXBERRY": 2,
            "POCHTA": 3,
            "DPD": 4,
            "OZON": 5
        }
        return carriers.get(carrier_code.upper(), 1)
    
    def _parse_date(self, date_str: Optional[str]) -> Optional[datetime]:
        """解析日期字符串，确保返回UTC时区的datetime"""
        if not date_str:
            return None

        try:
            # 处理ISO格式
            if "T" in date_str:
                dt_str = date_str.replace("Z", "+00:00")
                dt = datetime.fromisoformat(dt_str)
                # 确保有时区信息
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            else:
                # 解析纯日期格式，添加UTC时区
                dt = datetime.strptime(date_str, "%Y-%m-%d")
                return dt.replace(tzinfo=timezone.utc)
        except Exception as e:
            logger.warning(f"Failed to parse date: {date_str}, error: {e}")
            return None
    
    async def _publish_order_event(self, session: AsyncSession, posting_data: Dict):
        """发布订单事件到Outbox"""
        event = OzonOutboxEvent(
            event_id=f"order-{posting_data['order_id']}-{datetime.now(timezone.utc).timestamp()}",
            event_type="order.synced",
            aggregate_type="order",
            aggregate_id=posting_data["order_id"],
            event_data=posting_data,
            status="pending"
        )
        session.add(event)
    
    async def _get_checkpoint(self) -> OzonSyncCheckpoint:
        """获取或创建同步检查点"""
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            stmt = select(OzonSyncCheckpoint).where(
                and_(
                    OzonSyncCheckpoint.shop_id == self.shop_id,
                    OzonSyncCheckpoint.entity_type == "orders"
                )
            )
            checkpoint = await session.scalar(stmt)
            
            if not checkpoint:
                checkpoint = OzonSyncCheckpoint(
                    shop_id=self.shop_id,
                    entity_type="orders",
                    status="idle"
                )
                session.add(checkpoint)
                await session.commit()
            
            return checkpoint
    
    async def _save_checkpoint(self, checkpoint: OzonSyncCheckpoint):
        """保存检查点"""
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            session.add(checkpoint)
            await session.commit()
    
    async def _create_sync_log(self, entity_type: str, sync_type: str) -> OzonSyncLog:
        """创建同步日志"""
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            sync_log = OzonSyncLog(
                shop_id=self.shop_id,
                entity_type=entity_type,
                sync_type=sync_type,
                status="started",
                started_at=datetime.now(timezone.utc)
            )
            session.add(sync_log)
            await session.commit()
            return sync_log
    
    async def _complete_sync_log(
        self,
        sync_log: OzonSyncLog,
        status: str,
        stats: Optional[Dict] = None,
        error: Optional[str] = None
    ):
        """完成同步日志"""
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            sync_log.status = status
            sync_log.completed_at = datetime.now(timezone.utc)
            
            if stats:
                sync_log.processed_count = stats.get("total_processed", 0)
                sync_log.success_count = stats.get("success", 0)
                sync_log.failed_count = stats.get("failed", 0)
                sync_log.skipped_count = stats.get("skipped", 0)
            
            if error:
                # 截断错误消息，防止超过数据库字段长度限制（VARCHAR(2000)）
                sync_log.error_message = error[:1900] if len(error) > 1900 else error
            
            # 计算耗时
            if sync_log.started_at:
                duration = (sync_log.completed_at - sync_log.started_at).total_seconds()
                sync_log.duration_ms = int(duration * 1000)
            
            session.add(sync_log)
            await session.commit()