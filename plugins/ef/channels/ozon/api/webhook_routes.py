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
from ..utils.datetime_utils import utcnow

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


def ozon_success_response(signature: str = None, push_type: str = None, request_time: str = None):
    """
    返回符合OZON规范的成功响应
    OZON期望所有webhook都返回这个格式，即使处理过程中有错误

    Args:
        signature: 原样回显请求里的签名值，没有就留空字符串
        push_type: 原样回显推送类型（message_type），没有就留空字符串
        request_time: OZON请求中的time字段（应该回显而不是生成新时间）
    """
    # 优先使用OZON发送的时间，如果没有则使用当前时间
    response_time = request_time if request_time else utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    response_content = {
        "result": True,
        "body": "OK",
        "sign": signature if signature else "",
        "push_type": push_type if push_type else "",
        "time": response_time,
        "name": "EuraFlow",
        "version": "1.0"
    }

    logger.info(f"WEBHOOK RESPONSE (SUCCESS): HTTP 200, content={response_content}")

    return JSONResponse(
        status_code=200,
        content=response_content
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
    response_content = {
        "error": {
            "code": error_code,
            "message": message,
            "details": details
        }
    }

    logger.warning(f"WEBHOOK RESPONSE (ERROR): HTTP {status_code}, content={response_content}")

    return JSONResponse(
        status_code=status_code,
        content=response_content
    )


@router.post("")
async def receive_webhook(
    request: Request,
    x_ozon_signature: str = Header(None, alias="X-Ozon-Signature"),
    signature: str = Header(None),  # OZON实际使用的签名头（小写）
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

        # ========== 详细日志记录：OZON请求诊断 ==========
        logger.info("=" * 80)
        logger.info("WEBHOOK REQUEST RECEIVED - DETAILED LOG")
        logger.info("=" * 80)

        # 记录所有请求头
        logger.info("REQUEST HEADERS:")
        for key, value in headers.items():
            # 脱敏处理：如果是签名，只显示前10个字符
            if key.lower() in ['x-ozon-signature', 'authorization']:
                logger.info(f"  {key}: {value[:10]}..." if len(value) > 10 else f"  {key}: {value}")
            else:
                logger.info(f"  {key}: {value}")

        # 记录原始请求体（限制长度）
        logger.info(f"\nRAW BODY (first 500 chars):")
        logger.info(f"  {raw_body[:500].decode('utf-8', errors='replace') if raw_body else 'EMPTY'}")
        logger.info(f"  Body length: {len(raw_body) if raw_body else 0} bytes")

        # 记录关键头部
        logger.info(f"\nKEY HEADERS:")
        logger.info(f"  User-Agent: {headers.get('user-agent', 'MISSING')}")
        logger.info(f"  Content-Type: {headers.get('content-type', 'MISSING')}")
        logger.info(f"  signature (小写): {headers.get('signature', 'MISSING')[:20] if headers.get('signature') else 'MISSING'}...")
        logger.info(f"  X-Ozon-Signature: {headers.get('x-ozon-signature', 'MISSING')[:20] if headers.get('x-ozon-signature') else 'MISSING'}...")
        logger.info(f"  X-Event-Type: {headers.get('x-event-type', 'MISSING')}")
        logger.info(f"  X-Event-Id: {headers.get('x-event-id', 'MISSING')}")

        logger.info("=" * 80)

        # 手动解析JSON（从raw_body解析，不能再调用request.json()）
        try:
            payload = json.loads(raw_body) if raw_body else {}
            logger.info(f"PARSED PAYLOAD: {payload}")
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Failed to parse webhook payload: {e}")
            logger.error(f"Raw body that failed to parse: {raw_body}")
            # OZON期望即使JSON解析失败也返回200（EMPTY_BODY/WRONG_BODY测试）
            if is_ozon_request(headers):
                logger.warning(f"OZON request with invalid JSON, returning 200: {e}")
                # JSON解析失败，回显签名（如果有），时间无法获取使用当前时间
                actual_signature = signature or x_ozon_signature
                return ozon_success_response(signature=actual_signature, push_type="", request_time=None)
            return ozon_error_response(
                status_code=400,
                error_code="ERROR_PARAMETER_VALUE_MISSED",
                message="Invalid JSON payload",
                details=str(e)
            )

        # 提取OZON发送的时间（用于回显）
        request_time = payload.get("time")
        logger.info(f"REQUEST TIME from payload: {request_time}")

        # 提取事件类型：优先使用X-Event-Type头，fallback到payload的message_type
        # 根据OZON文档，实际事件类型在payload的message_type字段中（TYPE_PING, TYPE_NEW_POSTING等）
        event_type = x_event_type
        logger.info(f"EVENT TYPE extraction:")
        logger.info(f"  X-Event-Type header: {x_event_type or 'MISSING'}")
        logger.info(f"  message_type in payload: {payload.get('message_type', 'MISSING')}")

        if not event_type and "message_type" in payload:
            event_type = payload["message_type"]
            logger.info(f"  → Using message_type from payload: {event_type}")
        else:
            logger.info(f"  → Using X-Event-Type header: {event_type or 'NONE'}")

        # 基本验证：如果两者都没有，检查是否是OZON验证请求
        if not event_type:
            # OZON验证请求的User-Agent通常是"ozon-push"或包含"ozon"
            if is_ozon_request(headers):
                logger.info(f"Received OZON webhook request without event type (TYPE_PING verification)")
                # 提取签名并回显
                actual_signature = signature or x_ozon_signature
                return ozon_success_response(signature=actual_signature, push_type="", request_time=request_time)
            logger.warning("Missing both X-Event-Type header and message_type in payload")
            return ozon_error_response(
                status_code=400,
                error_code="ERROR_PARAMETER_VALUE_MISSED",
                message="Missing event type"
            )

        # ========== 记录签名信息（不验证，因为OZON测试期望所有情况返回200） ==========
        # 提取签名：OZON实际使用小写的 "signature" 头，不是 "X-Ozon-Signature"
        actual_signature = signature or x_ozon_signature
        logger.info(f"SIGNATURE extraction:")
        logger.info(f"  signature header: {signature[:20] if signature else 'MISSING'}...")
        logger.info(f"  X-Ozon-Signature header: {x_ozon_signature[:20] if x_ozon_signature else 'MISSING'}...")
        logger.info(f"  → Using: {actual_signature[:20] if actual_signature else 'MISSING'}...")

        # 记录签名状态（用于日志诊断）
        if actual_signature is None:
            logger.info("Signature: MISSING (OZON test may include this scenario)")
        elif actual_signature.strip() == "":
            logger.info("Signature: EMPTY (OZON EMPTY_SIGN test scenario)")
        elif not actual_signature.replace("+", "").replace("/", "").replace("=", "").isalnum():
            logger.info(f"Signature: INVALID FORMAT (OZON INVALID_SIGN test scenario): {actual_signature[:30]}")
        else:
            logger.info(f"Signature: OK (base64 format)")

        # ========== 处理TYPE_PING等验证请求（无论签名如何，都返回200） ==========
        # 处理Ozon的webhook验证请求（PING）
        # Ozon在配置webhook时会发送ping/test/verification请求或TYPE_PING消息类型
        # 注意：OZON的测试包括EMPTY_SIGN、INVALID_SIGN等，都期望返回200 + 标准格式
        if event_type.lower() in ('ping', 'test', 'verification', 'type_ping'):
            logger.info(f"Received webhook verification request: {event_type}")
            # 回显签名、推送类型和时间
            return ozon_success_response(signature=actual_signature, push_type=event_type, request_time=request_time)

        # 从载荷中提取店铺信息
        # Ozon webhook通常在载荷中包含店铺标识信息
        # 注意：OZON的seller_id和client_id是同一个值，优先使用seller_id（webhook主要字段）
        shop_identifier = None
        if payload.get("seller_id"):
            shop_identifier = payload["seller_id"]
        elif payload.get("company_id"):
            shop_identifier = payload["company_id"]
        elif payload.get("client_id"):
            shop_identifier = payload["client_id"]

        if not shop_identifier:
            logger.error(f"Cannot identify shop from webhook payload: {payload}")
            # OZON期望即使无法识别店铺也返回200
            if is_ozon_request(headers):
                logger.warning("OZON request without shop identifier, returning 200 for compatibility")
                # 回显签名、推送类型和时间
                return ozon_success_response(signature=actual_signature, push_type=event_type, request_time=request_time)
            return ozon_error_response(
                status_code=400,
                error_code="ERROR_PARAMETER_VALUE_MISSED",
                message="Cannot identify shop from payload",
                details="Missing seller_id, company_id or client_id in payload"
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
                # 回显签名、推送类型和时间
                return ozon_success_response(signature=actual_signature, push_type=event_type, request_time=request_time)
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
        # event_type可能来自X-Event-Type头或payload的message_type字段
        logger.info(f"Processing webhook event: type={event_type}, shop_id={shop.id}, event_id={x_event_id}")

        result = await webhook_handler.handle_webhook(
            event_type=event_type,  # 使用提取出的event_type（支持TYPE_*格式）
            payload=payload,
            headers=headers,
            raw_body=raw_body
        )

        # 记录处理结果
        if result.get("success"):
            logger.info(f"Webhook processed successfully: {result}")
            # 按OZON规范：成功处理返回 HTTP 200 + {result, body, sign, push_type, time}
            return ozon_success_response(signature=actual_signature, push_type=event_type, request_time=request_time)
        else:
            logger.error(f"Webhook processing failed: {result}")

            # 按OZON API规范：处理失败应返回 HTTP 4xx/5xx + {error: {code, message, details}}
            # 参考文档：section/如果有一个错误
            error_message = result.get("error", "Processing failed")

            # 签名验证失败 → 401
            if "signature" in error_message.lower():
                return ozon_error_response(
                    status_code=401,
                    error_code="ERROR_UNKNOWN",
                    message="Invalid webhook signature",
                    details=error_message
                )

            # 其他处理失败 → 500
            return ozon_error_response(
                status_code=500,
                error_code="ERROR_UNKNOWN",
                message="Webhook processing failed",
                details=error_message
            )

    except Exception as e:
        logger.error(f"Unexpected error processing webhook: {e}")
        import traceback
        logger.error(traceback.format_exc())

        # 按OZON API规范：意外错误返回 HTTP 5xx + {error: {code, message, details}}
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
        event.processed_at = utcnow()
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