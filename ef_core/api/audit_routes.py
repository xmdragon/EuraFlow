"""
审计日志 API 路由
提供 Webhook 通知日志和用户操作日志的查询接口（仅管理员）
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.api.auth import get_current_user
from ef_core.models.users import User
from ef_core.models.audit_log import AuditLog
from plugins.ef.channels.ozon.models.sync import OzonWebhookEvent
from plugins.ef.channels.ozon.models import OzonShop
from .models import ApiResponse, PaginatedResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/audit", tags=["Audit Logs"])


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


# ========== Pydantic 模型 ==========

class WebhookLogItem(BaseModel):
    """Webhook 日志项"""
    id: int
    event_id: str
    event_type: str
    shop_id: int
    shop_name: Optional[str] = None
    status: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    posting_number: Optional[str] = None  # 如果 entity_type 是 posting，这里存放真实的 posting_number
    retry_count: int
    error_message: Optional[str] = None
    result_message: Optional[str] = None
    processing_duration_ms: Optional[int] = None
    created_at: str
    processed_at: Optional[str] = None

    class Config:
        from_attributes = True


class AuditLogItem(BaseModel):
    """用户操作日志项"""
    id: int
    user_id: int
    username: str
    module: str
    action: str
    action_display: Optional[str] = None
    table_name: str
    record_id: str
    changes: Optional[Dict[str, Any]] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    request_id: Optional[str] = None
    notes: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True


class WebhookLogDetail(BaseModel):
    """Webhook 日志详情（包含完整 payload 和 headers）"""
    id: int
    event_id: str
    event_type: str
    shop_id: int
    shop_name: Optional[str] = None
    payload: Dict[str, Any]
    headers: Optional[Dict[str, Any]] = None
    signature: Optional[str] = None
    is_verified: bool
    status: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    retry_count: int
    error_message: Optional[str] = None
    result_message: Optional[str] = None
    processing_duration_ms: Optional[int] = None
    idempotency_key: Optional[str] = None
    created_at: str
    updated_at: str
    processed_at: Optional[str] = None

    class Config:
        from_attributes = True


# ========== 权限检查装饰器 ==========

def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """仅管理员可访问的依赖项"""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="仅管理员可访问此功能"
        )
    return current_user


# ========== Webhook 日志 API ==========

@router.get("/webhooks/logs", response_model=ApiResponse[PaginatedResponse[WebhookLogItem]])
async def get_webhook_logs(
    shop_id: Optional[int] = Query(None, description="店铺ID"),
    event_type: Optional[str] = Query(None, description="事件类型"),
    status: Optional[str] = Query(None, description="状态（processed/failed/ignored）"),
    posting_number: Optional[str] = Query(None, description="货件编号（支持精确匹配和左匹配）"),
    start_date: Optional[datetime] = Query(None, description="开始时间"),
    end_date: Optional[datetime] = Query(None, description="结束时间"),
    cursor: Optional[int] = Query(None, description="游标（上一页最后一条的ID）"),
    page_size: int = Query(50, ge=1, le=200, description="每页大小"),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取 Webhook 通知日志

    权限：仅管理员
    分页：游标分页（基于 id 降序）
    默认时间范围：最近7天
    """
    try:
        # 默认时间范围：最近7天
        if not start_date:
            start_date = utcnow() - timedelta(days=7)
        if not end_date:
            end_date = utcnow()

        # 构建查询条件
        conditions = [
            OzonWebhookEvent.created_at >= start_date,
            OzonWebhookEvent.created_at <= end_date
        ]

        if shop_id:
            conditions.append(OzonWebhookEvent.shop_id == shop_id)
        if event_type:
            conditions.append(OzonWebhookEvent.event_type == event_type)
        if status:
            conditions.append(OzonWebhookEvent.status == status)

        # 货件编号搜索（支持精确匹配和左匹配）
        if posting_number:
            posting_number = posting_number.strip()
            dash_count = posting_number.count('-')
            if dash_count == 2:
                # 三段格式（48877976-5064-1）：精确匹配
                conditions.append(OzonWebhookEvent.entity_id == posting_number)
            elif dash_count == 1:
                # 两段格式（48877976-5064）：左匹配
                conditions.append(OzonWebhookEvent.entity_id.like(f"{posting_number}-%"))
            else:
                # 其他格式：精确匹配
                conditions.append(OzonWebhookEvent.entity_id == posting_number)

        # 游标分页
        if cursor:
            conditions.append(OzonWebhookEvent.id < cursor)

        # 构建查询（简化版：entity_id 已经是 posting_number）
        stmt = (
            select(
                OzonWebhookEvent,
                OzonShop.shop_name_cn
            )
            .outerjoin(OzonShop, OzonWebhookEvent.shop_id == OzonShop.id)
            .where(and_(*conditions))
            .order_by(desc(OzonWebhookEvent.id))
            .limit(page_size + 1)  # 多取一条判断是否有下一页
        )

        result = await db.execute(stmt)
        rows = result.all()

        # 判断是否有更多数据
        has_more = len(rows) > page_size
        items_data = rows[:page_size]

        # 构建响应
        items = []
        for webhook_event, shop_name in items_data:
            # 如果是 posting 类型，entity_id 就是 posting_number（已通过脚本修复）
            posting_number = webhook_event.entity_id if webhook_event.entity_type == "posting" else None

            items.append(WebhookLogItem(
                id=webhook_event.id,
                event_id=webhook_event.event_id,
                event_type=webhook_event.event_type,
                shop_id=webhook_event.shop_id,
                shop_name=shop_name or f"店铺{webhook_event.shop_id}",
                status=webhook_event.status,
                entity_type=webhook_event.entity_type,
                entity_id=webhook_event.entity_id,
                posting_number=posting_number,
                retry_count=webhook_event.retry_count,
                error_message=webhook_event.error_message,
                result_message=webhook_event.result_message,
                processing_duration_ms=webhook_event.processing_duration_ms,
                created_at=webhook_event.created_at.isoformat() if webhook_event.created_at else None,
                processed_at=webhook_event.processed_at.isoformat() if webhook_event.processed_at else None
            ))

        # 下一页游标
        next_cursor = str(items[-1].id) if has_more and items else None

        paginated_response = PaginatedResponse(
            items=items,
            total=None,  # 游标分页不提供总数
            page_size=page_size,
            offset=0,
            has_more=has_more,
            next_cursor=next_cursor
        )

        logger.info(
            f"Admin {current_user.username} 查询 Webhook 日志: "
            f"shop_id={shop_id}, event_type={event_type}, status={status}, "
            f"返回 {len(items)} 条记录"
        )

        return ApiResponse.success(paginated_response)

    except Exception as e:
        logger.error(f"查询 Webhook 日志失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")


@router.get("/webhooks/logs/{event_id}", response_model=ApiResponse[WebhookLogDetail])
async def get_webhook_log_detail(
    event_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取 Webhook 日志详情（包含完整 payload 和 headers）

    权限：仅管理员
    """
    try:
        stmt = (
            select(OzonWebhookEvent, OzonShop.shop_name_cn)
            .outerjoin(OzonShop, OzonWebhookEvent.shop_id == OzonShop.id)
            .where(OzonWebhookEvent.id == event_id)
        )
        result = await db.execute(stmt)
        row = result.first()

        if not row:
            raise HTTPException(status_code=404, detail="Webhook 日志不存在")

        webhook_event, shop_name = row

        detail = WebhookLogDetail(
            id=webhook_event.id,
            event_id=webhook_event.event_id,
            event_type=webhook_event.event_type,
            shop_id=webhook_event.shop_id,
            shop_name=shop_name or f"店铺{webhook_event.shop_id}",
            payload=webhook_event.payload or {},
            headers=webhook_event.headers or {},
            signature=webhook_event.signature,
            is_verified=webhook_event.is_verified,
            status=webhook_event.status,
            entity_type=webhook_event.entity_type,
            entity_id=webhook_event.entity_id,
            retry_count=webhook_event.retry_count,
            error_message=webhook_event.error_message,
            result_message=webhook_event.result_message,
            processing_duration_ms=webhook_event.processing_duration_ms,
            idempotency_key=webhook_event.idempotency_key,
            created_at=webhook_event.created_at.isoformat() if webhook_event.created_at else None,
            updated_at=webhook_event.updated_at.isoformat() if webhook_event.updated_at else None,
            processed_at=webhook_event.processed_at.isoformat() if webhook_event.processed_at else None
        )

        logger.info(f"Admin {current_user.username} 查看 Webhook 日志详情: event_id={event_id}")

        return ApiResponse.success(detail)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"查询 Webhook 日志详情失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")


# ========== 用户操作日志 API ==========

@router.get("/logs", response_model=ApiResponse[PaginatedResponse[AuditLogItem]])
async def get_audit_logs(
    user_id: Optional[int] = Query(None, description="用户ID"),
    module: Optional[str] = Query(None, description="模块（ozon/finance/user/system）"),
    action: Optional[str] = Query(None, description="操作类型（create/update/delete/print）"),
    table_name: Optional[str] = Query(None, description="表名"),
    start_date: Optional[datetime] = Query(None, description="开始时间"),
    end_date: Optional[datetime] = Query(None, description="结束时间"),
    cursor: Optional[int] = Query(None, description="游标（上一页最后一条的ID）"),
    page_size: int = Query(50, ge=1, le=200, description="每页大小"),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取用户操作日志

    权限：仅管理员
    分页：游标分页（基于 id 降序）
    默认时间范围：最近30天
    """
    try:
        # 默认时间范围：最近30天
        if not start_date:
            start_date = utcnow() - timedelta(days=30)
        if not end_date:
            end_date = utcnow()

        # 构建查询条件
        conditions = [
            AuditLog.created_at >= start_date,
            AuditLog.created_at <= end_date
        ]

        if user_id:
            conditions.append(AuditLog.user_id == user_id)
        if module:
            conditions.append(AuditLog.module == module)
        if action:
            conditions.append(AuditLog.action == action)
        if table_name:
            conditions.append(AuditLog.table_name == table_name)

        # 游标分页
        if cursor:
            conditions.append(AuditLog.id < cursor)

        # 构建查询
        stmt = (
            select(AuditLog)
            .where(and_(*conditions))
            .order_by(desc(AuditLog.id))
            .limit(page_size + 1)  # 多取一条判断是否有下一页
        )

        result = await db.execute(stmt)
        rows = result.scalars().all()

        # 判断是否有更多数据
        has_more = len(rows) > page_size
        items_data = rows[:page_size]

        # 构建响应
        items = []
        for audit_log in items_data:
            items.append(AuditLogItem(
                id=audit_log.id,
                user_id=audit_log.user_id,
                username=audit_log.username,
                module=audit_log.module,
                action=audit_log.action,
                action_display=audit_log.action_display,
                table_name=audit_log.table_name,
                record_id=audit_log.record_id,
                changes=audit_log.changes,
                ip_address=str(audit_log.ip_address) if audit_log.ip_address else None,
                user_agent=audit_log.user_agent,
                request_id=audit_log.request_id,
                notes=audit_log.notes,
                created_at=audit_log.created_at.isoformat() if audit_log.created_at else None
            ))

        # 下一页游标
        next_cursor = str(items[-1].id) if has_more and items else None

        paginated_response = PaginatedResponse(
            items=items,
            total=None,  # 游标分页不提供总数
            page_size=page_size,
            offset=0,
            has_more=has_more,
            next_cursor=next_cursor
        )

        logger.info(
            f"Admin {current_user.username} 查询用户操作日志: "
            f"user_id={user_id}, module={module}, action={action}, "
            f"返回 {len(items)} 条记录"
        )

        return ApiResponse.success(paginated_response)

    except Exception as e:
        logger.error(f"查询用户操作日志失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")


# ========== 统计 API（可选） ==========

@router.get("/stats", response_model=ApiResponse[Dict[str, Any]])
async def get_audit_stats(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取日志统计数据（最近7天）

    权限：仅管理员
    """
    try:
        seven_days_ago = utcnow() - timedelta(days=7)

        # Webhook 日志统计
        webhook_total_stmt = select(func.count(OzonWebhookEvent.id)).where(
            OzonWebhookEvent.created_at >= seven_days_ago
        )
        webhook_success_stmt = select(func.count(OzonWebhookEvent.id)).where(
            and_(
                OzonWebhookEvent.created_at >= seven_days_ago,
                OzonWebhookEvent.status == "processed"
            )
        )
        webhook_failed_stmt = select(func.count(OzonWebhookEvent.id)).where(
            and_(
                OzonWebhookEvent.created_at >= seven_days_ago,
                OzonWebhookEvent.status == "failed"
            )
        )

        webhook_total = await db.scalar(webhook_total_stmt) or 0
        webhook_success = await db.scalar(webhook_success_stmt) or 0
        webhook_failed = await db.scalar(webhook_failed_stmt) or 0

        # 用户操作日志统计
        audit_total_stmt = select(func.count(AuditLog.id)).where(
            AuditLog.created_at >= seven_days_ago
        )
        audit_total = await db.scalar(audit_total_stmt) or 0

        # Top 操作用户
        top_users_stmt = (
            select(AuditLog.username, func.count(AuditLog.id).label("count"))
            .where(AuditLog.created_at >= seven_days_ago)
            .group_by(AuditLog.username)
            .order_by(desc("count"))
            .limit(5)
        )
        top_users_result = await db.execute(top_users_stmt)
        top_users = [
            {"username": row[0], "count": row[1]}
            for row in top_users_result.all()
        ]

        stats = {
            "webhook_logs": {
                "total": webhook_total,
                "success": webhook_success,
                "failed": webhook_failed,
                "success_rate": round(webhook_success / webhook_total * 100, 2) if webhook_total > 0 else 0
            },
            "audit_logs": {
                "total": audit_total
            },
            "top_users": top_users,
            "period": "最近7天"
        }

        logger.info(f"Admin {current_user.username} 查看日志统计")

        return ApiResponse.success(stats)

    except Exception as e:
        logger.error(f"查询日志统计失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")
