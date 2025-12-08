"""
打包发货 - 查询和统计路由
包括：获取待打包订单列表、采购价格历史、单号搜索、打包统计等
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, cast, exists, literal_column, text
from sqlalchemy.dialects.postgresql import JSONB
from decimal import Decimal
from datetime import datetime, timezone, timedelta
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from ...models import OzonPosting, OzonProduct, OzonShop, OzonDomesticTracking, OzonShipmentPackage
from ...utils.datetime_utils import utcnow
from ..permissions import filter_by_shop_permission, build_shop_filter_condition

router = APIRouter(tags=["ozon-packing"])
logger = logging.getLogger(__name__)

@router.get("/packing/orders")
async def get_packing_orders(
    offset: int = 0,
    limit: int = Query(50, le=1000),
    shop_id: Optional[int] = None,
    posting_number: Optional[str] = None,
    sku: Optional[str] = Query(None, description="按商品SKU搜索（在posting的products中查找）"),
    tracking_number: Optional[str] = Query(None, description="按OZON追踪号码搜索（在packages中查找）"),
    domestic_tracking_number: Optional[str] = Query(None, description="按国内单号搜索（在domestic_trackings中查找）"),
    operation_status: Optional[str] = Query(None, description="操作状态筛选：awaiting_stock/allocating/allocated/tracking_confirmed/shipping"),
    ozon_status: Optional[str] = Query(None, description="OZON原生状态筛选，支持逗号分隔的多个状态，如：awaiting_packaging,awaiting_deliver"),
    days_within: Optional[int] = Query(None, description="运输中状态的天数筛选（仅在operation_status=shipping时有效，默认7天）"),
    source_platform: Optional[str] = Query(None, description="按采购平台筛选（1688/拼多多/咸鱼/淘宝/库存）"),
    delivery_method: Optional[str] = Query(None, description="按配送方式筛选（左匹配）"),
    has_purchase_info: Optional[str] = Query(None, description="按采购信息筛选：all(全部)/yes(有采购信息)/no(无采购信息)"),
    sort_order: Optional[str] = Query("desc", description="排序顺序：desc(倒序)/asc(顺序)，默认倒序"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取打包发货页面的订单列表
    - 支持按 operation_status 筛选（等待备货/分配中/已分配/单号确认/运输中）
    - 支持按 ozon_status 筛选（OZON原生状态，如 awaiting_packaging, awaiting_deliver）
    - 支持按 posting_number 精确搜索（货件编号）
    - 支持按 sku 搜索（在posting的products中查找，SKU为整数）
    - 支持按 tracking_number 搜索（OZON追踪号码，在packages中查找）
    - 支持按 domestic_tracking_number 搜索（国内单号，在domestic_trackings中查找）
    - 支持按 delivery_method 筛选（配送方式，左匹配）
    - 运输中状态支持时间筛选：默认显示7天内改为运输中状态的订单
    - ozon_status 优先级高于 operation_status
    - 如果都不指定，返回所有订单

    注意：返回以Posting为粒度的数据，一个订单拆分成多个posting时会显示为多条记录

    权限控制：
    - admin: 可以访问所有店铺的订单
    - operator/viewer: 只能访问已授权店铺的订单
    """
    from datetime import datetime, timedelta

    # 权限过滤：根据用户角色过滤店铺
    try:
        allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    # 构建查询：以Posting为主体，只加载必要关联（packages + domestic_trackings）
    # 注：移除 order 及其嵌套加载，打包页面不需要订单信息，可降低内存 30-50%
    from sqlalchemy.orm import selectinload
    query = select(OzonPosting).options(
        selectinload(OzonPosting.packages),
        selectinload(OzonPosting.domestic_trackings)
    )

    # 应用权限过滤条件
    shop_filter = build_shop_filter_condition(OzonPosting, allowed_shop_ids)
    if shop_filter is not True:
        query = query.where(shop_filter)

    # 核心过滤：基于 ozon_status + 追踪号码/国内单号
    # 优先使用 operation_status，如果有 ozon_status 参数则转换为 operation_status
    if ozon_status:
        # 兼容旧的 ozon_status 参数（前端可能还在使用）
        operation_status = 'awaiting_stock'

    if operation_status == 'awaiting_stock':
        # 等待备货：ozon_status IN ('awaiting_packaging', 'awaiting_registration') AND (operation_status IS NULL OR = 'awaiting_stock')
        # 包含：awaiting_packaging（待打包）、awaiting_registration（等待登记）
        # 排除已经进入后续状态的订单（allocating/allocated/tracking_confirmed/printed等）
        # 排除OZON已取消的订单
        # 排除已废弃的订单（operation_status = 'cancelled'）
        query = query.where(
            and_(
                OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration']),
                OzonPosting.status != 'cancelled',
                or_(
                    OzonPosting.operation_status.is_(None),
                    OzonPosting.operation_status == 'awaiting_stock'
                ),
                OzonPosting.operation_status != 'cancelled'
            )
        )

    elif operation_status == 'allocating':
        # 分配中：operation_status='allocating' AND 无追踪号码
        # status限制：awaiting_packaging（刚备货）、awaiting_registration（等待登记）或 awaiting_deliver（已同步到OZON）
        # 排除OZON已取消的订单
        query = query.where(
            and_(
                OzonPosting.operation_status == 'allocating',
                OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver']),
                OzonPosting.status != 'cancelled',
                or_(
                    OzonPosting.raw_payload['tracking_number'].astext.is_(None),
                    OzonPosting.raw_payload['tracking_number'].astext == '',
                    ~OzonPosting.raw_payload.has_key('tracking_number')
                )
            )
        )

    elif operation_status == 'allocated':
        # 已分配：status in ['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver'] AND 有追踪号码 AND (无国内单号 OR operation_status='allocated')
        # 注意：当用户删除所有国内单号后，会自动设置 operation_status='allocated'
        # 支持多种状态，因为订单在不同阶段都可能处于"已分配"状态
        # 排除OZON已取消的订单
        # 排除已废弃的订单（operation_status = 'cancelled'）
        # 优化：使用反范式化字段替代 JSONB 和 EXISTS 查询
        query = query.where(
            and_(
                OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver']),
                OzonPosting.status != 'cancelled',
                # 有追踪号码（使用反范式化字段）
                OzonPosting.has_tracking_number == True,
                # 无国内单号 OR operation_status='allocated'（后者覆盖删除国内单号的情况）
                or_(
                    OzonPosting.has_domestic_tracking == False,
                    OzonPosting.operation_status == 'allocated'
                ),
                # 排除已废弃状态
                OzonPosting.operation_status != 'cancelled'
            )
        )

    elif operation_status == 'tracking_confirmed':
        # 确认单号：ozon_status = 'awaiting_deliver' AND operation_status = 'tracking_confirmed'
        # 排除OZON已取消的订单
        query = query.where(
            and_(
                OzonPosting.status == 'awaiting_deliver',
                OzonPosting.status != 'cancelled',
                OzonPosting.operation_status == 'tracking_confirmed'
            )
        )

    elif operation_status == 'printed':
        # 已打印：ozon_status = 'awaiting_deliver' AND operation_status = 'printed'
        # 这是一个手动标记的状态，不依赖字段存在性
        # 排除OZON已取消的订单
        query = query.where(
            and_(
                OzonPosting.status == 'awaiting_deliver',
                OzonPosting.status != 'cancelled',
                OzonPosting.operation_status == 'printed'
            )
        )

    elif operation_status == 'shipping':
        # 运输中：operation_status = 'shipping' AND operation_time在指定天数内（默认7天）
        # 计算时间阈值
        days = days_within if days_within is not None else 7
        time_threshold = utcnow() - timedelta(days=days)

        query = query.where(
            and_(
                OzonPosting.operation_status == 'shipping',
                OzonPosting.operation_time >= time_threshold
            )
        )

    # 搜索条件：货件编号（支持通配符）
    if posting_number:
        posting_number_value = posting_number.strip()
        if '%' in posting_number_value:
            # 包含通配符，使用 LIKE 模糊匹配
            query = query.where(OzonPosting.posting_number.like(posting_number_value))
        else:
            # 精确匹配
            query = query.where(OzonPosting.posting_number == posting_number_value)

    # 搜索条件：SKU搜索（使用 product_skus 数组 GIN 索引，性能优化）
    if sku:
        # 使用 product_skus 数组字段（反范式化）进行高效查询
        # SKU 存储为字符串数组，使用 PostgreSQL 数组包含操作
        try:
            sku_str = str(int(sku))  # 验证 SKU 是有效整数后转为字符串
            # 使用 ANY 操作符检查数组是否包含指定 SKU
            query = query.where(
                OzonPosting.product_skus.any(sku_str)
            )
        except ValueError:
            # 如果SKU不是整数，不应用此过滤条件
            logger.warning(f"Invalid SKU format: {sku}, expected integer")
            pass

    # 搜索条件：OZON追踪号码搜索（在packages中查找，统一转大写）
    if tracking_number:
        # 在packages数组中查找tracking_number
        query = query.join(
            OzonShipmentPackage,
            OzonShipmentPackage.posting_id == OzonPosting.id
        ).where(
            OzonShipmentPackage.tracking_number == tracking_number.strip().upper()
        )

    # 搜索条件：国内单号搜索（在domestic_trackings中查找，统一转大写）
    if domestic_tracking_number:
        # 在domestic_trackings表中查找
        query = query.join(
            OzonDomesticTracking,
            OzonDomesticTracking.posting_id == OzonPosting.id
        ).where(
            OzonDomesticTracking.tracking_number == domestic_tracking_number.strip().upper()
        )

    # 搜索条件：采购平台筛选（source_platform是JSONB数组）
    if source_platform:
        # 使用JSONB包含操作符，检查数组是否包含指定平台
        query = query.where(
            OzonPosting.source_platform.contains([source_platform])
        )

    # 搜索条件：配送方式筛选（左匹配）
    if delivery_method:
        delivery_method_value = delivery_method.strip()
        # 左匹配：在delivery_method_name字段中查找
        query = query.where(
            OzonPosting.delivery_method_name.like(f"{delivery_method_value}%")
        )

    # 搜索条件：采购信息筛选（使用反范式化字段 has_purchase_info，避免 jsonb_array_elements 子查询）
    if has_purchase_info and has_purchase_info != 'all':
        if has_purchase_info == 'yes':
            # 有采购信息：所有商品都有采购地址
            query = query.where(OzonPosting.has_purchase_info == True)
        elif has_purchase_info == 'no':
            # 无采购信息：至少有一个商品缺少采购地址
            query = query.where(OzonPosting.has_purchase_info == False)

    # 排序：已打印状态按操作时间，其他状态按下单时间
    # 默认倒序（新订单在前），支持顺序排序（旧订单在前）
    is_asc = sort_order == 'asc'
    if operation_status == 'printed':
        # 已打印：按标记已打印的时间（operation_time）排序
        order_col = OzonPosting.operation_time.asc() if is_asc else OzonPosting.operation_time.desc()
    else:
        # 其他状态：按下单时间排序（in_process_at ≈ ordered_at，无需 JOIN）
        order_col = OzonPosting.in_process_at.asc() if is_asc else OzonPosting.in_process_at.desc()
    query = query.order_by(order_col)

    # 执行查询获取总数（统计Posting数量，无需 JOIN）
    count_query = select(func.count(OzonPosting.id))

    # 应用权限过滤条件到count查询
    if shop_filter is not True:
        count_query = count_query.where(shop_filter)

    # 应用相同的状态筛选逻辑
    if operation_status == 'awaiting_stock':
        count_query = count_query.where(
            and_(
                OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration']),
                OzonPosting.status != 'cancelled',
                or_(
                    OzonPosting.operation_status.is_(None),
                    OzonPosting.operation_status == 'awaiting_stock'
                ),
                OzonPosting.operation_status != 'cancelled'
            )
        )

    elif operation_status == 'allocating':
        count_query = count_query.where(
            and_(
                OzonPosting.operation_status == 'allocating',
                OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver']),
                OzonPosting.status != 'cancelled',
                or_(
                    OzonPosting.raw_payload['tracking_number'].astext.is_(None),
                    OzonPosting.raw_payload['tracking_number'].astext == '',
                    ~OzonPosting.raw_payload.has_key('tracking_number')
                )
            )
        )

    elif operation_status == 'allocated':
        # 优化：使用反范式化字段替代 JSONB 和 EXISTS 查询
        count_query = count_query.where(
            and_(
                OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver']),
                OzonPosting.status != 'cancelled',
                # 有追踪号码（使用反范式化字段）
                OzonPosting.has_tracking_number == True,
                # 无国内单号 OR operation_status='allocated'（后者覆盖删除国内单号的情况）
                or_(
                    OzonPosting.has_domestic_tracking == False,
                    OzonPosting.operation_status == 'allocated'
                ),
                # 排除已废弃状态
                OzonPosting.operation_status != 'cancelled'
            )
        )

    elif operation_status == 'tracking_confirmed':
        count_query = count_query.where(
            and_(
                OzonPosting.status == 'awaiting_deliver',
                OzonPosting.status != 'cancelled',
                OzonPosting.operation_status == 'tracking_confirmed'
            )
        )

    elif operation_status == 'printed':
        count_query = count_query.where(
            and_(
                OzonPosting.status == 'awaiting_deliver',
                OzonPosting.status != 'cancelled',
                OzonPosting.operation_status == 'printed'
            )
        )

    elif operation_status == 'shipping':
        # 运输中：计算时间阈值（默认7天）
        days = days_within if days_within is not None else 7
        time_threshold = utcnow() - timedelta(days=days)

        count_query = count_query.where(
            and_(
                OzonPosting.operation_status == 'shipping',
                OzonPosting.operation_time >= time_threshold
            )
        )

    if posting_number:
        posting_number_value = posting_number.strip()
        if '%' in posting_number_value:
            count_query = count_query.where(OzonPosting.posting_number.like(posting_number_value))
        else:
            count_query = count_query.where(OzonPosting.posting_number == posting_number_value)
    if sku:
        # SKU搜索（使用 product_skus 数组，count查询也需要应用）
        try:
            sku_str = str(int(sku))
            count_query = count_query.where(
                OzonPosting.product_skus.any(sku_str)
            )
        except ValueError:
            pass
    if tracking_number:
        # OZON追踪号码搜索（count查询也需要应用，统一转大写）
        count_query = count_query.join(
            OzonShipmentPackage,
            OzonShipmentPackage.posting_id == OzonPosting.id
        ).where(
            OzonShipmentPackage.tracking_number == tracking_number.strip().upper()
        )
    if domestic_tracking_number:
        # 国内单号搜索（count查询也需要应用，统一转大写）
        count_query = count_query.join(
            OzonDomesticTracking,
            OzonDomesticTracking.posting_id == OzonPosting.id
        ).where(
            OzonDomesticTracking.tracking_number == domestic_tracking_number.strip().upper()
        )

    # 采购平台筛选（count查询也需要应用）
    if source_platform:
        count_query = count_query.where(
            OzonPosting.source_platform.contains([source_platform])
        )

    # 采购信息筛选（使用反范式化字段 has_purchase_info，避免 jsonb_array_elements 子查询）
    if has_purchase_info and has_purchase_info != 'all':
        if has_purchase_info == 'yes':
            # 有采购信息：所有商品都有采购地址
            count_query = count_query.where(OzonPosting.has_purchase_info == True)
        elif has_purchase_info == 'no':
            # 无采购信息：至少有一个商品缺少采购地址
            count_query = count_query.where(OzonPosting.has_purchase_info == False)

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 添加分页
    query = query.offset(offset).limit(limit)

    # 执行查询，获取Posting列表
    result = await db.execute(query)
    postings = result.scalars().all()

    # 从posting中提取所有offer_id
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
        # 应用权限过滤条件到商品查询
        product_shop_filter = build_shop_filter_condition(OzonProduct, allowed_shop_ids)
        if product_shop_filter is not True:
            product_query = product_query.where(product_shop_filter)
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

    # 构建返回数据：每个posting作为独立记录（使用 to_packing_dict，不依赖 order）
    from ...services.posting_status_manager import PostingStatusManager

    orders_data = []
    for posting in postings:
        # 使用 posting.to_packing_dict()，完全不依赖 order 关系
        order_dict = posting.to_packing_dict()

        # 状态修正兜底机制：检查posting的operation_status是否正确
        if 'postings' in order_dict and order_dict['postings']:
            for posting_dict in order_dict['postings']:
                # 计算正确的operation_status（不保留printed状态，强制重新计算）
                correct_status, _ = PostingStatusManager.calculate_operation_status(
                    posting=posting,
                    ozon_status=posting_dict.get('status', 'unknown'),
                    preserve_manual=False  # 不保留手动状态，强制修正
                )

                # 如果状态不一致，记录日志并修正
                current_status = posting_dict.get('operation_status')
                if current_status != correct_status:
                    logger.warning(
                        f"状态修正: posting {posting_dict['posting_number']} "
                        f"operation_status 不正确 (当前: {current_status}, 应为: {correct_status}, "
                        f"ozon_status: {posting_dict.get('status')})"
                    )
                    posting_dict['operation_status'] = correct_status

        orders_data.append(order_dict)

    return {
        "data": orders_data,
        "total": total,
        "offset": offset,
        "limit": limit,
        "offer_id_images": offer_id_images
    }


@router.get("/products/{sku}/purchase-price-history")
async def get_product_purchase_price_history(
    sku: str,
    limit: int = Query(10, le=50, description="返回的历史记录数量"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取指定SKU商品的进货价格历史记录

    Args:
        sku: 商品SKU
        limit: 返回的记录数量，默认10条，最多50条

    Returns:
        包含商品名称、SKU和历史价格记录列表
    """
    from sqlalchemy import and_, desc, cast, String
    from sqlalchemy.dialects.postgresql import JSONB

    # 1. 查询采购信息、图片和价格（从products表）
    product_result = await db.execute(
        select(
            OzonProduct.purchase_url,
            OzonProduct.suggested_purchase_price,
            OzonProduct.purchase_note,
            OzonProduct.images,  # JSONB: {"primary": "url", "additional": [...]}
            OzonProduct.price
        )
        .where(OzonProduct.ozon_sku == int(sku))
        .limit(1)
    )
    product = product_result.first()
    purchase_url = product[0] if product else None
    suggested_purchase_price = str(product[1]) if product and product[1] else None
    purchase_note = product[2] if product else None
    # 从 images JSONB 中提取主图
    images_data = product[3] if product else None
    primary_image = images_data.get('primary') if isinstance(images_data, dict) else None
    product_price = str(product[4]) if product and product[4] else None

    # 2. 查询该SKU的进货价格历史（使用 product_skus 数组字段，GIN 索引优化）
    query = (
        select(
            OzonPosting.posting_number,
            OzonPosting.purchase_price,
            OzonPosting.purchase_price_updated_at,
            OzonPosting.operation_time,
            OzonPosting.source_platform
        )
        .where(
            and_(
                OzonPosting.purchase_price.isnot(None),  # 必须有进货价格
                # 使用 product_skus 数组字段（反范式化）进行高效查询
                OzonPosting.product_skus.any(str(int(sku)))
            )
        )
        .order_by(
            desc(OzonPosting.purchase_price_updated_at),
            desc(OzonPosting.operation_time)
        )
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.all()

    # 3. 构造返回数据
    history_records = []
    for row in rows:
        history_records.append({
            "posting_number": row.posting_number,
            "purchase_price": str(row.purchase_price) if row.purchase_price else None,
            "updated_at": row.purchase_price_updated_at.isoformat() if row.purchase_price_updated_at else (
                row.operation_time.isoformat() if row.operation_time else None
            ),
            "source_platform": row.source_platform
        })

    return {
        "sku": sku,
        "primary_image": primary_image,
        "product_price": product_price,
        "purchase_url": purchase_url,
        "suggested_purchase_price": suggested_purchase_price,
        "purchase_note": purchase_note,
        "history": history_records,
        "total": len(history_records)
    }



@router.get("/packing/postings/search-by-tracking")
async def search_posting_by_tracking(
    tracking_number: str = Query(..., description="追踪号码/国内单号/货件编号"),
    offset: int = Query(0, ge=0, description="分页偏移量"),
    limit: int = Query(20, ge=1, le=100, description="每页数量，默认20"),
    print_status: Optional[str] = Query(None, description="打印状态过滤：all(全部)/printed(已打印)/unprinted(未打印)"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    根据追踪号码/国内单号/货件编号查询货件（精确匹配，智能识别）

    智能识别规则：
    1. 包含"-" → 货件编号（posting_number），如 "12345-0001-1"
    2. 结尾是字母 且 包含数字 → OZON追踪号码（packages.tracking_number），如 "UNIM83118549CN"
    3. 纯数字 或 字母开头+数字 → 国内单号（domestic_tracking_number），如 "75324623944112" 或 "SF1234567890"

    返回：posting 列表（当国内单号匹配多个posting时，返回所有匹配结果）
    """
    from sqlalchemy.orm import selectinload
    from ...models import OzonShipmentPackage

    try:
        # 权限过滤：获取用户授权的店铺列表
        try:
            allowed_shop_ids = await filter_by_shop_permission(current_user, db, None)
        except PermissionError as e:
            raise HTTPException(status_code=403, detail=str(e))

        # 构建店铺权限过滤条件
        shop_filter = build_shop_filter_condition(OzonPosting, allowed_shop_ids)

        # 统一转大写，兼容OZON单号和国内单号（Posting Number包含数字和连字符，不受影响）
        search_value = tracking_number.strip().upper()
        postings = []
        total_count = 0  # 用于分页场景（国内单号可能匹配多个）

        # 智能识别单号类型
        if '-' in search_value:
            # 规则1: 包含"-" → 货件编号
            # 如果是"数字-数字"格式，自动右匹配（添加%通配符）
            import re
            if re.match(r'^\d+-\d+$', search_value):
                # 数字-数字格式，使用右匹配
                search_pattern = search_value + '-%'
                logger.info(f"识别为货件编号（右匹配）: {search_pattern}")
                query = (
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings)
                    )
                    .where(OzonPosting.posting_number.like(search_pattern))
                )
                # 应用店铺权限过滤
                if shop_filter is not True:
                    query = query.where(shop_filter)
                result = await db.execute(query.limit(1))
                posting = result.scalar_one_or_none()
                if posting:
                    postings = [posting]
            else:
                # 完整的货件编号，精确匹配
                logger.info(f"识别为货件编号（精确匹配）: {search_value}")
                query = (
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings)
                    )
                    .where(OzonPosting.posting_number == search_value)
                )
                # 应用店铺权限过滤
                if shop_filter is not True:
                    query = query.where(shop_filter)
                result = await db.execute(query)
                posting = result.scalar_one_or_none()
                if posting:
                    postings = [posting]

        elif search_value[-1].isalpha() and any(c.isdigit() for c in search_value):
            # 规则2: 结尾是字母 且 包含数字 → OZON追踪号码（字母+数字+字母）
            logger.info(f"识别为OZON追踪号码（结尾是字母）: {search_value}")
            package_result = await db.execute(
                select(OzonShipmentPackage)
                .where(OzonShipmentPackage.tracking_number == search_value)
            )
            package = package_result.scalar_one_or_none()

            if package:
                logger.info(f"找到包裹，posting_id: {package.posting_id}")
                # 通过package.posting_id查询posting
                query = (
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings)
                    )
                    .where(OzonPosting.id == package.posting_id)
                )
                # 应用店铺权限过滤
                if shop_filter is not True:
                    query = query.where(shop_filter)
                result = await db.execute(query)
                posting = result.scalar_one_or_none()
                if posting:
                    postings = [posting]
            else:
                logger.warning(f"未找到包裹，尝试从raw_payload查询: {search_value}")
                # 如果packages表中没有，尝试从raw_payload查询
                query = (
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings)
                    )
                    .where(OzonPosting.raw_payload['tracking_number'].astext == search_value)
                )
                # 应用店铺权限过滤
                if shop_filter is not True:
                    query = query.where(shop_filter)
                result = await db.execute(query)
                posting = result.scalar_one_or_none()
                if posting:
                    postings = [posting]

        else:
            # 规则3: 纯数字 或 字母开头+数字 → 国内单号（结尾是数字）
            # 可能匹配多个posting，返回最近7天的结果（支持分页）
            # 场景：666666 等内部单号用于标记库存商品，会关联大量 posting
            logger.info(f"识别为国内单号（纯数字或字母开头+数字）: {search_value}, print_status: {print_status}")

            # 优化：添加12天时间过滤，避免查询大量历史数据
            from datetime import timedelta
            time_threshold = datetime.now(timezone.utc) - timedelta(days=12)

            # 构建基础过滤条件（使用 in_process_at 避免 JOIN）
            base_conditions = [
                OzonDomesticTracking.tracking_number == search_value,
                OzonPosting.in_process_at >= time_threshold
            ]

            # 应用店铺权限过滤
            if shop_filter is not True:
                base_conditions.append(shop_filter)

            # 添加打印状态过滤条件
            # 打包流程状态：awaiting_stock -> allocating -> allocated -> tracking_confirmed -> printed
            # 排除 shipping（运输中）状态
            packing_statuses = ['awaiting_stock', 'allocating', 'allocated', 'tracking_confirmed']

            if print_status == 'printed':
                # 已打印：operation_status == 'printed'
                base_conditions.append(OzonPosting.operation_status == 'printed')
            elif print_status == 'unprinted':
                # 未打印：打包流程中的状态（不含 printed 和 shipping）
                base_conditions.append(
                    or_(
                        OzonPosting.operation_status.is_(None),
                        OzonPosting.operation_status.in_(packing_statuses)
                    )
                )
            else:
                # 全部：也只显示打包流程中的状态（含 printed，不含 shipping）
                base_conditions.append(
                    or_(
                        OzonPosting.operation_status.is_(None),
                        OzonPosting.operation_status.in_(packing_statuses + ['printed'])
                    )
                )

            # 先查询总数（用于前端显示，不需要 JOIN ozon_orders）
            count_result = await db.execute(
                select(func.count(OzonPosting.id))
                .join(OzonDomesticTracking, OzonDomesticTracking.posting_id == OzonPosting.id)
                .where(*base_conditions)
            )
            total_count = count_result.scalar() or 0

            # 分页查询 posting IDs
            id_result = await db.execute(
                select(OzonPosting.id)
                .join(OzonDomesticTracking, OzonDomesticTracking.posting_id == OzonPosting.id)
                .where(*base_conditions)
                .order_by(OzonPosting.in_process_at.desc())
                .offset(offset)
                .limit(limit)
            )
            posting_ids = [row[0] for row in id_result.fetchall()]

            if posting_ids:
                # 只对当前页的 posting 进行 selectinload（不加载 order）
                result = await db.execute(
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings)
                    )
                    .where(OzonPosting.id.in_(posting_ids))
                )
                postings = result.scalars().all()
            else:
                postings = []

        if not postings:
            # 未找到时返回空列表，不抛出404错误
            logger.info(f"未找到单号为 {tracking_number} 的货件")
            return {
                "data": [],
                "total": 0,
                "offset": offset,
                "limit": limit,
                "has_more": False,
                "offer_id_images": {}
            }

        # 收集所有offer_id（用于批量查询图片）
        all_offer_ids = set()
        for posting in postings:
            if posting.raw_payload and 'products' in posting.raw_payload:
                for product in posting.raw_payload['products']:
                    if product.get('offer_id'):
                        all_offer_ids.add(product.get('offer_id'))

        # 批量查询商品图片
        offer_id_images = {}
        if all_offer_ids:
            product_query = select(OzonProduct.offer_id, OzonProduct.images).where(
                OzonProduct.offer_id.in_(list(all_offer_ids))
            )
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

        # 构建返回数据列表（使用 to_packing_dict，不依赖 order）
        result_list = []
        for posting in postings:
            # 使用 posting.to_packing_dict()，完全不依赖 order 关系
            order_dict = posting.to_packing_dict()

            # 补充商品图片（to_packing_dict 没有图片数据）
            if order_dict.get('items'):
                for item in order_dict['items']:
                    offer_id = item.get('offer_id')
                    if offer_id:
                        item['image'] = offer_id_images.get(offer_id)
            if order_dict.get('products'):
                for product in order_dict['products']:
                    offer_id = product.get('offer_id')
                    if offer_id:
                        product['image'] = offer_id_images.get(offer_id)

            result_list.append(order_dict)

        # 按下单时间倒序排序（最新的在前面）
        result_list.sort(key=lambda x: x.get('ordered_at') or '', reverse=True)

        # 返回列表格式（支持分页和无限滚动）
        # total_count 在国内单号场景下表示7天内的总匹配数
        actual_total = total_count if total_count > 0 else len(result_list)
        has_more = (offset + limit) < actual_total if total_count > 0 else False

        logger.info(f"单号 {search_value} 匹配到 {len(result_list)} 个货件 (总数: {actual_total}, offset: {offset})")
        return {
            "data": result_list,
            "total": actual_total,
            "offset": offset,
            "limit": limit,
            "has_more": has_more,
            "offer_id_images": offer_id_images
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"查询追踪号码失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")


@router.get("/packing/stats")
async def get_packing_stats(
    shop_id: Optional[int] = None,
    posting_number: Optional[str] = Query(None, description="按货件编号搜索"),
    sku: Optional[str] = Query(None, description="按商品SKU搜索"),
    tracking_number: Optional[str] = Query(None, description="按OZON追踪号码搜索"),
    domestic_tracking_number: Optional[str] = Query(None, description="按国内单号搜索"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取打包发货各状态的统计数据（合并请求）

    一次性返回所有操作状态的数量统计，支持搜索条件过滤

    Returns:
        {
            "success": true,
            "data": {
                "awaiting_stock": 10,
                "allocating": 5,
                "allocated": 8,
                "tracking_confirmed": 3,
                "printed": 2,
                "shipping": 6
            }
        }

    权限控制：
    - admin: 可以访问所有店铺的订单统计
    - operator/viewer: 只能访问已授权店铺的订单统计
    """
    try:
        # 权限过滤：根据用户角色过滤店铺
        try:
            allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
        except PermissionError as e:
            raise HTTPException(status_code=403, detail=str(e))

        # 构建权限过滤条件
        shop_filter = build_shop_filter_condition(OzonPosting, allowed_shop_ids)

        # 构建基础查询条件（应用于所有状态统计）
        def build_base_conditions():
            """构建公共筛选条件"""
            conditions = []
            # 应用权限过滤
            if shop_filter is not True:
                conditions.append(shop_filter)
            if posting_number:
                posting_number_value = posting_number.strip()
                if '%' in posting_number_value:
                    conditions.append(OzonPosting.posting_number.like(posting_number_value))
                else:
                    conditions.append(OzonPosting.posting_number == posting_number_value)
            return conditions

        # 构建搜索条件（SKU/tracking_number/domestic_tracking_number）
        def apply_search_conditions(query):
            """应用搜索条件到查询"""
            # SKU搜索（使用 product_skus 数组字段，GIN 索引优化）
            if sku:
                try:
                    sku_str = str(int(sku))
                    query = query.where(
                        OzonPosting.product_skus.any(sku_str)
                    )
                except ValueError:
                    pass

            # OZON追踪号码搜索（统一转大写）
            if tracking_number:
                query = query.join(
                    OzonShipmentPackage,
                    OzonShipmentPackage.posting_id == OzonPosting.id
                ).where(
                    OzonShipmentPackage.tracking_number == tracking_number.strip().upper()
                )

            # 国内单号搜索（统一转大写）
            if domestic_tracking_number:
                query = query.join(
                    OzonDomesticTracking,
                    OzonDomesticTracking.posting_id == OzonPosting.id
                ).where(
                    OzonDomesticTracking.tracking_number == domestic_tracking_number.strip().upper()
                )

            return query

        # 统计各状态数量
        stats = {}
        base_conditions = build_base_conditions()

        # 1. 等待备货：(awaiting_packaging OR awaiting_registration) AND (operation_status IS NULL OR = 'awaiting_stock') AND NOT cancelled
        count_query = select(func.count(OzonPosting.id)).where(
            OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration']),
            OzonPosting.status != 'cancelled',
            or_(
                OzonPosting.operation_status.is_(None),
                OzonPosting.operation_status == 'awaiting_stock'
            ),
            OzonPosting.operation_status != 'cancelled',
            *base_conditions
        )
        count_query = apply_search_conditions(count_query)
        result = await db.execute(count_query)
        stats['awaiting_stock'] = result.scalar() or 0

        # 2. 分配中：operation_status='allocating' AND status in ['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver'] AND 无追踪号码 AND NOT cancelled
        count_query = select(func.count(OzonPosting.id)).where(
            OzonPosting.operation_status == 'allocating',
            OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver']),
            OzonPosting.status != 'cancelled',
            or_(
                OzonPosting.raw_payload['tracking_number'].astext.is_(None),
                OzonPosting.raw_payload['tracking_number'].astext == '',
                ~OzonPosting.raw_payload.has_key('tracking_number')
            ),
            *base_conditions
        )
        count_query = apply_search_conditions(count_query)
        result = await db.execute(count_query)
        stats['allocating'] = result.scalar() or 0

        # 3. 已分配：status in ['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver'] AND 有追踪号码 AND (无国内单号 OR operation_status='allocated') AND NOT cancelled
        # 优化：使用反范式化字段替代 JSONB 和 EXISTS 查询
        count_query = select(func.count(OzonPosting.id)).where(
            OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver']),
            OzonPosting.status != 'cancelled',
            OzonPosting.has_tracking_number == True,
            or_(
                OzonPosting.has_domestic_tracking == False,
                OzonPosting.operation_status == 'allocated'
            ),
            OzonPosting.operation_status != 'cancelled',
            *base_conditions
        )
        count_query = apply_search_conditions(count_query)
        result = await db.execute(count_query)
        stats['allocated'] = result.scalar() or 0

        # 4. 单号确认：awaiting_deliver AND operation_status = 'tracking_confirmed' AND NOT cancelled
        count_query = select(func.count(OzonPosting.id)).where(
            OzonPosting.status == 'awaiting_deliver',
            OzonPosting.status != 'cancelled',
            OzonPosting.operation_status == 'tracking_confirmed',
            *base_conditions
        )
        count_query = apply_search_conditions(count_query)
        result = await db.execute(count_query)
        stats['tracking_confirmed'] = result.scalar() or 0

        # 5. 已打印：awaiting_deliver AND operation_status = 'printed' AND NOT cancelled
        count_query = select(func.count(OzonPosting.id)).where(
            OzonPosting.status == 'awaiting_deliver',
            OzonPosting.status != 'cancelled',
            OzonPosting.operation_status == 'printed',
            *base_conditions
        )
        count_query = apply_search_conditions(count_query)
        result = await db.execute(count_query)
        stats['printed'] = result.scalar() or 0

        # 6. 运输中：operation_status = 'shipping' AND operation_time在7天内
        from datetime import timedelta
        time_threshold = utcnow() - timedelta(days=7)
        count_query = select(func.count(OzonPosting.id)).where(
            OzonPosting.operation_status == 'shipping',
            OzonPosting.operation_time >= time_threshold,
            *base_conditions
        )
        count_query = apply_search_conditions(count_query)
        result = await db.execute(count_query)
        stats['shipping'] = result.scalar() or 0

        logger.info(f"统计查询完成: shop_id={shop_id}, stats={stats}")

        return {
            "success": True,
            "data": stats
        }

    except Exception as e:
        logger.error(f"统计查询失败: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"统计查询失败: {str(e)}")
