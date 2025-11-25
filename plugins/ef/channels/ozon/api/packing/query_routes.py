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
from ...models import OzonOrder, OzonPosting, OzonProduct, OzonShop, OzonDomesticTracking, OzonShipmentPackage
from ...utils.datetime_utils import utcnow
from ..permissions import filter_by_shop_permission, build_shop_filter_condition

router = APIRouter(tags=["ozon-packing"])
logger = logging.getLogger(__name__)

@router.get("/packing/orders")
async def get_packing_orders(
    offset: int = 0,
    limit: int = Query(50, le=100),
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

    # 构建查询：以Posting为主体，JOIN Order获取订单信息
    from sqlalchemy.orm import selectinload
    query = select(OzonPosting).join(
        OzonOrder, OzonPosting.order_id == OzonOrder.id
    ).options(
        selectinload(OzonPosting.packages),
        selectinload(OzonPosting.order).selectinload(OzonOrder.postings),  # 预加载order及其所有postings
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
        query = query.where(
            and_(
                OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver']),
                OzonPosting.status != 'cancelled',
                # 有追踪号码
                OzonPosting.raw_payload['tracking_number'].astext.isnot(None),
                OzonPosting.raw_payload['tracking_number'].astext != '',
                # 无国内单号 OR operation_status='allocated'（后者覆盖删除国内单号的情况）
                or_(
                    ~exists(
                        select(1).where(
                            OzonDomesticTracking.posting_id == OzonPosting.id
                        )
                    ),
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

    # 搜索条件：SKU搜索（在products数组中查找）
    if sku:
        # 在raw_payload.products数组中查找包含指定SKU的posting
        # SKU在OZON API中是整数类型
        try:
            sku_int = int(sku)
            # 使用jsonb_array_elements展开products数组，然后检查sku字段
            # 这种方式兼容性好，适用于PostgreSQL 9.3+
            subquery = exists(
                select(literal_column('1'))
                .select_from(
                    func.jsonb_array_elements(OzonPosting.raw_payload['products']).alias('product')
                )
                .where(
                    literal_column("product->>'sku'") == str(sku_int)
                )
            )
            query = query.where(subquery)
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

    # 搜索条件：采购信息筛选（基于商品表的purchase_url）
    if has_purchase_info and has_purchase_info != 'all':
        if has_purchase_info == 'yes':
            # 有采购信息：posting的所有商品都有采购地址（purchase_url不为空）
            # 使用NOT EXISTS子查询：不存在任何商品缺少采购地址
            subquery = (
                select(1)
                .select_from(
                    func.jsonb_array_elements(OzonPosting.raw_payload['products']).alias('product_elem')
                )
                .outerjoin(
                    OzonProduct,
                    and_(
                        OzonProduct.offer_id == text("product_elem.value->>'offer_id'"),
                        OzonProduct.shop_id == OzonPosting.shop_id
                    )
                )
                .where(
                    or_(
                        # 商品不存在
                        OzonProduct.id.is_(None),
                        # 或者采购地址为空
                        OzonProduct.purchase_url.is_(None),
                        OzonProduct.purchase_url == ''
                    )
                )
                .correlate(OzonPosting)
            )
            query = query.where(~exists(subquery))

        elif has_purchase_info == 'no':
            # 无采购信息：posting至少有一个商品缺少采购地址
            # 使用EXISTS子查询：存在至少一个商品缺少采购地址
            subquery = (
                select(1)
                .select_from(
                    func.jsonb_array_elements(OzonPosting.raw_payload['products']).alias('product_elem')
                )
                .outerjoin(
                    OzonProduct,
                    and_(
                        OzonProduct.offer_id == text("product_elem.value->>'offer_id'"),
                        OzonProduct.shop_id == OzonPosting.shop_id
                    )
                )
                .where(
                    or_(
                        # 商品不存在
                        OzonProduct.id.is_(None),
                        # 或者采购地址为空
                        OzonProduct.purchase_url.is_(None),
                        OzonProduct.purchase_url == ''
                    )
                )
                .correlate(OzonPosting)
            )
            query = query.where(exists(subquery))

    # 排序：已打印状态按操作时间倒序，其他状态按订单创建时间倒序
    if operation_status == 'printed':
        # 已打印：按标记已打印的时间（operation_time）降序排列
        query = query.order_by(OzonPosting.operation_time.desc())
    else:
        # 其他状态：按下单时间倒序（使用 posting.ordered_at 冗余字段，避免 JOIN 排序）
        query = query.order_by(OzonPosting.ordered_at.desc())

    # 执行查询获取总数（统计Posting数量）
    count_query = select(func.count(OzonPosting.id)).select_from(OzonPosting).join(
        OzonOrder, OzonPosting.order_id == OzonOrder.id
    )

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
        count_query = count_query.where(
            and_(
                OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver']),
                OzonPosting.status != 'cancelled',
                OzonPosting.raw_payload['tracking_number'].astext.isnot(None),
                OzonPosting.raw_payload['tracking_number'].astext != '',
                # 无国内单号 OR operation_status='allocated'（后者覆盖删除国内单号的情况）
                or_(
                    ~exists(
                        select(1).where(
                            OzonDomesticTracking.posting_id == OzonPosting.id
                        )
                    ),
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
        # SKU搜索（count查询也需要应用）
        try:
            sku_int = int(sku)
            # 使用jsonb_array_elements展开products数组，然后检查sku字段
            subquery = exists(
                select(literal_column('1'))
                .select_from(
                    func.jsonb_array_elements(OzonPosting.raw_payload['products']).alias('product')
                )
                .where(
                    literal_column("product->>'sku'") == str(sku_int)
                )
            )
            count_query = count_query.where(subquery)
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

    # 采购信息筛选（基于商品表的purchase_url）
    if has_purchase_info and has_purchase_info != 'all':
        if has_purchase_info == 'yes':
            # 有采购信息：posting的所有商品都有采购地址
            # 使用 NOT EXISTS 子查询：不存在缺少采购地址的商品
            count_query = count_query.where(
                ~exists(
                    select(literal_column('1'))
                    .select_from(
                        func.jsonb_array_elements(OzonPosting.raw_payload['products']).alias('product_elem')
                    )
                    .outerjoin(
                        OzonProduct,
                        and_(
                            OzonProduct.offer_id == literal_column("product_elem.value->>'offer_id'"),
                            OzonProduct.shop_id == OzonPosting.shop_id
                        )
                    )
                    .where(
                        or_(
                            OzonProduct.id.is_(None),
                            OzonProduct.purchase_url.is_(None),
                            OzonProduct.purchase_url == ''
                        )
                    )
                )
            )

        elif has_purchase_info == 'no':
            # 无采购信息：posting至少有一个商品缺少采购地址
            # 使用 EXISTS 子查询：存在缺少采购地址的商品
            count_query = count_query.where(
                exists(
                    select(literal_column('1'))
                    .select_from(
                        func.jsonb_array_elements(OzonPosting.raw_payload['products']).alias('product_elem')
                    )
                    .outerjoin(
                        OzonProduct,
                        and_(
                            OzonProduct.offer_id == literal_column("product_elem.value->>'offer_id'"),
                            OzonProduct.shop_id == OzonPosting.shop_id
                        )
                    )
                    .where(
                        or_(
                            OzonProduct.id.is_(None),
                            OzonProduct.purchase_url.is_(None),
                            OzonProduct.purchase_url == ''
                        )
                    )
                )
            )

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

    # 构建返回数据：每个posting作为独立记录
    from ...services.posting_status_manager import PostingStatusManager

    orders_data = []
    for posting in postings:
        # 使用关联的order对象构造完整数据
        order = posting.order
        if order:
            # 调用order.to_dict()，指定target_posting_number确保只返回当前posting的数据
            order_dict = order.to_dict(target_posting_number=posting.posting_number)
            # 移除 items（与 postings[].products 重复）
            order_dict.pop('items', None)

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

    # 2. 查询该SKU的进货价格历史（从postings表的raw_payload中匹配）
    # 使用JSONB查询：raw_payload->'products'数组中任意元素的sku字段匹配
    # 使用PostgreSQL的@>运算符检查JSONB数组是否包含指定元素
    # 注意：raw_payload中的sku是整数类型，需要转换
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
                # 使用jsonb_array_elements展开products数组，然后检查sku字段
                exists(
                    select(literal_column('1'))
                    .select_from(
                        func.jsonb_array_elements(OzonPosting.raw_payload['products']).alias('product')
                    )
                    .where(
                        literal_column("product->>'sku'") == str(int(sku))
                    )
                )
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
    db: AsyncSession = Depends(get_async_session)
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
                result = await db.execute(
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.items),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.refunds)
                    )
                    .where(OzonPosting.posting_number.like(search_pattern))
                    .limit(1)  # 只返回第一个匹配的结果
                )
                posting = result.scalar_one_or_none()
                if posting:
                    postings = [posting]
            else:
                # 完整的货件编号，精确匹配
                logger.info(f"识别为货件编号（精确匹配）: {search_value}")
                result = await db.execute(
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.items),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.refunds)
                    )
                    .where(OzonPosting.posting_number == search_value)
                )
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
                result = await db.execute(
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.items),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.refunds)
                    )
                    .where(OzonPosting.id == package.posting_id)
                )
                posting = result.scalar_one_or_none()
                if posting:
                    postings = [posting]
            else:
                logger.warning(f"未找到包裹，尝试从raw_payload查询: {search_value}")
                # 如果packages表中没有，尝试从raw_payload查询
                result = await db.execute(
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.items),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.refunds)
                    )
                    .where(OzonPosting.raw_payload['tracking_number'].astext == search_value)
                )
                posting = result.scalar_one_or_none()
                if posting:
                    postings = [posting]

        else:
            # 规则3: 纯数字 或 字母开头+数字 → 国内单号（结尾是数字）
            # 可能匹配多个posting，返回最近7天的结果（支持分页）
            # 场景：666666 等内部单号用于标记库存商品，会关联大量 posting
            logger.info(f"识别为国内单号（纯数字或字母开头+数字）: {search_value}, print_status: {print_status}")

            # 优化：添加7天时间过滤，避免查询大量历史数据
            from datetime import timedelta
            time_threshold = datetime.now(timezone.utc) - timedelta(days=7)

            # 构建基础过滤条件（使用 posting.ordered_at 避免 JOIN）
            base_conditions = [
                OzonDomesticTracking.tracking_number == search_value,
                OzonPosting.ordered_at >= time_threshold
            ]

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
                .order_by(OzonPosting.ordered_at.desc())
                .offset(offset)
                .limit(limit)
            )
            posting_ids = [row[0] for row in id_result.fetchall()]

            if posting_ids:
                # 只对当前页的 posting 进行 selectinload
                # 需要加载 order.postings 因为 order.to_dict() 会访问
                result = await db.execute(
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.items),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.refunds)
                    )
                    .where(OzonPosting.id.in_(posting_ids))
                )
                postings = result.scalars().all()
            else:
                postings = []

        if not postings:
            raise HTTPException(status_code=404, detail=f"未找到单号为 {tracking_number} 的货件")

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

        # 构建返回数据列表
        result_list = []
        for posting in postings:
            order = posting.order
            if not order:
                continue

            # 转换为字典，指定 target_posting_number 确保只返回查询到的 posting 数据
            order_dict = order.to_dict(target_posting_number=posting.posting_number)

            # 添加前端期望的字段（从查询到的 posting 提取，而不是 order.postings[0]）
            # 添加 status（前端期望的字段名）
            order_dict['status'] = posting.status
            # 添加 operation_status
            order_dict['operation_status'] = posting.operation_status
            # 添加 tracking_number（从 packages 或 raw_payload 提取）
            if posting.packages and len(posting.packages) > 0:
                order_dict['tracking_number'] = posting.packages[0].tracking_number
            elif posting.raw_payload and 'tracking_number' in posting.raw_payload:
                order_dict['tracking_number'] = posting.raw_payload['tracking_number']
            else:
                order_dict['tracking_number'] = None
            # 添加 delivery_method（配送方式）
            order_dict['delivery_method'] = posting.delivery_method_name or order.delivery_method
            # 添加 domestic_tracking_numbers（国内单号列表）
            order_dict['domestic_tracking_numbers'] = posting.get_domestic_tracking_numbers()

            # 添加打印状态字段
            order_dict['label_printed_at'] = posting.label_printed_at.isoformat() if posting.label_printed_at else None
            order_dict['label_print_count'] = posting.label_print_count or 0

            # 添加商品列表（从 posting.raw_payload.products 提取，包含图片）
            items = []
            if posting.raw_payload and 'products' in posting.raw_payload:
                for product in posting.raw_payload['products']:
                    offer_id = product.get('offer_id')
                    item = {
                        'sku': product.get('sku'),
                        'name': product.get('name'),
                        'quantity': product.get('quantity'),
                        'price': product.get('price'),
                        'offer_id': offer_id,
                        'image': offer_id_images.get(offer_id) if offer_id else None
                    }
                    items.append(item)
            order_dict['items'] = items

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
            # SKU搜索
            if sku:
                try:
                    sku_int = int(sku)
                    subquery = exists(
                        select(literal_column('1'))
                        .select_from(
                            func.jsonb_array_elements(OzonPosting.raw_payload['products']).alias('product')
                        )
                        .where(
                            literal_column("product->>'sku'") == str(sku_int)
                        )
                    )
                    query = query.where(subquery)
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
        count_query = select(func.count(OzonPosting.id)).where(
            OzonPosting.status.in_(['awaiting_packaging', 'awaiting_registration', 'awaiting_deliver']),
            OzonPosting.status != 'cancelled',
            OzonPosting.raw_payload['tracking_number'].astext.isnot(None),
            OzonPosting.raw_payload['tracking_number'].astext != '',
            or_(
                ~exists(
                    select(1).where(
                        OzonDomesticTracking.posting_id == OzonPosting.id
                    )
                ),
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
