"""
扫描单号 API 路由

独立的扫描单号功能，支持发货员角色。

发货员（shipper）只能看到启用发货托管（shipping_managed=True）的店铺订单。
其他角色按正常权限过滤。
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone, timedelta
import logging
import re

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from ..models import OzonPosting, OzonProduct, OzonShop, OzonDomesticTracking, OzonShipmentPackage
from ..utils.datetime_utils import utcnow

router = APIRouter(tags=["scan-shipping"])
logger = logging.getLogger(__name__)


class ShopAccessResult:
    """店铺访问权限结果"""
    def __init__(
        self,
        allowed_shop_ids: Optional[List[int]] = None,
        managed_shop_ids: Optional[List[int]] = None,
        is_shipper: bool = False
    ):
        # 可搜索的店铺ID列表（None表示不限制）
        self.allowed_shop_ids = allowed_shop_ids
        # 已托管的店铺ID列表（用于检测托管订单）
        self.managed_shop_ids = managed_shop_ids or []
        # 是否是发货员
        self.is_shipper = is_shipper


async def get_shipping_allowed_shop_ids(
    user: User,
    db: AsyncSession
) -> ShopAccessResult:
    """
    获取用户可以进行扫描发货的店铺ID列表

    权限规则：
    - shipper: 只能看到启用发货托管（shipping_managed=True）的店铺
    - admin: 可以搜索未托管的店铺订单，托管订单提示已托管
    - manager/sub_account: 只能搜索其授权店铺中未托管的店铺，托管订单提示已托管

    Args:
        user: 用户对象
        db: 数据库会话

    Returns:
        ShopAccessResult: 包含可访问店铺ID和托管店铺ID
    """
    if user.role == "shipper":
        # 发货员只能看到启用发货托管的店铺
        stmt = select(OzonShop.id).where(
            OzonShop.shipping_managed == True,
            OzonShop.status == "active"
        )
        result = await db.execute(stmt)
        shop_ids = [row[0] for row in result.fetchall()]
        logger.debug(f"发货员 {user.username} 可访问的托管店铺: {shop_ids}")
        return ShopAccessResult(
            allowed_shop_ids=shop_ids,
            managed_shop_ids=shop_ids,
            is_shipper=True
        )

    # admin/manager/sub_account: 获取授权店铺
    from ef_core.models.users import user_shops

    if user.role == "admin":
        # admin 可访问所有店铺
        authorized_shop_ids = None
    else:
        # 优先使用缓存的 shop_ids（从 JWT 获取）
        cached = getattr(user, '_cached_shop_ids', None)
        if cached is not None:
            authorized_shop_ids = cached
        else:
            # 回退：查询数据库
            stmt = select(user_shops.c.shop_id).where(user_shops.c.user_id == user.id)
            result = await db.execute(stmt)
            authorized_shop_ids = [row[0] for row in result.fetchall()]

    # 获取所有托管店铺ID
    if authorized_shop_ids is None:
        # admin: 获取所有托管店铺
        stmt = select(OzonShop.id).where(
            OzonShop.shipping_managed == True,
            OzonShop.status == "active"
        )
    else:
        if not authorized_shop_ids:
            return ShopAccessResult(allowed_shop_ids=[], managed_shop_ids=[])
        # manager/sub_account: 获取授权范围内的托管店铺
        stmt = select(OzonShop.id).where(
            OzonShop.id.in_(authorized_shop_ids),
            OzonShop.shipping_managed == True,
            OzonShop.status == "active"
        )
    result = await db.execute(stmt)
    managed_shop_ids = [row[0] for row in result.fetchall()]

    # 获取未托管的店铺ID（这些是主账号/子账号可以搜索的）
    if authorized_shop_ids is None:
        # admin: 获取所有未托管店铺
        stmt = select(OzonShop.id).where(
            OzonShop.shipping_managed == False,
            OzonShop.status == "active"
        )
    else:
        # manager/sub_account: 获取授权范围内的未托管店铺
        stmt = select(OzonShop.id).where(
            OzonShop.id.in_(authorized_shop_ids),
            OzonShop.shipping_managed == False,
            OzonShop.status == "active"
        )
    result = await db.execute(stmt)
    unmanaged_shop_ids = [row[0] for row in result.fetchall()]

    logger.debug(f"用户 {user.username} 未托管店铺: {unmanaged_shop_ids}, 托管店铺: {managed_shop_ids}")
    return ShopAccessResult(
        allowed_shop_ids=unmanaged_shop_ids,
        managed_shop_ids=managed_shop_ids,
        is_shipper=False
    )


def build_shipping_shop_filter(shop_model, shop_ids: Optional[List[int]]):
    """
    构建店铺过滤的 SQLAlchemy 查询条件

    Args:
        shop_model: 数据模型类（必须有 shop_id 字段）
        shop_ids: 店铺ID列表，None表示不过滤

    Returns:
        SQLAlchemy 查询条件，或 True（不过滤）
    """
    if shop_ids is None:
        return True

    if not shop_ids:
        return False

    return shop_model.shop_id.in_(shop_ids)


async def _find_posting_in_managed_shops(
    db: AsyncSession,
    search_value: str,
    managed_shop_ids: List[int]
) -> Optional["OzonPosting"]:
    """
    检查订单是否存在于托管店铺中

    用于非发货员角色：当搜索不到订单时，检查是否是因为订单属于托管店铺
    """
    if not managed_shop_ids:
        return None

    # 智能识别单号类型并搜索
    if '-' in search_value:
        # 货件编号
        if re.match(r'^\d+-\d+$', search_value):
            search_pattern = search_value + '-%'
            query = select(OzonPosting).where(
                OzonPosting.posting_number.like(search_pattern),
                OzonPosting.shop_id.in_(managed_shop_ids)
            )
        else:
            query = select(OzonPosting).where(
                OzonPosting.posting_number == search_value,
                OzonPosting.shop_id.in_(managed_shop_ids)
            )
        result = await db.execute(query.limit(1))
        return result.scalar_one_or_none()

    elif search_value[-1].isalpha() and any(c.isdigit() for c in search_value):
        # OZON追踪号码
        package_result = await db.execute(
            select(OzonShipmentPackage.posting_id)
            .where(OzonShipmentPackage.tracking_number == search_value)
        )
        posting_id = package_result.scalar_one_or_none()
        if posting_id:
            query = select(OzonPosting).where(
                OzonPosting.id == posting_id,
                OzonPosting.shop_id.in_(managed_shop_ids)
            )
            result = await db.execute(query)
            return result.scalar_one_or_none()

        # 尝试raw_payload
        query = select(OzonPosting).where(
            OzonPosting.raw_payload['tracking_number'].astext == search_value,
            OzonPosting.shop_id.in_(managed_shop_ids)
        )
        result = await db.execute(query.limit(1))
        return result.scalar_one_or_none()

    else:
        # 国内单号
        query = (
            select(OzonPosting)
            .join(OzonDomesticTracking, OzonDomesticTracking.posting_id == OzonPosting.id)
            .where(
                OzonDomesticTracking.tracking_number == search_value,
                OzonPosting.shop_id.in_(managed_shop_ids)
            )
        )
        result = await db.execute(query.limit(1))
        return result.scalar_one_or_none()


@router.get("/scan-shipping/search")
async def scan_shipping_search(
    tracking_number: str = Query(..., description="追踪号码/国内单号/货件编号"),
    offset: int = Query(0, ge=0, description="分页偏移量"),
    limit: int = Query(20, ge=1, le=100, description="每页数量，默认20"),
    print_status: Optional[str] = Query(None, description="打印状态过滤：all(全部)/printed(已打印)/unprinted(未打印)"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    扫描单号搜索（独立页面使用）

    支持所有角色，但权限过滤有区别：
    - shipper: 只能看到启用发货托管（shipping_managed=True）的店铺订单
    - admin/manager/sub_account: 只能搜索未托管的店铺订单，托管订单返回提示

    智能识别规则：
    1. 包含"-" → 货件编号（posting_number），如 "12345-0001-1"
    2. 结尾是字母 且 包含数字 → OZON追踪号码（packages.tracking_number），如 "UNIM83118549CN"
    3. 纯数字 或 字母开头+数字 → 国内单号（domestic_tracking_number），如 "75324623944112" 或 "SF1234567890"

    返回：posting 列表（当国内单号匹配多个posting时，返回所有匹配结果）
    """
    try:
        # 根据用户角色获取可访问的店铺列表
        access_result = await get_shipping_allowed_shop_ids(current_user, db)

        # 如果用户没有任何可访问的店铺权限
        if access_result.allowed_shop_ids is not None and not access_result.allowed_shop_ids:
            logger.info(f"用户 {current_user.username} 没有可访问的店铺")
            return {
                "data": [],
                "total": 0,
                "offset": offset,
                "limit": limit,
                "has_more": False,
                "offer_id_images": {},
                "message": "没有可访问的店铺" if access_result.is_shipper else "所有店铺已托管发货"
            }

        # 构建店铺权限过滤条件
        shop_filter = build_shipping_shop_filter(OzonPosting, access_result.allowed_shop_ids)

        # 统一转大写
        search_value = tracking_number.strip().upper()
        postings = []
        total_count = 0

        # 智能识别单号类型
        if '-' in search_value:
            # 规则1: 包含"-" → 货件编号
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
                if shop_filter is not True:
                    query = query.where(shop_filter)
                result = await db.execute(query)
                posting = result.scalar_one_or_none()
                if posting:
                    postings = [posting]

        elif search_value[-1].isalpha() and any(c.isdigit() for c in search_value):
            # 规则2: 结尾是字母 且 包含数字 → OZON追踪号码
            logger.info(f"识别为OZON追踪号码: {search_value}")
            package_result = await db.execute(
                select(OzonShipmentPackage)
                .where(OzonShipmentPackage.tracking_number == search_value)
            )
            package = package_result.scalar_one_or_none()

            if package:
                logger.info(f"找到包裹，posting_id: {package.posting_id}")
                query = (
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings)
                    )
                    .where(OzonPosting.id == package.posting_id)
                )
                if shop_filter is not True:
                    query = query.where(shop_filter)
                result = await db.execute(query)
                posting = result.scalar_one_or_none()
                if posting:
                    postings = [posting]
            else:
                # 如果packages表中没有，尝试从raw_payload查询
                query = (
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.domestic_trackings)
                    )
                    .where(OzonPosting.raw_payload['tracking_number'].astext == search_value)
                )
                if shop_filter is not True:
                    query = query.where(shop_filter)
                result = await db.execute(query)
                posting = result.scalar_one_or_none()
                if posting:
                    postings = [posting]

        else:
            # 规则3: 国内单号（纯数字或字母开头+数字）
            logger.info(f"识别为国内单号: {search_value}, print_status: {print_status}")

            # 添加12天时间过滤
            time_threshold = datetime.now(timezone.utc) - timedelta(days=12)

            # 构建基础过滤条件
            base_conditions = [
                OzonDomesticTracking.tracking_number == search_value,
                OzonPosting.in_process_at >= time_threshold
            ]

            if shop_filter is not True:
                base_conditions.append(shop_filter)

            # 添加打印状态过滤
            packing_statuses = ['awaiting_stock', 'allocating', 'allocated', 'tracking_confirmed']

            if print_status == 'printed':
                base_conditions.append(OzonPosting.operation_status == 'printed')
            elif print_status == 'unprinted':
                base_conditions.append(
                    or_(
                        OzonPosting.operation_status.is_(None),
                        OzonPosting.operation_status.in_(packing_statuses)
                    )
                )
            else:
                base_conditions.append(
                    or_(
                        OzonPosting.operation_status.is_(None),
                        OzonPosting.operation_status.in_(packing_statuses + ['printed'])
                    )
                )

            # 查询总数
            count_result = await db.execute(
                select(func.count(OzonPosting.id))
                .join(OzonDomesticTracking, OzonDomesticTracking.posting_id == OzonPosting.id)
                .where(*base_conditions)
            )
            total_count = count_result.scalar() or 0

            # 分页查询
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
            # 如果非发货员没有找到订单，检查是否存在于托管店铺中
            if not access_result.is_shipper and access_result.managed_shop_ids:
                # 检查订单是否在托管店铺中
                managed_posting = await _find_posting_in_managed_shops(
                    db, search_value, access_result.managed_shop_ids
                )
                if managed_posting:
                    logger.info(f"单号 {tracking_number} 属于托管店铺")
                    return {
                        "data": [],
                        "total": 0,
                        "offset": offset,
                        "limit": limit,
                        "has_more": False,
                        "offer_id_images": {},
                        "is_managed": True,
                        "message": "该订单已经托管发货"
                    }

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
                    if isinstance(images, dict):
                        if images.get("primary"):
                            offer_id_images[offer_id] = images["primary"]
                        elif images.get("main") and isinstance(images["main"], list) and images["main"]:
                            offer_id_images[offer_id] = images["main"][0]
                    elif isinstance(images, list) and images:
                        offer_id_images[offer_id] = images[0]

        # 构建返回数据
        result_list = []
        for posting in postings:
            order_dict = posting.to_packing_dict()

            # 补充商品图片
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

        # 按下单时间倒序排序
        result_list.sort(key=lambda x: x.get('ordered_at') or '', reverse=True)

        actual_total = total_count if total_count > 0 else len(result_list)
        has_more = (offset + limit) < actual_total if total_count > 0 else False

        logger.info(f"单号 {search_value} 匹配到 {len(result_list)} 个货件 (总数: {actual_total})")
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
        logger.error(f"扫描单号查询失败: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")


@router.get("/scan-shipping/shops")
async def get_shipping_managed_shops(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取用户可操作的店铺列表

    - shipper: 返回托管店铺列表
    - admin/manager/sub_account: 返回未托管店铺列表
    """
    access_result = await get_shipping_allowed_shop_ids(current_user, db)

    if not access_result.allowed_shop_ids:
        return {"data": [], "is_shipper": access_result.is_shipper}

    stmt = select(OzonShop).where(
        OzonShop.id.in_(access_result.allowed_shop_ids)
    )

    result = await db.execute(stmt.order_by(OzonShop.created_at.desc()))
    shops = result.scalars().all()

    shops_data = []
    for shop in shops:
        shops_data.append({
            "id": shop.id,
            "shop_name": shop.shop_name,
            "shop_name_cn": shop.shop_name_cn,
            "display_name": shop.shop_name_cn or shop.shop_name,
            "platform": shop.platform,
            "status": shop.status
        })

    return {"data": shops_data, "is_shipper": access_result.is_shipper}


@router.get("/scan-shipping/access")
async def check_scan_shipping_access(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    检查用户是否有扫描单号的权限

    用于前端判断是否显示扫描单号菜单：
    - shipper: 总是显示（只要有托管店铺）
    - admin/manager/sub_account: 只有当有未托管店铺时才显示

    返回：
    - has_access: 是否有权限访问扫描单号页面
    - is_shipper: 是否是发货员
    - shop_count: 可操作的店铺数量
    """
    access_result = await get_shipping_allowed_shop_ids(current_user, db)

    shop_count = len(access_result.allowed_shop_ids) if access_result.allowed_shop_ids else 0
    has_access = shop_count > 0

    return {
        "has_access": has_access,
        "is_shipper": access_result.is_shipper,
        "shop_count": shop_count
    }


@router.get("/scan-shipping/history")
async def get_print_history(
    search: Optional[str] = Query(None, description="搜索关键词（货件编号/国内单号/追踪号码）"),
    date_from: Optional[str] = Query(None, description="开始日期（YYYY-MM-DD）"),
    date_to: Optional[str] = Query(None, description="结束日期（YYYY-MM-DD）"),
    offset: int = Query(0, ge=0, description="分页偏移量"),
    limit: int = Query(20, ge=1, le=100, description="每页数量"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取打印历史记录

    返回用户可访问店铺中已打印的订单，支持：
    - 单号搜索（货件编号、国内快递单号、追踪号码）
    - 日期范围过滤（按打印时间）
    - 分页
    """
    try:
        # 获取用户可访问的店铺
        access_result = await get_shipping_allowed_shop_ids(current_user, db)

        # 对于发货员，使用托管店铺；对于其他角色，合并托管和非托管店铺
        if access_result.is_shipper:
            allowed_shop_ids = access_result.allowed_shop_ids
        else:
            # 非发货员可以查看所有授权店铺的打印历史
            allowed_shop_ids = list(set(
                (access_result.allowed_shop_ids or []) +
                (access_result.managed_shop_ids or [])
            ))

        if not allowed_shop_ids:
            return {
                "data": [],
                "total": 0,
                "offset": offset,
                "limit": limit,
                "has_more": False
            }

        # 构建基础查询条件
        base_conditions = [
            OzonPosting.shop_id.in_(allowed_shop_ids),
            OzonPosting.operation_status == 'printed',
            OzonPosting.label_printed_at.isnot(None)
        ]

        # 发货员只能查看自己打印的记录
        if access_result.is_shipper:
            base_conditions.append(OzonPosting.label_printed_by == current_user.id)

        # 日期范围过滤
        if date_from:
            try:
                from_dt = datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                base_conditions.append(OzonPosting.label_printed_at >= from_dt)
            except ValueError:
                pass

        if date_to:
            try:
                to_dt = datetime.strptime(date_to, "%Y-%m-%d").replace(
                    hour=23, minute=59, second=59, tzinfo=timezone.utc
                )
                base_conditions.append(OzonPosting.label_printed_at <= to_dt)
            except ValueError:
                pass

        # 搜索条件
        search_conditions = None
        if search:
            search_value = search.strip().upper()
            if search_value:
                # 构建搜索子查询
                # 1. 货件编号匹配
                posting_number_cond = OzonPosting.posting_number.ilike(f"%{search_value}%")

                # 2. 追踪号码匹配（从packages表）
                tracking_subquery = (
                    select(OzonShipmentPackage.posting_id)
                    .where(OzonShipmentPackage.tracking_number.ilike(f"%{search_value}%"))
                )

                # 3. 国内单号匹配
                domestic_subquery = (
                    select(OzonDomesticTracking.posting_id)
                    .where(OzonDomesticTracking.tracking_number.ilike(f"%{search_value}%"))
                )

                search_conditions = or_(
                    posting_number_cond,
                    OzonPosting.id.in_(tracking_subquery),
                    OzonPosting.id.in_(domestic_subquery)
                )

        # 查询总数
        count_query = select(func.count(OzonPosting.id)).where(*base_conditions)
        if search_conditions is not None:
            count_query = count_query.where(search_conditions)
        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0

        # 分页查询
        query = (
            select(OzonPosting)
            .options(
                selectinload(OzonPosting.packages),
                selectinload(OzonPosting.domestic_trackings)
            )
            .where(*base_conditions)
        )
        if search_conditions is not None:
            query = query.where(search_conditions)

        query = query.order_by(OzonPosting.label_printed_at.desc()).offset(offset).limit(limit)

        result = await db.execute(query)
        postings = result.scalars().all()

        # 收集offer_id用于查询图片
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
                    if isinstance(images, dict):
                        if images.get("primary"):
                            offer_id_images[offer_id] = images["primary"]
                        elif images.get("main") and isinstance(images["main"], list) and images["main"]:
                            offer_id_images[offer_id] = images["main"][0]
                    elif isinstance(images, list) and images:
                        offer_id_images[offer_id] = images[0]

        # 构建返回数据
        result_list = []
        for posting in postings:
            order_dict = posting.to_packing_dict()

            # 补充商品图片
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

        return {
            "data": result_list,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": (offset + limit) < total
        }

    except Exception as e:
        logger.error(f"获取打印历史失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")
