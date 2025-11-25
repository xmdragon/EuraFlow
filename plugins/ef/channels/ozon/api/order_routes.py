"""
订单管理 API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Body, Request
from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from decimal import Decimal
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.middleware.auth import require_role
from ef_core.api.auth import get_current_user_flexible
from ..models import OzonOrder, OzonPosting, OzonProduct, OzonDomesticTracking, OzonGlobalSetting
from ..utils.datetime_utils import utcnow, parse_date, parse_date_with_timezone, get_global_timezone
from sqlalchemy import delete
from .permissions import filter_by_shop_permission, build_shop_filter_condition

router = APIRouter(tags=["ozon-orders"])
logger = logging.getLogger(__name__)


@router.get("/orders")
async def get_orders(
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(50, le=1000, description="每页数量"),
    shop_id: Optional[int] = None,
    status: Optional[str] = None,
    operation_status: Optional[str] = None,
    posting_number: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """获取 Ozon 订单列表（页码分页），支持多种搜索条件

    注意：返回以Posting为粒度的数据，一个订单拆分成多个posting时会显示为多条记录

    权限控制：
    - admin: 可以访问所有店铺的订单
    - operator/viewer: 只能访问已授权店铺的订单
    """
    from datetime import datetime

    # 权限过滤：根据用户角色过滤店铺
    try:
        allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    # 获取全局时区设置（用于日期过滤）
    global_timezone = await get_global_timezone(db)

    # 构建查询：以Posting为主体（无需 JOIN Order，通过 selectinload 延迟加载）
    from sqlalchemy.orm import selectinload
    query = select(OzonPosting).options(
        selectinload(OzonPosting.packages),
        selectinload(OzonPosting.order).selectinload(OzonOrder.postings),  # 预加载order及其所有postings
        selectinload(OzonPosting.domestic_trackings)
    )

    # 应用权限过滤条件
    shop_filter = build_shop_filter_condition(OzonPosting, allowed_shop_ids)
    if shop_filter is not True:
        query = query.where(shop_filter)

    if status:
        # status参数应该按 Posting 的状态过滤（OZON 原生状态）
        # 因为同一个订单的不同 posting 可能有不同的状态
        query = query.where(OzonPosting.status == status)

    # 按 operation_status 过滤
    if operation_status:
        query = query.where(OzonPosting.operation_status == operation_status)

    # 搜索条件：posting_number（支持通配符）
    if posting_number:
        posting_number_value = posting_number.strip()
        if '%' in posting_number_value:
            # 包含通配符，使用 LIKE 模糊匹配
            query = query.where(OzonPosting.posting_number.like(posting_number_value))
        else:
            # 精确匹配
            query = query.where(OzonPosting.posting_number == posting_number_value)

    if date_from:
        try:
            # 按全局时区解析日期（用户选择的日期是在其时区的00:00:00）
            start_date = parse_date_with_timezone(date_from, global_timezone)
            if start_date:
                # 使用 in_process_at 替代 ordered_at（几乎一致，避免 JOIN 排序开销）
                query = query.where(OzonPosting.in_process_at >= start_date)
        except Exception as e:
            logger.warning(f"Failed to parse date_from: {date_from}, error: {e}")

    if date_to:
        try:
            # 按全局时区解析日期
            end_date = parse_date_with_timezone(date_to, global_timezone)
            if end_date:
                # 如果是纯日期格式，需要将时间设置为当天的23:59:59
                # parse_date_with_timezone返回的是用户时区当天00:00:00转换为UTC后的时间
                # 我们需要在此基础上加23小时59分59秒，得到当天23:59:59的UTC时间
                if 'T' not in date_to:
                    from datetime import timedelta
                    end_date = end_date + timedelta(hours=23, minutes=59, seconds=59, microseconds=999999)
                # 使用 in_process_at 替代 ordered_at（几乎一致，避免 JOIN 排序开销）
                query = query.where(OzonPosting.in_process_at <= end_date)
        except Exception as e:
            logger.warning(f"Failed to parse date_to: {date_to}, error: {e}")

    # 执行查询获取总数（无需 JOIN）
    count_query = select(func.count(OzonPosting.id))

    # 应用权限过滤条件（与主查询一致）
    if shop_filter is not True:
        count_query = count_query.where(shop_filter)
    if status:
        count_query = count_query.where(OzonPosting.status == status)
    if operation_status:
        count_query = count_query.where(OzonPosting.operation_status == operation_status)
    if posting_number:
        posting_number_value = posting_number.strip()
        if '%' in posting_number_value:
            count_query = count_query.where(OzonPosting.posting_number.like(posting_number_value))
        else:
            count_query = count_query.where(OzonPosting.posting_number == posting_number_value)
    if date_from:
        try:
            start_date = parse_date_with_timezone(date_from, global_timezone)
            if start_date:
                count_query = count_query.where(OzonPosting.in_process_at >= start_date)
        except:
            pass
    if date_to:
        try:
            end_date = parse_date_with_timezone(date_to, global_timezone)
            if end_date:
                if 'T' not in date_to:
                    from datetime import timedelta
                    end_date = end_date + timedelta(hours=23, minutes=59, seconds=59, microseconds=999999)
                count_query = count_query.where(OzonPosting.in_process_at <= end_date)
        except:
            pass

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 计算全局统计（所有状态，不受当前status筛选影响，但受日期筛选影响）
    # 应用权限过滤，包含所有状态的统计（无需 JOIN）
    stats_query = select(
        OzonPosting.status,
        func.count(OzonPosting.id).label('count')
    )
    # 应用权限过滤
    if shop_filter is not True:
        stats_query = stats_query.where(shop_filter)
    # 应用日期过滤（与主查询保持一致）- 使用 in_process_at
    if date_from:
        try:
            start_date = parse_date_with_timezone(date_from, global_timezone)
            if start_date:
                stats_query = stats_query.where(OzonPosting.in_process_at >= start_date)
        except:
            pass
    if date_to:
        try:
            end_date = parse_date_with_timezone(date_to, global_timezone)
            if end_date:
                if 'T' not in date_to:
                    from datetime import timedelta
                    end_date = end_date + timedelta(hours=23, minutes=59, seconds=59, microseconds=999999)
                stats_query = stats_query.where(OzonPosting.in_process_at <= end_date)
        except:
            pass
    stats_query = stats_query.group_by(OzonPosting.status)

    stats_result = await db.execute(stats_query)
    status_counts = {row.status: row.count for row in stats_result}

    # 查询"已废弃"posting数量（operation_status='cancelled'，无需 JOIN）
    discarded_query = select(func.count(OzonPosting.id))
    discarded_query = discarded_query.where(OzonPosting.operation_status == 'cancelled')
    # 应用权限过滤
    if shop_filter is not True:
        discarded_query = discarded_query.where(shop_filter)
    # 应用日期过滤（与主查询保持一致）- 使用 in_process_at
    if date_from:
        try:
            start_date = parse_date_with_timezone(date_from, global_timezone)
            if start_date:
                discarded_query = discarded_query.where(OzonPosting.in_process_at >= start_date)
        except:
            pass
    if date_to:
        try:
            end_date = parse_date_with_timezone(date_to, global_timezone)
            if end_date:
                if 'T' not in date_to:
                    from datetime import timedelta
                    end_date = end_date + timedelta(hours=23, minutes=59, seconds=59, microseconds=999999)
                discarded_query = discarded_query.where(OzonPosting.in_process_at <= end_date)
        except:
            pass

    discarded_result = await db.execute(discarded_query)
    discarded_count = discarded_result.scalar() or 0

    # 构建统计数据字典（使用OZON原生状态，所有统计均为 posting 数量）
    global_stats = {
        "total": sum(status_counts.values()),
        "discarded": discarded_count,  # 已废弃 posting（operation_status='cancelled'）
        "awaiting_packaging": status_counts.get('awaiting_packaging', 0),
        "awaiting_deliver": status_counts.get('awaiting_deliver', 0),
        "awaiting_registration": status_counts.get('awaiting_registration', 0),
        "delivering": status_counts.get('delivering', 0),
        "delivered": status_counts.get('delivered', 0),
        "cancelled": status_counts.get('cancelled', 0),
    }

    # 页码分页：按下单时间倒序（in_process_at ≈ ordered_at，避免 JOIN 排序开销）
    offset = (page - 1) * limit
    query = query.order_by(OzonPosting.in_process_at.desc(), OzonPosting.id.desc()).offset(offset).limit(limit)

    # 执行查询，获取Posting列表
    result = await db.execute(query)
    postings = result.scalars().all()

    logger.info(f"订单查询: total={total}, postings_count={len(postings)}, limit={limit}, page={page}, offset={offset}, status={status}, operation_status={operation_status}")

    # 提取所有posting中的offer_id
    all_offer_ids = set()
    for posting in postings:
        if posting.raw_payload and 'products' in posting.raw_payload:
            for product in posting.raw_payload['products']:
                if product.get('offer_id'):
                    all_offer_ids.add(product.get('offer_id'))

    # 批量查询商品图片（使用offer_id匹配）
    offer_id_images = {}
    if all_offer_ids:
        product_query = select(OzonProduct.offer_id, OzonProduct.images).where(
            OzonProduct.offer_id.in_(list(all_offer_ids))
        )
        if shop_id:
            product_query = product_query.where(OzonProduct.shop_id == shop_id)
        products_result = await db.execute(product_query)
        for offer_id, images in products_result:
            if offer_id and images:
                # 优先使用primary图片，否则使用第一张
                if isinstance(images, dict):
                    if images.get("primary"):
                        offer_id_images[offer_id] = images["primary"]
                    elif images.get("main") and isinstance(images["main"], list) and images["main"]:
                        offer_id_images[offer_id] = images["main"][0]
                elif isinstance(images, list) and images:
                    offer_id_images[offer_id] = images[0]

    # 构建返回数据：每个posting作为独立记录
    orders_data = []
    for posting in postings:
        # 使用关联的order对象构造完整数据
        order = posting.order
        if order:
            # 调用order.to_dict()，指定target_posting_number确保只返回当前posting的数据
            order_dict = order.to_dict(target_posting_number=posting.posting_number)
            # 移除 items（与 postings[].products 重复）
            order_dict.pop('items', None)
            orders_data.append(order_dict)

    # 计算总页数
    total_pages = (total + limit - 1) // limit if total > 0 else 1
    has_more = page < total_pages

    return {
        "data": orders_data,
        "total": total,
        "page": page,
        "page_size": limit,
        "total_pages": total_pages,
        "next_cursor": page + 1 if has_more else None,  # 兼容旧的游标字段，返回下一页页码
        "has_more": has_more,  # 是否还有更多数据
        "stats": global_stats,  # 全局统计数据
        "offer_id_images": offer_id_images  # 额外返回offer_id图片映射，前端可选使用
    }


@router.put("/orders/{posting_number}/extra-info")
async def update_order_extra_info(
    posting_number: str,
    request: Request,
    extra_info: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    更新货件额外信息（进货价格、国内运单号、材料费用、备注）（需要操作员权限）
    注意：这些字段是 posting 维度的数据，存储在 ozon_postings 表
    """
    from decimal import Decimal
    from ef_core.services.audit_service import AuditService
    from sqlalchemy.orm import selectinload

    # 通过 posting_number 查找 posting（预加载 domestic_trackings 关系）
    posting_result = await db.execute(
        select(OzonPosting)
        .options(selectinload(OzonPosting.domestic_trackings))
        .where(OzonPosting.posting_number == posting_number)
    )
    posting = posting_result.scalar_one_or_none()

    if not posting:
        raise HTTPException(status_code=404, detail="Posting not found")

    # 保存旧值（用于日志）
    old_purchase_price = posting.purchase_price
    old_material_cost = posting.material_cost
    old_tracking_numbers = posting.get_domestic_tracking_numbers()
    old_source_platform = posting.source_platform
    old_order_notes = posting.order_notes

    # 更新字段（智能检测值变化，只在真正变化时更新时间戳）
    try:
        # purchase_price - 带时间戳，需要比较旧值
        if "purchase_price" in extra_info:
            new_value = extra_info["purchase_price"]
            old_value = posting.purchase_price

            # 标准化新值：空字符串或None → None，有效字符串 → Decimal
            if new_value and str(new_value).strip():
                new_value_normalized = Decimal(str(new_value).strip())
            else:
                new_value_normalized = None

            # 只有当值真正变化时才更新字段和时间戳
            if new_value_normalized != old_value:
                posting.purchase_price = new_value_normalized
                posting.purchase_price_updated_at = utcnow()

        # domestic_tracking_number - 现在使用关联表存储多个单号
        # 为了向后兼容，接受单个字符串值，将其作为唯一的单号存储
        if "domestic_tracking_number" in extra_info:
            new_value = extra_info["domestic_tracking_number"]

            # 获取当前的所有单号
            current_numbers = posting.get_domestic_tracking_numbers()
            old_value = current_numbers[0] if current_numbers else None

            # 标准化新值：空字符串或None → None，有效字符串 → trim后的字符串
            if new_value and str(new_value).strip():
                new_value_normalized = str(new_value).strip()
            else:
                new_value_normalized = None

            # 只有当值真正变化时才更新
            if new_value_normalized != old_value:
                # 删除所有现有的国内单号
                await db.execute(
                    delete(OzonDomesticTracking).where(
                        OzonDomesticTracking.posting_id == posting.id
                    )
                )

                # 如果有新值，创建新记录
                if new_value_normalized:
                    new_tracking = OzonDomesticTracking(
                        posting_id=posting.id,
                        tracking_number=new_value_normalized,
                        created_at=utcnow()
                    )
                    db.add(new_tracking)

        # material_cost - 无时间戳，直接更新
        if "material_cost" in extra_info:
            value = extra_info["material_cost"]
            if value and str(value).strip():
                posting.material_cost = Decimal(str(value).strip())
            else:
                posting.material_cost = None

        # order_notes - 无时间戳，直接更新
        if "order_notes" in extra_info:
            value = extra_info["order_notes"]
            posting.order_notes = str(value).strip() if value and str(value).strip() else None

        # source_platform - 无时间戳，直接更新
        if "source_platform" in extra_info:
            value = extra_info["source_platform"]
            posting.source_platform = str(value).strip() if value and str(value).strip() else None

        # 更新全局时间戳
        posting.updated_at = utcnow()

        await db.commit()
        await db.refresh(posting)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"更新货件信息失败: {str(e)}")

    from ..utils.serialization import format_currency

    # 获取国内物流单号列表
    tracking_numbers = posting.get_domestic_tracking_numbers()

    # 记录审计日志（字段级）
    request_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    request_id = request.headers.get("x-request-id")

    try:
        # 记录进货价格变更
        if posting.purchase_price != old_purchase_price:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新进货价格",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "purchase_price": {
                        "old": str(old_purchase_price) if old_purchase_price else None,
                        "new": str(posting.purchase_price) if posting.purchase_price else None
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

        # 记录物料成本变更
        if posting.material_cost != old_material_cost:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新物料成本",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "material_cost": {
                        "old": str(old_material_cost) if old_material_cost else None,
                        "new": str(posting.material_cost) if posting.material_cost else None
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

        # 记录国内单号变更
        if tracking_numbers != old_tracking_numbers:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新国内单号",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "domestic_tracking_numbers": {
                        "old": old_tracking_numbers,
                        "new": tracking_numbers
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

        # 记录采购平台变更
        if posting.source_platform != old_source_platform:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新采购平台",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "source_platform": {
                        "old": old_source_platform,
                        "new": posting.source_platform
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

        # 记录其他信息变更（订单备注）
        if posting.order_notes != old_order_notes:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新订单其他信息",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "order_notes": {
                        "old": old_order_notes,
                        "new": posting.order_notes
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

    except Exception as e:
        # 审计日志失败不影响主流程
        logger.error(f"更新订单额外信息审计日志记录失败 {posting_number}: {str(e)}")

    return {
        "success": True,
        "message": "Posting extra info updated successfully",
        "data": {
            "posting_number": posting.posting_number,
            "purchase_price": format_currency(posting.purchase_price),
            "domestic_tracking_numbers": tracking_numbers,  # 统一使用数组形式
            "material_cost": format_currency(posting.material_cost),
            "order_notes": posting.order_notes,
            "source_platform": posting.source_platform,
            "purchase_price_updated_at": posting.purchase_price_updated_at.isoformat() if posting.purchase_price_updated_at else None
        }
    }


@router.get("/orders/{posting_number}")
async def get_order_detail(
    posting_number: str,
    shop_id: Optional[int] = Query(None, description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取订单详情
    通过posting_number获取单个订单的完整信息
    """
    # 通过 posting_number 查找订单（先查 posting，再找 order）
    posting_query = select(OzonPosting).where(OzonPosting.posting_number == posting_number)

    if shop_id:
        posting_query = posting_query.where(OzonPosting.shop_id == shop_id)

    posting_result = await db.execute(posting_query)
    posting = posting_result.scalar_one_or_none()

    if not posting:
        raise HTTPException(status_code=404, detail="Posting not found")

    # 获取关联的订单（预加载关系字段避免懒加载）
    from sqlalchemy.orm import selectinload

    query = (
        select(OzonOrder)
        .where(OzonOrder.id == posting.order_id)
        .options(
            selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
            selectinload(OzonOrder.postings).selectinload(OzonPosting.domestic_trackings)
        )
    )

    if False:  # shop_id 已经在 posting 查询中检查过了
        query = query.where(OzonOrder.shop_id == shop_id)

    # 执行查询
    result = await db.execute(query)
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(
            status_code=404,
            detail=f"Order with posting_number {posting_number} not found"
        )

    # 获取订单详细信息
    # 传递posting_number参数，确保返回的主记录是搜索的那个posting
    order_dict = order.to_dict(target_posting_number=posting_number)

    # 移除 items（与 postings[].products 重复）
    order_dict.pop('items', None)

    # 收集所有商品的offer_id
    all_offer_ids = set()
    for posting_data in order_dict.get("postings", []):
        products = posting_data.get("products", [])
        for product in products:
            if product.get('offer_id'):
                all_offer_ids.add(product.get('offer_id'))

    # 批量查询商品图片（使用offer_id匹配）
    from ..models.products import OzonProduct
    offer_id_images = {}
    if all_offer_ids:
        product_query = select(OzonProduct.offer_id, OzonProduct.images).where(
            OzonProduct.offer_id.in_(list(all_offer_ids))
        )
        if shop_id:
            product_query = product_query.where(OzonProduct.shop_id == shop_id)
        products_result = await db.execute(product_query)
        for offer_id, images in products_result:
            if offer_id and images:
                # 优先使用primary图片，否则使用第一张
                if isinstance(images, dict):
                    if images.get("primary"):
                        offer_id_images[offer_id] = images["primary"]
                    elif images.get("main") and isinstance(images["main"], list) and images["main"]:
                        offer_id_images[offer_id] = images["main"][0]
                elif isinstance(images, list) and images:
                    offer_id_images[offer_id] = images[0]

    # 从所有 postings[].products 计算汇总信息
    total_items = 0
    total_quantity = 0
    for posting_data in order_dict.get("postings", []):
        products = posting_data.get("products", [])
        total_items += len(products)
        total_quantity += sum(p.get("quantity", 0) for p in products)

    # 添加额外的订单汇总信息
    order_summary = {
        "total_items": total_items,
        "total_quantity": total_quantity,
        "has_barcodes": bool(order_dict.get("upper_barcode") or order_dict.get("lower_barcode")),
        "has_cancellation": bool(order_dict.get("cancel_reason") or order_dict.get("cancel_reason_id")),
        "sync_info": {
            "mode": order_dict.get("sync_mode"),
            "version": order_dict.get("sync_version"),
            "last_sync": order_dict.get("last_sync_at"),
            "status": order_dict.get("sync_status")
        }
    }

    return {
        "success": True,
        "data": order_dict,
        "summary": order_summary,
        "offer_id_images": offer_id_images  # 添加商品图片映射
    }


@router.post("/orders/sync")
async def sync_orders(
    shop_id: int = Body(...),
    mode: str = Body("incremental", description="同步模式: full-全量同步, incremental-增量同步"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    同步订单数据（需要操作员权限）
    - full: 全量同步，获取店铺所有历史订单
    - incremental: 增量同步，获取最近7天的订单更新
    """

    # 验证同步模式
    if mode not in ["full", "incremental"]:
        return {
            "success": False,
            "message": "无效的同步模式",
            "error": f"Mode must be 'full' or 'incremental', got '{mode}'"
        }

    # 生成任务ID
    import uuid
    import asyncio
    task_id = f"order_sync_{uuid.uuid4().hex[:12]}"

    # 异步执行同步任务
    from ..services.order_sync import OrderSyncService
    from ..api.client import OzonAPIClient
    from ..models import OzonShop
    from datetime import timedelta

    async def run_sync():
        """在后台执行同步任务（使用 OrderSyncService 批量处理）"""
        from ..services.ozon_sync import SYNC_TASKS
        from ..utils.datetime_utils import utcnow

        try:
            # 初始化任务状态
            SYNC_TASKS[task_id] = {
                "status": "running",
                "progress": 0,
                "message": "正在准备同步...",
                "started_at": utcnow().isoformat(),
                "type": "orders",
                "mode": mode,
            }

            # 创建新的数据库会话用于异步任务
            from ef_core.database import get_db_manager
            db_manager = get_db_manager()
            async with db_manager.get_session() as task_db:
                # 获取店铺信息
                SYNC_TASKS[task_id]["progress"] = 5
                SYNC_TASKS[task_id]["message"] = "正在获取店铺信息..."

                shop_result = await task_db.execute(
                    select(OzonShop).where(OzonShop.id == shop_id)
                )
                shop = shop_result.scalar_one_or_none()

                if not shop:
                    SYNC_TASKS[task_id] = {
                        "status": "failed",
                        "progress": 0,
                        "message": f"店铺 {shop_id} 不存在",
                        "error": f"Shop {shop_id} not found",
                        "failed_at": utcnow().isoformat(),
                        "type": "orders",
                        "mode": mode,
                    }
                    logger.error(f"Shop {shop_id} not found")
                    return

                # 创建API客户端
                SYNC_TASKS[task_id]["progress"] = 10
                SYNC_TASKS[task_id]["message"] = "正在连接 Ozon API..."

                api_client = OzonAPIClient(
                    client_id=shop.client_id,
                    api_key=shop.api_key_enc
                )

                # 使用 OrderSyncService 执行批量同步
                sync_service = OrderSyncService(shop_id=shop_id, api_client=api_client)

                # 根据模式确定时间范围
                from datetime import datetime, timezone
                date_to = datetime.now(timezone.utc)
                if mode == "full":
                    date_from = date_to - timedelta(days=360)  # 全量：360天
                    full_sync = True
                else:
                    date_from = date_to - timedelta(days=7)  # 增量：7天
                    full_sync = False

                SYNC_TASKS[task_id]["progress"] = 20
                SYNC_TASKS[task_id]["message"] = "正在同步订单..."

                # 执行同步（批量处理，每批50条，无 N+1 问题）
                stats = await sync_service.sync_orders(
                    date_from=date_from,
                    date_to=date_to,
                    full_sync=full_sync
                )

                await api_client.close()

                # 更新任务为完成状态
                SYNC_TASKS[task_id] = {
                    "status": "completed",
                    "progress": 100,
                    "message": f"{'全量' if mode == 'full' else '增量'}同步完成，共同步 {stats['total_processed']} 个订单",
                    "completed_at": utcnow().isoformat(),
                    "type": "orders",
                    "mode": mode,
                    "result": {
                        "total_synced": stats["total_processed"],
                        "success": stats["success"],
                        "failed": stats["failed"]
                    },
                }

                logger.info(
                    f"Order sync completed for shop {shop_id}",
                    extra={
                        "task_id": task_id,
                        "mode": mode,
                        "total_processed": stats["total_processed"],
                        "success": stats["success"],
                        "failed": stats["failed"]
                    }
                )
        except Exception as e:
            # 更新任务为失败状态
            SYNC_TASKS[task_id] = {
                "status": "failed",
                "progress": SYNC_TASKS.get(task_id, {}).get("progress", 0),
                "message": f"{'全量' if mode == 'full' else '增量'}同步失败: {str(e)}",
                "error": str(e),
                "failed_at": utcnow().isoformat(),
                "type": "orders",
                "mode": mode,
            }
            logger.error(f"Order sync failed: {e}")
            import traceback
            logger.error(traceback.format_exc())

    # 在后台启动同步任务
    asyncio.create_task(run_sync())

    return {
        "success": True,
        "message": f"订单{'全量' if mode == 'full' else '增量'}同步已启动",
        "task_id": task_id,
        "sync_mode": mode
    }


@router.post("/orders/{posting_number}/sync")
async def sync_single_order(
    posting_number: str,
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    同步单个订单（需要操作员权限）
    通过posting_number从OZON API拉取最新的订单数据并更新到数据库
    """
    from ..api.client import OzonAPIClient
    from ..models import OzonShop
    from ..services.order_sync import OrderSyncService

    try:
        # 1. 获取店铺信息
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            raise HTTPException(status_code=404, detail=f"店铺 {shop_id} 不存在")

        # 2. 创建API客户端
        api_client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop_id
        )

        # 3. 从OZON获取posting详情
        logger.info(f"同步单个订单: posting_number={posting_number}, shop_id={shop_id}")
        detail_response = await api_client.get_posting_details(
            posting_number=posting_number,
            with_analytics_data=True,
            with_financial_data=True
        )

        if not detail_response.get("result"):
            raise HTTPException(
                status_code=404,
                detail=f"在OZON中未找到货件 {posting_number}"
            )

        posting_data = detail_response["result"]

        # 4. 使用订单同步服务处理数据
        sync_service = OrderSyncService(shop_id=shop_id, api_client=api_client)
        await sync_service._process_single_posting(db, posting_data)
        await db.commit()

        # 5. 关闭API客户端
        await api_client.close()

        logger.info(f"订单同步成功: posting_number={posting_number}")

        return {
            "success": True,
            "message": "订单同步成功",
            "data": {
                "posting_number": posting_number,
                "status": posting_data.get("status"),
                "synced_at": utcnow().isoformat()
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"同步订单失败: posting_number={posting_number}, error={e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"同步失败: {str(e)}"
        )
