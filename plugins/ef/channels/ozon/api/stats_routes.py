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
from ..models.global_settings import OzonGlobalSetting
from sqlalchemy import select, or_

router = APIRouter(tags=["ozon-stats"])
logger = logging.getLogger(__name__)


async def get_global_timezone(db: AsyncSession) -> str:
    """
    获取全局时区设置

    Returns:
        str: 时区名称（如 "Europe/Moscow"），默认 "UTC"
    """
    try:
        result = await db.execute(
            select(OzonGlobalSetting).where(OzonGlobalSetting.setting_key == "default_timezone")
        )
        setting = result.scalar_one_or_none()
        if setting and setting.setting_value:
            # setting_value 是 JSONB: {"value": "Europe/Moscow"}
            return setting.setting_value.get("value", "UTC")
        return "UTC"
    except Exception as e:
        logger.warning(f"Failed to get global timezone: {e}, using UTC as fallback")
        return "UTC"


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
    from sqlalchemy import select, func, or_
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

        # 订单统计（全部基于 Posting，使用 OZON 原生状态）
        # Total: 所有 posting（不包括 cancelled）
        order_total_result = await db.execute(
            select(func.count(OzonPosting.id))
            .where(OzonPosting.status != 'cancelled', *posting_filter)
        )
        order_total = order_total_result.scalar() or 0

        # Pending: 等待备货（与打包发货页面的"等待备货"标签逻辑完全一致）
        # OZON状态：awaiting_packaging 或 awaiting_registration
        # 操作状态：NULL 或 awaiting_stock
        # 排除：OZON已取消 + 操作状态为cancelled
        order_pending_result = await db.execute(
            select(func.count(OzonPosting.id))
            .where(
                OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration']),
                OzonPosting.status != 'cancelled',
                or_(
                    OzonPosting.operation_status.is_(None),
                    OzonPosting.operation_status == 'awaiting_stock'
                ),
                OzonPosting.operation_status != 'cancelled',
                *posting_filter
            )
        )
        order_pending = order_pending_result.scalar() or 0

        # Processing: 等待交付（已进入分配/打印等后续流程的）
        # 包括已分配、打印完成等状态的 awaiting_deliver
        order_processing_result = await db.execute(
            select(func.count(OzonPosting.id))
            .where(
                OzonPosting.status == 'awaiting_deliver',
                *posting_filter
            )
        )
        order_processing = order_processing_result.scalar() or 0

        # Shipped: 配送中
        order_shipped_result = await db.execute(
            select(func.count(OzonPosting.id))
            .where(OzonPosting.status == 'delivering', *posting_filter)
        )
        order_shipped = order_shipped_result.scalar() or 0

        # Delivered: 已送达
        order_delivered_result = await db.execute(
            select(func.count(OzonPosting.id))
            .where(OzonPosting.status == 'delivered', *posting_filter)
        )
        order_delivered = order_delivered_result.scalar() or 0

        # Cancelled: 已取消
        order_cancelled_result = await db.execute(
            select(func.count(OzonPosting.id))
            .where(OzonPosting.status == 'cancelled', *posting_filter)
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

        # 收入统计（昨日、本周、本月）- 按全局时区计算时间范围
        # 1. 获取全局时区
        global_timezone = await get_global_timezone(db)

        # 2. 获取全局时区的当前时间
        from datetime import datetime, timezone as dt_timezone
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(global_timezone)
        now_in_tz = datetime.now(tz)

        # 3. 计算全局时区的时间范围起点（00:00:00）
        today_start_tz = now_in_tz.replace(hour=0, minute=0, second=0, microsecond=0)
        yesterday_start_tz = today_start_tz - timedelta(days=1)
        week_start_tz = today_start_tz - timedelta(days=now_in_tz.weekday())
        month_start_tz = today_start_tz.replace(day=1)

        # 4. 转换为 UTC（用于数据库查询）
        today_start = today_start_tz.astimezone(dt_timezone.utc)
        yesterday_start = yesterday_start_tz.astimezone(dt_timezone.utc)
        week_start = week_start_tz.astimezone(dt_timezone.utc)
        month_start = month_start_tz.astimezone(dt_timezone.utc)

        # 昨日收入（从raw_payload的products列表计算）
        # ⚠️ 重要：使用 OzonPosting.in_process_at 而不是 OzonOrder.ordered_at
        # 原因：与柱状图的查询条件保持一致，确保"昨日销售额"和柱状图的"昨天"数据相同
        # OZON API不返回total_price，需要从products中计算：price * quantity
        yesterday_postings_result = await db.execute(
            select(OzonOrder.raw_payload)
            .join(OzonPosting, OzonOrder.id == OzonPosting.order_id)
            .where(
                OzonPosting.in_process_at >= yesterday_start,
                OzonPosting.in_process_at < today_start,
                OzonPosting.status != 'cancelled',  # 排除已取消的订单
                OzonPosting.in_process_at.isnot(None),  # 必须有下单时间
                *posting_filter
            )
        )
        yesterday_orders = yesterday_postings_result.scalars().all()

        # 计算昨日总收入（从products列表中计算）
        yesterday_revenue = Decimal('0')
        for order_payload in yesterday_orders:
            if order_payload and 'products' in order_payload:
                products = order_payload.get('products', [])
                for product in products:
                    price = Decimal(str(product.get('price', '0')))
                    quantity = int(product.get('quantity', 0))
                    yesterday_revenue += price * quantity

        # 本周收入（从raw_payload的products列表计算）
        week_orders_result = await db.execute(
            select(OzonOrder.raw_payload)
            .where(
                OzonOrder.created_at >= week_start,
                OzonOrder.status.in_(['delivered', 'shipped']),
                *order_filter
            )
        )
        week_orders = week_orders_result.scalars().all()

        week_revenue = Decimal('0')
        for order_payload in week_orders:
            if order_payload and 'products' in order_payload:
                products = order_payload.get('products', [])
                for product in products:
                    price = Decimal(str(product.get('price', '0')))
                    quantity = int(product.get('quantity', 0))
                    week_revenue += price * quantity

        # 本月收入（从raw_payload的products列表计算）
        month_orders_result = await db.execute(
            select(OzonOrder.raw_payload)
            .where(
                OzonOrder.created_at >= month_start,
                OzonOrder.status.in_(['delivered', 'shipped']),
                *order_filter
            )
        )
        month_orders = month_orders_result.scalars().all()

        month_revenue = Decimal('0')
        for order_payload in month_orders:
            if order_payload and 'products' in order_payload:
                products = order_payload.get('products', [])
                for product in products:
                    price = Decimal(str(product.get('price', '0')))
                    quantity = int(product.get('quantity', 0))
                    month_revenue += price * quantity

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


@router.get("/daily-posting-stats")
async def get_daily_posting_stats(
    shop_id: Optional[int] = Query(None, description="店铺ID，为空时获取所有店铺统计"),
    range_type: Optional[str] = Query(None, description="时间范围类型：7days/14days/thisMonth/lastMonth/custom"),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD（仅 range_type=custom 时使用）"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD（仅 range_type=custom 时使用）"),
    db: AsyncSession = Depends(get_async_session),
    current_user = Depends(get_current_user_flexible)
):
    """
    获取每日posting统计数据（按店铺分组）

    Args:
        shop_id: 店铺ID，可选
        range_type: 时间范围类型（后端根据用户时区计算日期）
        start_date: 开始日期（仅 custom 模式）
        end_date: 结束日期（仅 custom 模式）
        db: 数据库会话
        current_user: 当前用户

    Returns:
        每日每个店铺的posting数量统计
    """
    from ..models import OzonPosting, OzonShop
    from sqlalchemy import select, func, and_, cast, Date
    from .permissions import filter_by_shop_permission
    from datetime import date

    # 权限验证
    try:
        allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    # 获取全局时区设置
    global_timezone = await get_global_timezone(db)

    try:
        # 根据 range_type 和用户时区计算日期范围
        from datetime import datetime
        from zoneinfo import ZoneInfo

        tz = ZoneInfo(global_timezone)
        now_in_tz = datetime.now(tz)

        if range_type == '7days':
            end_date_obj = now_in_tz.date()
            start_date_obj = end_date_obj - timedelta(days=6)
        elif range_type == '14days':
            end_date_obj = now_in_tz.date()
            start_date_obj = end_date_obj - timedelta(days=13)
        elif range_type == 'thisMonth':
            # 本月1日到今天（用户时区）
            end_date_obj = now_in_tz.date()
            start_date_obj = now_in_tz.replace(day=1).date()
        elif range_type == 'lastMonth':
            # 上月1日到上月最后一天（用户时区）
            first_day_of_this_month = now_in_tz.replace(day=1)
            last_day_of_last_month = first_day_of_this_month - timedelta(days=1)
            first_day_of_last_month = last_day_of_last_month.replace(day=1)
            start_date_obj = first_day_of_last_month.date()
            end_date_obj = last_day_of_last_month.date()
        elif range_type == 'custom' and start_date and end_date:
            # 自定义日期范围（前端传入的是日期字符串，后端按用户时区解析）
            start_date_dt = datetime.strptime(start_date, '%Y-%m-%d').replace(tzinfo=tz)
            end_date_dt = datetime.strptime(end_date, '%Y-%m-%d').replace(tzinfo=tz)
            start_date_obj = start_date_dt.date()
            end_date_obj = end_date_dt.date()
        else:
            # 默认7天
            end_date_obj = now_in_tz.date()
            start_date_obj = end_date_obj - timedelta(days=6)

        # 计算UTC时间范围（用于数据库查询）
        # 将用户时区的日期范围转换为UTC时间戳
        # 转换为用户时区的datetime（00:00:00）
        start_datetime = datetime.combine(start_date_obj, datetime.min.time()).replace(tzinfo=tz)
        # 转换为用户时区的datetime（23:59:59）
        end_datetime = datetime.combine(end_date_obj, datetime.max.time()).replace(tzinfo=tz)

        # 转换为UTC
        from datetime import timezone as dt_timezone
        start_datetime_utc = start_datetime.astimezone(dt_timezone.utc)
        end_datetime_utc = end_datetime.astimezone(dt_timezone.utc)

        # 构建查询条件（使用UTC时间戳范围）
        posting_filter = [
            OzonPosting.status != 'cancelled',  # 根据 ozon status 排除取消的订单
            OzonPosting.in_process_at.isnot(None),  # 必须有下单时间
            OzonPosting.in_process_at >= start_datetime_utc,
            OzonPosting.in_process_at <= end_datetime_utc
        ]

        # 如果指定了店铺，添加店铺过滤
        if shop_id:
            posting_filter.append(OzonPosting.shop_id == shop_id)
        elif allowed_shop_ids:
            # 如果没有指定店铺但有权限限制，使用权限列表
            posting_filter.append(OzonPosting.shop_id.in_(allowed_shop_ids))

        # 查询posting数据（不在数据库层面按日期分组，而是查询完整时间戳）
        stats_result = await db.execute(
            select(
                OzonPosting.in_process_at,
                OzonPosting.shop_id
            )
            .where(and_(*posting_filter))
            .order_by(OzonPosting.in_process_at)
        )
        stats_rows = stats_result.all()

        # 获取所有涉及的店铺信息
        shop_ids = list(set([row.shop_id for row in stats_rows]))
        if shop_ids:
            shops_result = await db.execute(
                select(OzonShop.id, OzonShop.shop_name)
                .where(OzonShop.id.in_(shop_ids))
            )
            shops_data = {shop.id: shop.shop_name for shop in shops_result.all()}
        else:
            shops_data = {}

        # 组织数据结构
        # 1. 按日期分组（在Python中转换时区后分组）
        daily_stats = {}
        for row in stats_rows:
            # 将UTC时间转换为全局时区
            in_process_at_tz = row.in_process_at.astimezone(tz)
            # 提取日期
            date_str = in_process_at_tz.date().isoformat()

            if date_str not in daily_stats:
                daily_stats[date_str] = {}
            shop_name = shops_data.get(row.shop_id, f"店铺{row.shop_id}")

            # 统计数量
            if shop_name not in daily_stats[date_str]:
                daily_stats[date_str][shop_name] = 0
            daily_stats[date_str][shop_name] += 1

        # 2. 生成完整的日期序列（填充缺失日期）
        all_dates = []
        current_date = start_date_obj
        while current_date <= end_date_obj:
            date_str = current_date.isoformat()
            all_dates.append(date_str)
            if date_str not in daily_stats:
                daily_stats[date_str] = {}
            current_date += timedelta(days=1)

        # 3. 获取所有店铺名称列表
        shop_names = sorted(set(shops_data.values()))

        # 4. 确保每个日期都有所有店铺的数据（缺失的填0）
        for date_str in all_dates:
            for shop_name in shop_names:
                if shop_name not in daily_stats[date_str]:
                    daily_stats[date_str][shop_name] = 0

        # 计算实际天数
        actual_days = (end_date_obj - start_date_obj).days + 1

        return {
            "dates": all_dates,
            "shops": shop_names,
            "data": daily_stats,
            "total_days": actual_days
        }

    except Exception as e:
        logger.error(f"Failed to get daily posting stats: {e}")
        raise HTTPException(status_code=500, detail=f"获取每日统计失败: {str(e)}")


@router.get("/daily-revenue-stats")
async def get_daily_revenue_stats(
    shop_id: Optional[int] = Query(None, description="店铺ID，为空时获取所有店铺统计"),
    range_type: Optional[str] = Query(None, description="时间范围类型：7days/14days/thisMonth/lastMonth/custom"),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD（仅 range_type=custom 时使用）"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD（仅 range_type=custom 时使用）"),
    db: AsyncSession = Depends(get_async_session),
    current_user = Depends(get_current_user_flexible)
):
    """
    获取每日销售额统计数据（按店铺分组，RUB货币）

    Args:
        shop_id: 店铺ID，可选
        range_type: 时间范围类型（后端根据用户时区计算日期）
        start_date: 开始日期（仅 custom 模式）
        end_date: 结束日期（仅 custom 模式）
        db: 数据库会话
        current_user: 当前用户

    Returns:
        每日每个店铺的销售额统计（RUB）
    """
    from ..models import OzonPosting, OzonShop, OzonOrder
    from sqlalchemy import select, and_
    from .permissions import filter_by_shop_permission

    # 权限验证
    try:
        allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    # 获取全局时区设置
    global_timezone = await get_global_timezone(db)

    try:
        # 根据 range_type 和用户时区计算日期范围
        from datetime import datetime
        from zoneinfo import ZoneInfo

        tz = ZoneInfo(global_timezone)
        now_in_tz = datetime.now(tz)

        if range_type == '7days':
            end_date_obj = now_in_tz.date()
            start_date_obj = end_date_obj - timedelta(days=6)
        elif range_type == '14days':
            end_date_obj = now_in_tz.date()
            start_date_obj = end_date_obj - timedelta(days=13)
        elif range_type == 'thisMonth':
            # 本月1日到今天（用户时区）
            end_date_obj = now_in_tz.date()
            start_date_obj = now_in_tz.replace(day=1).date()
        elif range_type == 'lastMonth':
            # 上月1日到上月最后一天（用户时区）
            first_day_of_this_month = now_in_tz.replace(day=1)
            last_day_of_last_month = first_day_of_this_month - timedelta(days=1)
            first_day_of_last_month = last_day_of_last_month.replace(day=1)
            start_date_obj = first_day_of_last_month.date()
            end_date_obj = last_day_of_last_month.date()
        elif range_type == 'custom' and start_date and end_date:
            # 自定义日期范围（前端传入的是日期字符串，后端按用户时区解析）
            start_date_dt = datetime.strptime(start_date, '%Y-%m-%d').replace(tzinfo=tz)
            end_date_dt = datetime.strptime(end_date, '%Y-%m-%d').replace(tzinfo=tz)
            start_date_obj = start_date_dt.date()
            end_date_obj = end_date_dt.date()
        else:
            # 默认7天
            end_date_obj = now_in_tz.date()
            start_date_obj = end_date_obj - timedelta(days=6)

        # 计算UTC时间范围（用于数据库查询）
        # 将用户时区的日期范围转换为UTC时间戳
        # 转换为用户时区的datetime（00:00:00）
        start_datetime = datetime.combine(start_date_obj, datetime.min.time()).replace(tzinfo=tz)
        # 转换为用户时区的datetime（23:59:59）
        end_datetime = datetime.combine(end_date_obj, datetime.max.time()).replace(tzinfo=tz)

        # 转换为UTC
        from datetime import timezone as dt_timezone
        start_datetime_utc = start_datetime.astimezone(dt_timezone.utc)
        end_datetime_utc = end_datetime.astimezone(dt_timezone.utc)

        # 构建查询条件（使用UTC时间戳范围）
        posting_filter = [
            OzonPosting.status != 'cancelled',  # 根据 ozon status 排除取消的订单
            OzonPosting.in_process_at.isnot(None),  # 必须有下单时间
            OzonPosting.in_process_at >= start_datetime_utc,
            OzonPosting.in_process_at <= end_datetime_utc
        ]

        # 如果指定了店铺，添加店铺过滤
        if shop_id:
            posting_filter.append(OzonPosting.shop_id == shop_id)
        elif allowed_shop_ids:
            # 如果没有指定店铺但有权限限制，使用权限列表
            posting_filter.append(OzonPosting.shop_id.in_(allowed_shop_ids))

        # 查询posting和order数据（JOIN获取raw_payload）
        stats_result = await db.execute(
            select(
                OzonPosting.in_process_at,
                OzonPosting.shop_id,
                OzonOrder.raw_payload
            )
            .join(OzonOrder, OzonPosting.order_id == OzonOrder.id)
            .where(and_(*posting_filter))
            .order_by(OzonPosting.in_process_at)
        )
        stats_rows = stats_result.all()

        # 获取所有涉及的店铺信息
        shop_ids = list(set([row.shop_id for row in stats_rows]))
        if shop_ids:
            shops_result = await db.execute(
                select(OzonShop.id, OzonShop.shop_name)
                .where(OzonShop.id.in_(shop_ids))
            )
            shops_data = {shop.id: shop.shop_name for shop in shops_result.all()}
        else:
            shops_data = {}

        # 组织数据结构
        # 1. 按日期分组，计算每日销售额（在Python中转换时区后分组）
        daily_stats = {}
        for row in stats_rows:
            # 将UTC时间转换为全局时区
            in_process_at_tz = row.in_process_at.astimezone(tz)
            # 提取日期
            date_str = in_process_at_tz.date().isoformat()

            if date_str not in daily_stats:
                daily_stats[date_str] = {}
            shop_name = shops_data.get(row.shop_id, f"店铺{row.shop_id}")

            # 计算该订单的销售额（从raw_payload的products列表计算）
            order_revenue = Decimal('0')
            if row.raw_payload and 'products' in row.raw_payload:
                products = row.raw_payload.get('products', [])
                for product in products:
                    price = Decimal(str(product.get('price', '0')))
                    quantity = int(product.get('quantity', 0))
                    order_revenue += price * quantity

            # 累加到店铺的当日销售额
            if shop_name not in daily_stats[date_str]:
                daily_stats[date_str][shop_name] = Decimal('0')
            daily_stats[date_str][shop_name] += order_revenue

        # 2. 生成完整的日期序列（填充缺失日期）
        all_dates = []
        current_date = start_date_obj
        while current_date <= end_date_obj:
            date_str = current_date.isoformat()
            all_dates.append(date_str)
            if date_str not in daily_stats:
                daily_stats[date_str] = {}
            current_date += timedelta(days=1)

        # 3. 获取所有店铺名称列表
        shop_names = sorted(set(shops_data.values()))

        # 4. 确保每个日期都有所有店铺的数据（缺失的填0）并转换为字符串
        for date_str in all_dates:
            for shop_name in shop_names:
                if shop_name not in daily_stats[date_str]:
                    daily_stats[date_str][shop_name] = "0"
                else:
                    # 将Decimal转换为字符串（保持精度）
                    daily_stats[date_str][shop_name] = str(daily_stats[date_str][shop_name])

        # 计算实际天数
        actual_days = (end_date_obj - start_date_obj).days + 1

        return {
            "dates": all_dates,
            "shops": shop_names,
            "data": daily_stats,
            "total_days": actual_days,
            "currency": "RUB"  # 标注货币单位为RUB
        }

    except Exception as e:
        logger.error(f"Failed to get daily revenue stats: {e}")
        raise HTTPException(status_code=500, detail=f"获取每日销售额统计失败: {str(e)}")


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
