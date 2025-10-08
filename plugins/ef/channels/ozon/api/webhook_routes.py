"""
Ozon Webhook 接收端点
处理来自 Ozon 平台的实时事件通知
"""
import json
import logging
from typing import Dict, Any
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException, Depends, Header
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ef_core.database import get_async_session
from ..models.ozon_shops import OzonShop
from ..webhooks.handler import OzonWebhookHandler

router = APIRouter(prefix="/webhook", tags=["Ozon Webhooks"])
logger = logging.getLogger(__name__)


def is_ozon_request(headers: dict) -> bool:
    """
    检测是否为OZON的请求（通过User-Agent判断）

    Args:
        headers: 请求头字典

    Returns:
        True如果是OZON请求，False否则
    """
    user_agent = headers.get("user-agent", "").lower()
    return "ozon" in user_agent or "push" in user_agent


def ozon_success_response():
    """
    返回符合OZON规范的成功响应
    OZON期望所有webhook都返回这个格式，即使处理过程中有错误
    """
    return JSONResponse(
        status_code=200,
        content={
            "version": "1.0",
            "name": "EuraFlow",
            "time": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        }
    )


def ozon_error_response(status_code: int, error_code: str, message: str, details: str = None):
    """
    返回符合OZON规范的错误响应

    注意：对于OZON的请求，应该优先使用ozon_success_response()
    这个函数主要用于非OZON请求或需要明确返回错误的情况

    Args:
        status_code: HTTP状态码 (4xx或5xx)
        error_code: OZON错误代码 (ERROR_UNKNOWN, ERROR_PARAMETER_VALUE_MISSED, ERROR_REQUEST_DUPLICATED)
        message: 错误描述
        details: 更多信息（可选）
    """
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": error_code,
                "message": message,
                "details": details
            }
        }
    )


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
        # 收集请求头信息（先获取，用于判断是否为OZON请求）
        headers = dict(request.headers)

        # 获取原始请求体（只读取一次，避免stream被消费）
        raw_body = await request.body()

        # 手动解析JSON（从raw_body解析，不能再调用request.json()）
        try:
            payload = json.loads(raw_body) if raw_body else {}
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Failed to parse webhook payload: {e}")
            # OZON期望即使JSON解析失败也返回200（EMPTY_BODY/WRONG_BODY测试）
            if is_ozon_request(headers):
                logger.warning(f"OZON request with invalid JSON, returning 200: {e}")
                return ozon_success_response()
            return ozon_error_response(
                status_code=400,
                error_code="ERROR_PARAMETER_VALUE_MISSED",
                message="Invalid JSON payload",
                details=str(e)
            )

        # 基本验证
        # 如果没有X-Event-Type，检查是否是OZON验证请求
        if not x_event_type:
            # OZON验证请求的User-Agent通常是"ozon-push"或包含"ozon"
            if is_ozon_request(headers):
                logger.info(f"Received OZON webhook request without event type, returning 200")
                return ozon_success_response()
            logger.warning("Missing X-Event-Type header in webhook request")
            return ozon_error_response(
                status_code=400,
                error_code="ERROR_PARAMETER_VALUE_MISSED",
                message="Missing X-Event-Type header"
            )

        # 处理Ozon的webhook验证请求（PING）
        # Ozon在配置webhook时会发送ping/test请求来验证URL可达性
        if x_event_type.lower() in ('ping', 'test', 'verification'):
            logger.info(f"Received webhook verification request: {x_event_type}")
            return ozon_success_response()

        if not x_ozon_signature:
            logger.warning("Missing X-Ozon-Signature header in webhook request")
            # OZON测试EMPTY_SIGN场景：期望返回200
            if is_ozon_request(headers):
                logger.warning("OZON request without signature, returning 200 for compatibility")
                return ozon_success_response()
            return ozon_error_response(
                status_code=400,
                error_code="ERROR_PARAMETER_VALUE_MISSED",
                message="Missing X-Ozon-Signature header"
            )

        # 从载荷中提取店铺信息
        # Ozon webhook通常在载荷中包含店铺标识信息
        shop_identifier = None
        if payload.get("company_id"):
            shop_identifier = payload["company_id"]
        elif payload.get("client_id"):
            shop_identifier = payload["client_id"]

        if not shop_identifier:
            logger.error(f"Cannot identify shop from webhook payload: {payload}")
            # OZON期望即使无法识别店铺也返回200
            if is_ozon_request(headers):
                logger.warning("OZON request without shop identifier, returning 200 for compatibility")
                return ozon_success_response()
            return ozon_error_response(
                status_code=400,
                error_code="ERROR_PARAMETER_VALUE_MISSED",
                message="Cannot identify shop from payload",
                details="Missing company_id or client_id in payload"
            )

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
            # OZON期望即使店铺未找到也返回200
            if is_ozon_request(headers):
                logger.warning(f"OZON request for unknown shop {shop_identifier}, returning 200 for compatibility")
                return ozon_success_response()
            return ozon_error_response(
                status_code=404,
                error_code="ERROR_UNKNOWN",
                message="Shop not found or inactive",
                details=f"shop_identifier: {shop_identifier}"
            )

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
            return ozon_success_response()
        else:
            logger.error(f"Webhook processing failed: {result}")
            # OZON期望即使处理失败也返回200
            # 这包括INVALID_SIGN（签名验证失败）场景
            if is_ozon_request(headers):
                logger.warning(f"OZON request processing failed, returning 200 for compatibility: {result.get('error')}")
                return ozon_success_response()
            # 对于非OZON请求，返回具体错误
            if "signature" in result.get("error", "").lower():
                return ozon_error_response(
                    status_code=401,
                    error_code="ERROR_UNKNOWN",
                    message="Invalid webhook signature",
                    details=result.get("error")
                )
            return ozon_error_response(
                status_code=500,
                error_code="ERROR_UNKNOWN",
                message="Webhook processing failed",
                details=result.get("error", "Processing failed")
            )

    except Exception as e:
        logger.error(f"Unexpected error processing webhook: {e}")
        import traceback
        logger.error(traceback.format_exc())
        # OZON期望即使发生意外错误也返回200
        # 获取headers（可能在异常前已设置）
        try:
            headers_dict = dict(request.headers) if hasattr(request, 'headers') else {}
            if is_ozon_request(headers_dict):
                logger.warning(f"OZON request caused unexpected error, returning 200 for compatibility: {e}")
                return ozon_success_response()
        except:
            pass
        return ozon_error_response(
            status_code=500,
            error_code="ERROR_UNKNOWN",
            message="Internal server error",
            details=str(e)
        )


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