"""
Ozon Webhook 接收端点
处理来自 Ozon 平台的实时事件通知
"""
import logging
from typing import Dict, Any
from fastapi import APIRouter, Request, HTTPException, Depends, Header
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ef_core.database import get_async_session
from ..models.ozon_shops import OzonShop
from ..webhooks.handler import OzonWebhookHandler

router = APIRouter(prefix="/webhook", tags=["Ozon Webhooks"])
logger = logging.getLogger(__name__)


@router.post("")
async def receive_webhook(
    request: Request,
    x_ozon_signature: str = Header(None, alias="X-Ozon-Signature"),
    x_event_id: str = Header(None, alias="X-Event-Id"),
    x_event_type: str = Header(None, alias="X-Event-Type"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    接收 Ozon Webhook 事件

    此端点接收来自 Ozon 平台的实时事件通知，包括：
    - 订单状态变更 (posting.status_changed)
    - 发货单取消 (posting.cancelled)
    - 发货单妥投 (posting.delivered)
    - 商品价格变更 (product.price_changed)
    - 商品库存变更 (product.stock_changed)
    - 退货创建 (return.created)
    - 退货状态变更 (return.status_changed)

    Headers:
        X-Ozon-Signature: HMAC签名，用于验证请求来源
        X-Event-Id: 事件唯一标识符，用于幂等性控制
        X-Event-Type: 事件类型
    """
    try:
        # 获取原始请求体
        raw_body = await request.body()

        # 解析JSON载荷
        try:
            payload = await request.json()
        except Exception as e:
            logger.error(f"Failed to parse webhook payload: {e}")
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

        # 收集请求头信息
        headers = dict(request.headers)

        # 基本验证
        # 如果没有X-Event-Type，检查是否是OZON验证请求
        if not x_event_type:
            user_agent = headers.get("user-agent", "").lower()
            # OZON验证请求的User-Agent通常是"ozon-push"或包含"ozon"
            if "ozon" in user_agent or "push" in user_agent:
                logger.info(f"Received OZON webhook verification request (no event type): UA={user_agent}")
                from datetime import datetime
                return JSONResponse(
                    status_code=200,
                    content={
                        "status": "success",
                        "message": "Webhook endpoint verified",
                        "timestamp": datetime.utcnow().isoformat()
                    }
                )
            logger.warning("Missing X-Event-Type header in webhook request")
            raise HTTPException(status_code=400, detail="Missing X-Event-Type header")

        # 处理Ozon的webhook验证请求（PING）
        # Ozon在配置webhook时会发送ping/test请求来验证URL可达性
        if x_event_type.lower() in ('ping', 'test', 'verification'):
            logger.info(f"Received webhook verification request: {x_event_type}")
            return JSONResponse(
                status_code=200,
                content={
                    "status": "success",
                    "message": "Webhook endpoint verified",
                    "event_type": x_event_type,
                    "event_id": x_event_id
                }
            )

        if not x_ozon_signature:
            logger.warning("Missing X-Ozon-Signature header in webhook request")
            raise HTTPException(status_code=400, detail="Missing X-Ozon-Signature header")

        # 从载荷中提取店铺信息
        # Ozon webhook通常在载荷中包含店铺标识信息
        shop_identifier = None
        if payload.get("company_id"):
            shop_identifier = payload["company_id"]
        elif payload.get("client_id"):
            shop_identifier = payload["client_id"]

        if not shop_identifier:
            logger.error(f"Cannot identify shop from webhook payload: {payload}")
            raise HTTPException(status_code=400, detail="Cannot identify shop from payload")

        # 查找对应的店铺和Webhook配置
        shop_result = await db.execute(
            select(OzonShop).where(
                OzonShop.client_id == str(shop_identifier)
            ).where(
                OzonShop.status == "active"
            )
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            logger.warning(f"Shop not found for identifier: {shop_identifier}")
            raise HTTPException(status_code=404, detail="Shop not found or inactive")

        # 获取Webhook密钥（可选，用于签名验证）
        webhook_secret = None
        if shop.config and shop.config.get("webhook_secret"):
            webhook_secret = shop.config["webhook_secret"]
            logger.info(f"Webhook signature verification enabled for shop {shop.id}")
        else:
            logger.info(f"Webhook signature verification disabled for shop {shop.id} (no secret configured)")

        # 创建Webhook处理器实例
        webhook_handler = OzonWebhookHandler(
            shop_id=shop.id,
            webhook_secret=webhook_secret or ""  # 使用空字符串如果没有配置secret
        )

        # 处理Webhook事件
        logger.info(f"Processing webhook event: type={x_event_type}, shop_id={shop.id}, event_id={x_event_id}")

        result = await webhook_handler.handle_webhook(
            event_type=x_event_type,
            payload=payload,
            headers=headers,
            raw_body=raw_body
        )

        # 记录处理结果
        if result.get("success"):
            logger.info(f"Webhook processed successfully: {result}")
            return JSONResponse(
                status_code=200,
                content={
                    "status": "success",
                    "message": "Event processed successfully",
                    "event_id": result.get("event_id"),
                    "event_type": x_event_type
                }
            )
        else:
            logger.error(f"Webhook processing failed: {result}")
            # 对于签名验证失败，返回401
            if "signature" in result.get("error", "").lower():
                raise HTTPException(status_code=401, detail=result.get("error"))
            # 其他错误返回500
            raise HTTPException(status_code=500, detail=result.get("error", "Processing failed"))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error processing webhook: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/health")
async def webhook_health():
    """
    Webhook 健康检查端点

    用于验证 Webhook 端点是否正常工作
    """
    return {
        "status": "healthy",
        "service": "ozon-webhook",
        "timestamp": "2025-09-30T00:00:00Z"
    }


@router.get("/events")
async def list_webhook_events(
    shop_id: int = None,
    status: str = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_async_session)
):
    """
    查询 Webhook 事件记录

    Args:
        shop_id: 店铺ID筛选
        status: 事件状态筛选 (pending/processing/processed/failed/ignored)
        limit: 返回数量限制
        offset: 分页偏移量
    """
    from ..models.sync import OzonWebhookEvent
    from sqlalchemy import desc, and_

    try:
        # 构建查询条件
        conditions = []
        if shop_id:
            conditions.append(OzonWebhookEvent.shop_id == shop_id)
        if status:
            conditions.append(OzonWebhookEvent.status == status)

        # 查询事件列表
        query = select(OzonWebhookEvent)
        if conditions:
            query = query.where(and_(*conditions))

        query = query.order_by(desc(OzonWebhookEvent.created_at))
        query = query.limit(limit).offset(offset)

        result = await db.execute(query)
        events = result.scalars().all()

        # 转换为字典格式
        events_data = []
        for event in events:
            events_data.append({
                "id": event.id,
                "event_id": event.event_id,
                "event_type": event.event_type,
                "shop_id": event.shop_id,
                "status": event.status,
                "is_verified": event.is_verified,
                "entity_type": event.entity_type,
                "entity_id": event.entity_id,
                "retry_count": event.retry_count,
                "error_message": event.error_message,
                "created_at": event.created_at.isoformat() if event.created_at else None,
                "processed_at": event.processed_at.isoformat() if event.processed_at else None,
                "payload_summary": {
                    "keys": list(event.payload.keys()) if event.payload else [],
                    "size": len(str(event.payload)) if event.payload else 0
                }
            })

        return {
            "events": events_data,
            "limit": limit,
            "offset": offset,
            "total": len(events_data)
        }

    except Exception as e:
        logger.error(f"Failed to list webhook events: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list events: {str(e)}")


@router.post("/events/{event_id}/retry")
async def retry_webhook_event(
    event_id: str,
    db: AsyncSession = Depends(get_async_session)
):
    """
    重试失败的 Webhook 事件

    Args:
        event_id: 事件ID
    """
    from ..models.sync import OzonWebhookEvent

    try:
        # 查找事件
        result = await db.execute(
            select(OzonWebhookEvent).where(OzonWebhookEvent.event_id == event_id)
        )
        event = result.scalar_one_or_none()

        if not event:
            raise HTTPException(status_code=404, detail="Webhook event not found")

        if event.status not in ["failed", "ignored"]:
            raise HTTPException(status_code=400, detail="Only failed or ignored events can be retried")

        # 获取店铺信息
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == event.shop_id)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            raise HTTPException(status_code=500, detail="Shop not found")

        # 创建处理器并重新处理
        webhook_handler = OzonWebhookHandler(
            shop_id=shop.id,
            webhook_secret=shop.config.get("webhook_secret", "")
        )

        # 重新处理事件（跳过签名验证，因为这是重试）
        result = await webhook_handler._process_event(
            event_type=event.event_type,
            payload=event.payload,
            webhook_event=event
        )

        # 更新事件状态
        from datetime import datetime
        event.status = "processed" if result else "failed"
        event.processed_at = datetime.utcnow()
        event.retry_count += 1

        await db.commit()

        return {
            "success": True,
            "message": "Event retried successfully",
            "status": event.status,
            "retry_count": event.retry_count
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to retry webhook event: {e}")
        raise HTTPException(status_code=500, detail=f"Retry failed: {str(e)}")