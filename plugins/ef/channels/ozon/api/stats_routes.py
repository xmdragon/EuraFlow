"""
统计和工具 API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from typing import Optional, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from decimal import Decimal
from datetime import timedelta
import logging

from ef_core.database import get_async_session
from ef_core.api.auth import get_current_user_flexible
from ..utils.datetime_utils import utcnow

router = APIRouter(tags=["ozon-stats"])
logger = logging.getLogger(__name__)


@router.get("/sync-logs")
async def get_sync_logs(
    shop_id: Optional[int] = Query(None, description="店铺ID"),
    entity_type: Optional[str] = Query(None, description="实体类型"),
    status: Optional[str] = Query(None, description="状态"),
    limit: int = Query(20, ge=1, le=100, description="返回数量"),
    offset: int = Query(0, ge=0, description="偏移量"),
    session: AsyncSession = Depends(get_async_session)
):
    """
    获取同步日志

    Args:
        shop_id: 店铺ID筛选
        entity_type: 实体类型筛选 (products/orders/postings/inventory)
        status: 状态筛选 (started/success/failed/partial)
        limit: 返回数量
        offset: 偏移量

    Returns:
        同步日志列表
    """
    from ..models.sync import OzonSyncLog
    from sqlalchemy import select, desc, and_, func

    try:
        # 构建查询条件
        conditions = []
        if shop_id:
            conditions.append(OzonSyncLog.shop_id == shop_id)
        if entity_type:
            conditions.append(OzonSyncLog.entity_type == entity_type)
        if status:
            conditions.append(OzonSyncLog.status == status)

        # 查询总数
        count_stmt = select(func.count()).select_from(OzonSyncLog)
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        total = await session.scalar(count_stmt)

        # 查询数据
        stmt = select(OzonSyncLog)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(desc(OzonSyncLog.started_at))
        stmt = stmt.limit(limit).offset(offset)

        result = await session.execute(stmt)
        logs = result.scalars().all()

        # 转换为活动记录格式
        activities = []
        for log in logs:
            # 根据实体类型和状态生成描述
            action_map = {
                "products": "商品",
                "orders": "订单",
                "postings": "发货单",
                "inventory": "库存"
            }

            status_map = {
                "started": "开始",
                "success": "成功",
                "failed": "失败",
                "partial": "部分成功"
            }

            entity_name = action_map.get(log.entity_type, log.entity_type)
            status_name = status_map.get(log.status, log.status)

            # 生成内容描述
            if log.status == "success":
                content = f"{entity_name}同步成功，处理 {log.processed_count} 条记录"
            elif log.status == "failed":
                content = f"{entity_name}同步失败: {log.error_message or '未知错误'}"
            elif log.status == "partial":
                content = f"{entity_name}部分同步，成功 {log.success_count}/{log.processed_count} 条"
            else:
                content = f"{entity_name}同步{status_name}"

            # 计算相对时间
            time_diff = utcnow() - log.started_at
            if time_diff.days > 0:
                time_str = f"{time_diff.days}天前"
            elif time_diff.seconds > 3600:
                time_str = f"{time_diff.seconds // 3600}小时前"
            elif time_diff.seconds > 60:
                time_str = f"{time_diff.seconds // 60}分钟前"
            else:
                time_str = "刚刚"

            activities.append({
                "id": log.id,
                "type": log.entity_type,
                "status": log.status,
                "content": content,
                "time": time_str,
                "details": {
                    "shop_id": log.shop_id,
                    "sync_type": log.sync_type,
                    "processed": log.processed_count,
                    "success": log.success_count,
                    "failed": log.failed_count,
                    "duration_ms": log.duration_ms,
                    "started_at": log.started_at.isoformat() if log.started_at else None,
                    "completed_at": log.completed_at.isoformat() if log.completed_at else None
                }
            })

        return {
            "activities": activities,
            "total": total,
            "limit": limit,
            "offset": offset
        }
    except Exception as e:
        logger.error(f"Failed to get sync logs: {e}")
        return {
            "activities": [],
            "total": 0,
            "limit": limit,
            "offset": offset,
            "error": str(e)
        }


@router.get("/statistics")
async def get_statistics(
    shop_id: Optional[int] = Query(None, description="店铺ID，为空时获取所有店铺统计"),
    db: AsyncSession = Depends(get_async_session),
    current_user = Depends(get_current_user_flexible)
):
    """
    获取统计数据

    Args:
        shop_id: 店铺ID，可选
        db: 数据库会话
        current_user: 当前用户

    Returns:
        统计数据

    权限控制：
    - admin: 可以访问所有店铺的统计
    - operator/viewer: 只能访问已授权店铺的统计
    """
    from ..models import OzonShop, OzonProduct, OzonOrder, OzonPosting
    from sqlalchemy import select, func
    from .permissions import filter_by_shop_permission

    # 权限验证
    try:
        allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    try:
        # 构建查询条件
        product_filter = []
        order_filter = []
        posting_filter = []

        if shop_id:
            product_filter.append(OzonProduct.shop_id == shop_id)
            order_filter.append(OzonOrder.shop_id == shop_id)
            posting_filter.append(OzonPosting.shop_id == shop_id)

        # 商品统计 - 使用新的5种状态
        product_total_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(*product_filter)
        )
        product_total = product_total_result.scalar() or 0

        # 统计各种状态的商品数量
        product_on_sale_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'on_sale', *product_filter)
        )
        product_on_sale = product_on_sale_result.scalar() or 0

        product_ready_to_sell_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'ready_to_sell', *product_filter)
        )
        product_ready_to_sell = product_ready_to_sell_result.scalar() or 0

        product_error_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'error', *product_filter)
        )
        product_error = product_error_result.scalar() or 0

        product_pending_modification_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'pending_modification', *product_filter)
        )
        product_pending_modification = product_pending_modification_result.scalar() or 0

        product_inactive_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'inactive', *product_filter)
        )
        product_inactive = product_inactive_result.scalar() or 0

        product_archived_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'archived', *product_filter)
        )
        product_archived = product_archived_result.scalar() or 0

        product_synced_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.sync_status == 'success', *product_filter)
        )
        product_synced = product_synced_result.scalar() or 0

        # 订单统计
        order_total_result = await db.execute(
            select(func.count(OzonOrder.id))
            .where(*order_filter)
        )
        order_total = order_total_result.scalar() or 0

        # 待处理订单改为统计"等待备货"状态的Posting数量
        order_pending_result = await db.execute(
            select(func.count(OzonPosting.id))
            .where(OzonPosting.status == 'awaiting_packaging', *posting_filter)
        )
        order_pending = order_pending_result.scalar() or 0

        order_processing_result = await db.execute(
            select(func.count(OzonOrder.id))
            .where(OzonOrder.status == 'processing', *order_filter)
        )
        order_processing = order_processing_result.scalar() or 0

        order_shipped_result = await db.execute(
            select(func.count(OzonOrder.id))
            .where(OzonOrder.status == 'shipped', *order_filter)
        )
        order_shipped = order_shipped_result.scalar() or 0

        order_delivered_result = await db.execute(
            select(func.count(OzonOrder.id))
            .where(OzonOrder.status == 'delivered', *order_filter)
        )
        order_delivered = order_delivered_result.scalar() or 0

        order_cancelled_result = await db.execute(
            select(func.count(OzonOrder.id))
            .where(OzonOrder.status == 'cancelled', *order_filter)
        )
        order_cancelled = order_cancelled_result.scalar() or 0

        # 按 OZON 状态统计订单数（Posting 级别）
        posting_stats_result = await db.execute(
            select(
                OzonPosting.status,
                func.count(OzonPosting.id).label('count')
            )
            .where(*posting_filter)
            .group_by(OzonPosting.status)
        )
        posting_stats_rows = posting_stats_result.all()

        # 转换为字典
        ozon_status_counts = {row.status: row.count for row in posting_stats_rows}

        # 收入统计（昨日、本周、本月）
        now = utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        yesterday_start = today_start - timedelta(days=1)
        week_start = today_start - timedelta(days=now.weekday())
        month_start = today_start.replace(day=1)

        # 昨日收入（按订单创建时间 ordered_at）
        yesterday_revenue_result = await db.execute(
            select(func.sum(OzonOrder.total_price))
            .where(
                OzonOrder.ordered_at >= yesterday_start,
                OzonOrder.ordered_at < today_start,
                *order_filter
            )
        )
        yesterday_revenue = yesterday_revenue_result.scalar() or Decimal('0')

        # 本周收入
        week_revenue_result = await db.execute(
            select(func.sum(OzonOrder.total_price))
            .where(
                OzonOrder.created_at >= week_start,
                OzonOrder.status.in_(['delivered', 'shipped']),
                *order_filter
            )
        )
        week_revenue = week_revenue_result.scalar() or Decimal('0')

        # 本月收入
        month_revenue_result = await db.execute(
            select(func.sum(OzonOrder.total_price))
            .where(
                OzonOrder.created_at >= month_start,
                OzonOrder.status.in_(['delivered', 'shipped']),
                *order_filter
            )
        )
        month_revenue = month_revenue_result.scalar() or Decimal('0')

        return {
            "products": {
                "total": product_total,
                "on_sale": product_on_sale,
                "ready_to_sell": product_ready_to_sell,
                "error": product_error,
                "pending_modification": product_pending_modification,
                "inactive": product_inactive,
                "archived": product_archived,
                "synced": product_synced
            },
            "orders": {
                "total": order_total,
                "pending": order_pending,
                "processing": order_processing,
                "shipped": order_shipped,
                "delivered": order_delivered,
                "cancelled": order_cancelled,
                "by_ozon_status": ozon_status_counts
            },
            "revenue": {
                "yesterday": str(yesterday_revenue),
                "week": str(week_revenue),
                "month": str(month_revenue)
            }
        }

    except Exception as e:
        logger.error(f"Failed to get statistics: {e}")
        raise HTTPException(status_code=500, detail=f"获取统计数据失败: {str(e)}")


@router.post("/test-connection")
async def test_connection(
    credentials: Dict[str, str] = Body(..., description="API凭证")
):
    """
    测试Ozon API连接

    Args:
        credentials: 包含client_id和api_key的字典

    Returns:
        连接测试结果
    """
    from ..api.client import OzonAPIClient

    try:
        client_id = credentials.get("client_id")
        api_key = credentials.get("api_key")

        if not client_id or not api_key:
            return {
                "success": False,
                "message": "缺少必要的API凭证"
            }

        # 创建临时客户端测试连接
        client = OzonAPIClient(client_id=client_id, api_key=api_key)

        # 调用测试连接方法
        result = await client.test_connection()

        await client.close()

        return result

    except Exception as e:
        logger.error(f"Connection test failed: {e}")
        return {
            "success": False,
            "message": f"连接测试失败: {str(e)}"
        }
