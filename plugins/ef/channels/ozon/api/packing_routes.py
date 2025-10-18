"""
打包发货操作 API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, and_, desc, cast
from sqlalchemy.dialects.postgresql import JSONB
from decimal import Decimal
from pydantic import BaseModel, Field
from datetime import datetime, timezone
import logging

from ef_core.database import get_async_session
from ..models import OzonOrder, OzonPosting, OzonProduct, OzonShop
from ..utils.datetime_utils import utcnow

router = APIRouter(tags=["ozon-packing"])
logger = logging.getLogger(__name__)


# DTO 模型
class PrepareStockDTO(BaseModel):
    """备货请求 DTO"""
    purchase_price: Decimal = Field(..., description="进货价格（必填）")
    source_platform: Optional[str] = Field(None, description="采购平台（可选：1688/拼多多/咸鱼/淘宝）")
    order_notes: Optional[str] = Field(None, description="订单备注（可选）")


class UpdateBusinessInfoDTO(BaseModel):
    """更新业务信息请求 DTO"""
    purchase_price: Optional[Decimal] = Field(None, description="进货价格（可选）")
    material_cost: Optional[Decimal] = Field(None, description="打包费用（可选）")
    source_platform: Optional[str] = Field(None, description="采购平台（可选）")
    order_notes: Optional[str] = Field(None, description="订单备注（可选）")


class SubmitDomesticTrackingDTO(BaseModel):
    """填写国内单号请求 DTO"""
    domestic_tracking_number: str = Field(..., description="国内物流单号（必填）")
    order_notes: Optional[str] = Field(None, description="订单备注（可选）")


@router.post("/postings/{posting_number}/prepare")
async def prepare_stock(
    posting_number: str,
    request: PrepareStockDTO,
    db: AsyncSession = Depends(get_async_session)
):
    """
    备货操作：保存业务信息 + 调用 OZON exemplar set API

    操作流程：
    1. 保存进货价格、采购平台、备注
    2. 调用 OZON exemplar set API（自动构造合规数据）
    3. 更新操作状态为"分配中"
    4. 更新操作时间

    幂等性：如果状态已 >= allocating，返回错误
    """
    from ..services.posting_operations import PostingOperationsService

    service = PostingOperationsService(db)
    result = await service.prepare_stock(
        posting_number=posting_number,
        purchase_price=request.purchase_price,
        source_platform=request.source_platform,
        order_notes=request.order_notes
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    return result


@router.patch("/postings/{posting_number}")
async def update_posting_business_info(
    posting_number: str,
    request: UpdateBusinessInfoDTO,
    db: AsyncSession = Depends(get_async_session)
):
    """
    更新业务信息（不改变操作状态）

    用于"分配中"状态下修改进货价格、采购平台、备注等字段
    """
    from ..services.posting_operations import PostingOperationsService

    service = PostingOperationsService(db)
    result = await service.update_business_info(
        posting_number=posting_number,
        purchase_price=request.purchase_price,
        material_cost=request.material_cost,
        source_platform=request.source_platform,
        order_notes=request.order_notes
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    return result


@router.post("/postings/{posting_number}/domestic-tracking")
async def submit_domestic_tracking(
    posting_number: str,
    request: SubmitDomesticTrackingDTO,
    db: AsyncSession = Depends(get_async_session)
):
    """
    填写国内物流单号 + 同步跨境巴士

    操作流程：
    1. 保存国内物流单号和备注
    2. 同步到跨境巴士
    3. 更新操作状态为"单号确认"
    4. 更新操作时间

    幂等性：如果状态已是 tracking_confirmed，返回错误
    """
    from ..services.posting_operations import PostingOperationsService

    service = PostingOperationsService(db)
    result = await service.submit_domestic_tracking(
        posting_number=posting_number,
        domestic_tracking_number=request.domestic_tracking_number,
        order_notes=request.order_notes
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    return result


@router.get("/packing/orders")
async def get_packing_orders(
    offset: int = 0,
    limit: int = Query(50, le=100),
    shop_id: Optional[int] = None,
    posting_number: Optional[str] = None,
    operation_status: Optional[str] = Query(None, description="操作状态筛选：awaiting_stock/allocating/allocated/tracking_confirmed/shipping"),
    ozon_status: Optional[str] = Query(None, description="OZON原生状态筛选，支持逗号分隔的多个状态，如：awaiting_packaging,awaiting_deliver"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取打包发货页面的订单列表
    - 支持按 operation_status 筛选（等待备货/分配中/已分配/单号确认/运输中）
    - 支持按 ozon_status 筛选（OZON原生状态，如 awaiting_packaging, awaiting_deliver）
    - ozon_status 优先级高于 operation_status
    - 如果都不指定，返回所有订单
    """
    from datetime import datetime

    # 构建查询（使用 selectinload 避免懒加载问题）
    from sqlalchemy.orm import selectinload
    query = select(OzonOrder).options(
        selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
        selectinload(OzonOrder.items),
        selectinload(OzonOrder.refunds)
    )

    # 关联 Posting 表（必须，因为要按 Posting 操作状态筛选）
    query = query.join(OzonPosting, OzonOrder.id == OzonPosting.order_id)

    # 核心过滤：优先按 ozon_status 筛选，否则按 operation_status 筛选
    if ozon_status:
        # 支持逗号分隔的多个状态（如：awaiting_packaging,awaiting_deliver）
        status_list = [s.strip() for s in ozon_status.split(',')]
        query = query.where(OzonPosting.status.in_(status_list))
    elif operation_status:
        query = query.where(OzonPosting.operation_status == operation_status)
        # 特殊规则：单号确认状态只显示OZON状态为"等待发运"的订单
        if operation_status == "tracking_confirmed":
            query = query.where(OzonPosting.status == "awaiting_deliver")

    # 应用其他过滤条件
    if shop_id:
        query = query.where(OzonOrder.shop_id == shop_id)

    # 搜索条件
    if posting_number:
        query = query.where(
            (OzonOrder.ozon_order_number.ilike(f"%{posting_number}%")) |
            (OzonOrder.ozon_order_id.ilike(f"%{posting_number}%")) |
            (OzonPosting.posting_number.ilike(f"%{posting_number}%"))
        )

    # 去重（因为一个订单可能有多个posting，使用distinct on id）
    # PostgreSQL要求DISTINCT ON的字段必须出现在ORDER BY的开头
    query = query.distinct(OzonOrder.id).order_by(OzonOrder.id, OzonOrder.ordered_at.desc())

    # 执行查询获取总数
    count_query = select(func.count(OzonOrder.id.distinct())).select_from(OzonOrder).join(
        OzonPosting, OzonOrder.id == OzonPosting.order_id
    )

    # 应用相同的状态筛选逻辑
    if ozon_status:
        status_list = [s.strip() for s in ozon_status.split(',')]
        count_query = count_query.where(OzonPosting.status.in_(status_list))
    elif operation_status:
        count_query = count_query.where(OzonPosting.operation_status == operation_status)
        # 特殊规则：单号确认状态只显示OZON状态为"等待发运"的订单
        if operation_status == "tracking_confirmed":
            count_query = count_query.where(OzonPosting.status == "awaiting_deliver")
    if shop_id:
        count_query = count_query.where(OzonOrder.shop_id == shop_id)
    if posting_number:
        count_query = count_query.where(
            (OzonOrder.ozon_order_number.ilike(f"%{posting_number}%")) |
            (OzonOrder.ozon_order_id.ilike(f"%{posting_number}%")) |
            (OzonPosting.posting_number.ilike(f"%{posting_number}%"))
        )

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 添加分页
    query = query.offset(offset).limit(limit)

    # 执行查询
    result = await db.execute(query)
    orders = result.scalars().all()

    # 提取所有订单中的offer_id
    all_offer_ids = set()
    for order in orders:
        if order.items:
            for item in order.items:
                if item.offer_id:
                    all_offer_ids.add(item.offer_id)

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

    # 将图片信息添加到订单数据中
    orders_data = []
    for order in orders:
        order_dict = order.to_dict()
        # 为每个订单项添加图片
        if order_dict.get("items"):
            for item in order_dict["items"]:
                if item.get("offer_id") and item["offer_id"] in offer_id_images:
                    item["image"] = offer_id_images[item["offer_id"]]
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

    # 1. 查询商品名称（从products表）
    product_result = await db.execute(
        select(OzonProduct.title, OzonProduct.offer_id)
        .where(OzonProduct.sku == str(sku))
        .limit(1)
    )
    product = product_result.first()
    product_name = product[0] if product else None
    offer_id = product[1] if product else None

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
                OzonPosting.raw_payload['products'].op('@>')(
                    cast([{'sku': int(sku)}], JSONB)
                )  # JSONB数组包含查询：sku为整数
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
        "product_name": product_name,
        "offer_id": offer_id,
        "history": history_records,
        "total": len(history_records)
    }


@router.post("/orders/prepare")
async def prepare_order(
    posting_number: str = Body(..., description="发货单号"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    提交备货请求（FBS订单备货流程）

    流程说明:
    1. 更新posting的operation_time为当前时间
    2. 设置exemplar信息（样件信息）
    3. 验证exemplar
    4. 获取备货状态

    Args:
        posting_number: 发货单号

    Returns:
        备货结果，包含状态信息
    """
    from datetime import datetime, timezone
    from ..models import OzonPosting
    from sqlalchemy import select, update

    try:
        # 1. 获取posting记录
        result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            return {
                "success": False,
                "error": "POSTING_NOT_FOUND",
                "message": f"发货单 {posting_number} 不存在"
            }

        # 2. 检查状态是否为等待备货
        if posting.status != "awaiting_packaging":
            return {
                "success": False,
                "error": "INVALID_STATUS",
                "message": f"当前状态为 {posting.status}，无法执行备货操作"
            }

        # 3. 更新operation_time
        current_time = datetime.now(timezone.utc)
        await db.execute(
            update(OzonPosting)
            .where(OzonPosting.id == posting.id)
            .values(operation_time=current_time)
        )
        await db.commit()

        # 4. 获取店铺API凭证
        from ..models import OzonShop
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == posting.shop_id)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            return {
                "success": False,
                "error": "SHOP_NOT_FOUND",
                "message": "店铺信息不存在"
            }

        # 5. 调用OZON API进行备货
        from ..api.client import OzonAPIClient

        async with OzonAPIClient(shop.client_id, shop.api_key, shop.id) as client:
            # 从raw_payload中提取商品信息
            products_data = []
            if posting.raw_payload and 'products' in posting.raw_payload:
                for product in posting.raw_payload['products']:
                    # 构建简化的exemplar数据（标记GTD和RNPT为缺失）
                    products_data.append({
                        "product_id": product.get('product_id', 0),
                        "exemplars": [{
                            "is_gtd_absent": True,  # 标记无GTD
                            "is_rnpt_absent": True,  # 标记无RNPT
                            "marks": []  # 空标记列表
                        }]
                    })

            # 如果没有商品数据，返回错误
            if not products_data:
                return {
                    "success": False,
                    "error": "NO_PRODUCTS",
                    "message": "发货单中没有找到商品信息"
                }

            # 设置exemplar
            await client.set_exemplar(posting_number, products_data)

            # 验证exemplar
            await client.validate_exemplar(posting_number, products_data)

            # 获取备货状态
            status_result = await client.get_exemplar_status(posting_number)

            # 检查状态
            status = status_result.get('status')
            if status == 'ship_available':
                message = "备货成功，订单可以发货"
            elif status == 'validation_in_process':
                message = "样件验证中，请稍后查看状态"
            else:
                message = "备货失败，无法发货"

            return {
                "success": True,
                "message": message,
                "data": {
                    "posting_number": posting_number,
                    "operation_time": current_time.isoformat(),
                    "status": status,
                    "products": status_result.get('products', [])
                }
            }

    except Exception as e:
        logger.error(f"备货失败: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "success": False,
            "error": "PREPARE_FAILED",
            "message": f"备货失败: {str(e)}"
        }


@router.post("/packing/postings/{posting_number}/discard")
async def discard_posting(
    posting_number: str,
    db: AsyncSession = Depends(get_async_session)
):
    """
    废弃订单（同步到跨境84并更新本地状态）

    流程说明:
    1. 获取跨境84有效Cookie
    2. 通过 posting_number 查询跨境84订单获取 oid
    3. 提交废弃请求到跨境84
    4. 更新本地 OzonPosting 的 operation_status 为 'cancelled'

    Args:
        posting_number: 发货单号

    Returns:
        废弃结果，包含成功/失败信息
    """
    try:
        # 1. 验证 posting 是否存在
        result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            return {
                "success": False,
                "error": "POSTING_NOT_FOUND",
                "message": f"发货单 {posting_number} 不存在"
            }

        # 2. 检查是否已经是取消状态
        if posting.operation_status == "cancelled":
            return {
                "success": False,
                "error": "ALREADY_CANCELLED",
                "message": "订单已经是取消状态"
            }

        # 3. 获取跨境84服务并调用废弃接口
        from ..services.kuajing84_sync import create_kuajing84_sync_service
        from ..services.kuajing84_client import Kuajing84Client
        from ..models.kuajing84_global_config import Kuajing84GlobalConfig

        kuajing84_service = create_kuajing84_sync_service(db)

        # 每次操作前都重新登录获取新Cookie（强制刷新）
        logger.info("废弃订单前先重新登录跨境84")

        # 获取配置
        config_result = await db.execute(
            select(Kuajing84GlobalConfig).where(Kuajing84GlobalConfig.id == 1)
        )
        config = config_result.scalar_one_or_none()

        if not config or not config.enabled:
            return {
                "success": False,
                "error": "NO_CONFIG",
                "message": "跨境84未配置或未启用"
            }

        # 解密密码
        password = kuajing84_service._decrypt(config.password)

        # 重新登录获取最新Cookie
        client = Kuajing84Client(base_url=config.base_url, timeout=60.0)
        try:
            login_result = await client.login(config.username, password)
            cookies = login_result["cookies"]

            # 更新数据库中的Cookie
            from datetime import datetime, timezone
            config.cookie = cookies
            config.cookie_expires_at = datetime.fromisoformat(login_result["expires_at"].replace("Z", "+00:00"))
            await db.commit()

            logger.info("跨境84登录成功，Cookie已更新")

        except Exception as e:
            logger.error(f"跨境84登录失败: {e}")
            return {
                "success": False,
                "error": "LOGIN_FAILED",
                "message": f"跨境84登录失败: {str(e)}"
            }

        # 调用跨境84 API 废弃订单
        try:
            discard_result = await client.discard_order(posting_number, cookies)
        finally:
            # 确保关闭client释放资源
            await client.close()

        if not discard_result.get("success"):
            logger.error(f"跨境84废弃订单失败: {discard_result.get('message')}")
            return {
                "success": False,
                "error": "KUAJING84_DISCARD_FAILED",
                "message": discard_result.get("message", "废弃订单失败")
            }

        # 4. 更新本地数据库状态为 'cancelled'
        await db.execute(
            update(OzonPosting)
            .where(OzonPosting.id == posting.id)
            .values(
                operation_status="cancelled",
                updated_at=utcnow()
            )
        )
        await db.commit()

        logger.info(f"订单 {posting_number} 已成功废弃")

        return {
            "success": True,
            "message": "订单废弃成功",
            "data": {
                "posting_number": posting_number,
                "operation_status": "cancelled"
            }
        }

    except Exception as e:
        logger.error(f"废弃订单失败: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        await db.rollback()
        return {
            "success": False,
            "error": "DISCARD_FAILED",
            "message": f"废弃订单失败: {str(e)}"
        }
