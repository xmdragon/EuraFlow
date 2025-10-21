"""
打包发货操作 API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Body, Request
from typing import Optional, List
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, and_, or_, desc, cast, exists
from sqlalchemy.dialects.postgresql import JSONB
from decimal import Decimal
from datetime import datetime, timezone
import logging

from ef_core.database import get_async_session
from ..models import OzonOrder, OzonPosting, OzonProduct, OzonShop, OzonDomesticTracking, OzonShipmentPackage
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
    """填写国内单号请求 DTO（支持多单号）"""
    # 新字段：数组输入（推荐）
    domestic_tracking_numbers: Optional[List[str]] = Field(None, min_length=1, max_length=10, description="国内物流单号列表（支持多个）")

    # 兼容字段：单值输入（废弃但保留）
    domestic_tracking_number: Optional[str] = Field(None, description="[已废弃] 单个国内物流单号，请使用 domestic_tracking_numbers")

    order_notes: Optional[str] = Field(None, description="订单备注（可选）")

    def get_tracking_numbers(self) -> List[str]:
        """获取国内单号列表（兼容逻辑）"""
        if self.domestic_tracking_numbers:
            return self.domestic_tracking_numbers
        if self.domestic_tracking_number:
            return [self.domestic_tracking_number]
        return []


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
    填写国内物流单号 + 同步跨境巴士（支持多单号）

    操作流程：
    1. 保存国内物流单号列表（支持多个）和备注
    2. 同步到跨境巴士（使用第一个单号）
    3. 更新操作状态为"单号确认"
    4. 更新操作时间

    幂等性：如果状态已是 tracking_confirmed，返回错误
    """
    from ..services.posting_operations import PostingOperationsService

    # 获取国内单号列表（兼容单值和数组输入）
    tracking_numbers = request.get_tracking_numbers()

    if not tracking_numbers:
        raise HTTPException(status_code=400, detail="至少需要提供一个国内物流单号")

    service = PostingOperationsService(db)
    result = await service.submit_domestic_tracking(
        posting_number=posting_number,
        domestic_tracking_numbers=tracking_numbers,
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

    # 核心过滤：基于 ozon_status + 追踪号码/国内单号
    # 优先使用 operation_status，如果有 ozon_status 参数则转换为 operation_status
    if ozon_status:
        # 兼容旧的 ozon_status 参数（前端可能还在使用）
        operation_status = 'awaiting_stock'

    if operation_status == 'awaiting_stock':
        # 等待备货：ozon_status = 'awaiting_packaging'
        query = query.where(OzonPosting.status == 'awaiting_packaging')

    elif operation_status == 'allocating':
        # 分配中：ozon_status = 'awaiting_deliver' AND 无追踪号码
        # 检查 raw_payload['tracking_number'] 是否为空或不存在
        query = query.where(
            and_(
                OzonPosting.status == 'awaiting_deliver',
                or_(
                    OzonPosting.raw_payload['tracking_number'].astext.is_(None),
                    OzonPosting.raw_payload['tracking_number'].astext == '',
                    ~OzonPosting.raw_payload.has_key('tracking_number')
                )
            )
        )

    elif operation_status == 'allocated':
        # 已分配：ozon_status = 'awaiting_deliver' AND 有追踪号码 AND 无国内单号
        query = query.where(
            and_(
                OzonPosting.status == 'awaiting_deliver',
                # 有追踪号码
                OzonPosting.raw_payload['tracking_number'].astext.isnot(None),
                OzonPosting.raw_payload['tracking_number'].astext != '',
                # 无国内单号 - 使用 NOT EXISTS 子查询
                ~exists(
                    select(1).where(
                        OzonDomesticTracking.posting_id == OzonPosting.id
                    )
                )
            )
        )

    elif operation_status == 'tracking_confirmed':
        # 确认单号：ozon_status = 'awaiting_deliver' AND operation_status = 'tracking_confirmed'
        query = query.where(
            and_(
                OzonPosting.status == 'awaiting_deliver',
                OzonPosting.operation_status == 'tracking_confirmed'
            )
        )

    elif operation_status == 'printed':
        # 已打印：ozon_status = 'awaiting_deliver' AND operation_status = 'printed'
        # 这是一个手动标记的状态，不依赖字段存在性
        query = query.where(
            and_(
                OzonPosting.status == 'awaiting_deliver',
                OzonPosting.operation_status == 'printed'
            )
        )

    # 应用其他过滤条件
    if shop_id:
        query = query.where(OzonOrder.shop_id == shop_id)

    # 搜索条件：其他标签只精确匹配货件编号
    if posting_number:
        query = query.where(
            OzonPosting.posting_number == posting_number.strip()
        )

    # 去重（因为一个订单可能有多个posting，使用distinct on id）
    # PostgreSQL要求DISTINCT ON的字段必须出现在ORDER BY的开头
    query = query.distinct(OzonOrder.id).order_by(OzonOrder.id, OzonOrder.ordered_at.desc())

    # 执行查询获取总数
    count_query = select(func.count(OzonOrder.id.distinct())).select_from(OzonOrder).join(
        OzonPosting, OzonOrder.id == OzonPosting.order_id
    )

    # 应用相同的状态筛选逻辑
    if operation_status == 'awaiting_stock':
        count_query = count_query.where(OzonPosting.status == 'awaiting_packaging')

    elif operation_status == 'allocating':
        count_query = count_query.where(
            and_(
                OzonPosting.status == 'awaiting_deliver',
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
                OzonPosting.status == 'awaiting_deliver',
                OzonPosting.raw_payload['tracking_number'].astext.isnot(None),
                OzonPosting.raw_payload['tracking_number'].astext != '',
                # 无国内单号 - 使用 NOT EXISTS 子查询
                ~exists(
                    select(1).where(
                        OzonDomesticTracking.posting_id == OzonPosting.id
                    )
                )
            )
        )

    elif operation_status == 'tracking_confirmed':
        count_query = count_query.where(
            and_(
                OzonPosting.status == 'awaiting_deliver',
                OzonPosting.operation_status == 'tracking_confirmed'
            )
        )

    elif operation_status == 'printed':
        count_query = count_query.where(
            and_(
                OzonPosting.status == 'awaiting_deliver',
                OzonPosting.operation_status == 'printed'
            )
        )

    if shop_id:
        count_query = count_query.where(OzonOrder.shop_id == shop_id)
    if posting_number:
        # 其他标签只精确匹配货件编号
        count_query = count_query.where(
            OzonPosting.posting_number == posting_number.strip()
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
    异步废弃订单（立即返回，后台同步到跨境84）

    流程说明:
    1. 验证 posting 是否存在
    2. 创建同步日志（状态：pending）
    3. 启动后台任务（异步执行废弃操作）
    4. **立即返回**（不等待跨境84同步完成）

    前端应使用 /kuajing84/sync-status/{sync_log_id} 轮询同步状态

    Args:
        posting_number: 发货单号

    Returns:
        废弃结果，包含 sync_log_id 用于轮询
    """
    from ..services.posting_operations import PostingOperationsService

    try:
        service = PostingOperationsService(db)
        result = await service.discard_posting_async(posting_number)

        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["message"])

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"废弃订单失败: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"废弃订单失败: {str(e)}")


class BatchPrintRequest(BaseModel):
    """批量打印请求"""
    posting_numbers: List[str] = Field(..., max_items=20, description="货件编号列表（最多20个）")


@router.post("/packing/postings/batch-print-labels")
async def batch_print_labels(
    request: Request,
    body: BatchPrintRequest,
    db: AsyncSession = Depends(get_async_session)
):
    """
    批量打印快递面单（最多20个）

    调试日志：记录接收到的请求

    标签格式: 70mm宽 × 125mm高（竖向）

    说明：shop_id从posting记录中自动获取，无需手动指定

    错误处理策略：
    1. 预检查：检查每个posting的缓存状态
    2. 逐个调用：避免一个失败导致全部失败
    3. 详细错误：返回具体哪些posting_number失败及原因

    Returns:
        成功：
        {
            "success": true,
            "pdf_url": "/downloads/labels/batch_xxx.pdf",
            "cached_count": 5,
            "fetched_count": 3,
            "total": 8
        }

        部分失败：
        {
            "success": false,
            "error": "PARTIAL_FAILURE",
            "message": "部分订单打印失败",
            "failed_postings": [
                {
                    "posting_number": "12345-0001-1",
                    "error": "标签未就绪",
                    "suggestion": "请在45-60秒后重试"
                }
            ],
            "success_postings": ["11111-0003-1"],
            "pdf_url": "/downloads/labels/batch_xxx.pdf"
        }
    """
    import os
    import base64
    import uuid
    import httpx
    from datetime import datetime
    import json

    # 获取请求参数
    posting_numbers = body.posting_numbers

    # 调试日志：记录接收到的 posting_numbers
    logger.info(f"📝 批量打印标签请求 - posting_numbers: {posting_numbers}")

    try:
        # 1. 验证请求参数
        if not posting_numbers:
            raise HTTPException(status_code=400, detail="posting_numbers不能为空")

        if len(posting_numbers) > 20:
            raise HTTPException(status_code=400, detail="最多支持20个货件")

        # 2. 查询所有posting，检查缓存状态和获取shop_id
        postings_result = await db.execute(
            select(OzonPosting).where(
                OzonPosting.posting_number.in_(posting_numbers)
            )
        )
        postings = {p.posting_number: p for p in postings_result.scalars().all()}

        # 调试日志：记录查询到的 posting 数量
        logger.info(f"📦 查询结果 - 请求{len(posting_numbers)}个, 找到{len(postings)}个")
        logger.info(f"📦 找到的 posting_numbers: {list(postings.keys())}")

        # 找出缺失的 posting_numbers
        missing_postings = [pn for pn in posting_numbers if pn not in postings]
        if missing_postings:
            logger.warning(f"⚠️ 数据库中不存在的 posting_numbers: {missing_postings}")

        # 验证所有posting是否存在
        if not postings:
            raise HTTPException(status_code=404, detail="未找到任何货件记录")

        # 3. 验证所有posting的状态必须为"awaiting_deliver"（等待发运）
        invalid_status_postings = []
        for pn in posting_numbers:
            posting = postings.get(pn)
            if not posting:
                continue
            if posting.status != 'awaiting_deliver':
                invalid_status_postings.append({
                    "posting_number": pn,
                    "current_status": posting.status,
                    "status_display": {
                        "awaiting_packaging": "等待打包",
                        "awaiting_deliver": "等待发运",
                        "delivering": "运输中",
                        "delivered": "已送达",
                        "cancelled": "已取消"
                    }.get(posting.status, posting.status)
                })

        if invalid_status_postings:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "INVALID_STATUS",
                    "message": "只能打印'等待发运'状态的订单标签",
                    "invalid_postings": invalid_status_postings
                }
            )

        # 4. 获取shop_id（从第一个posting获取，验证所有posting是否属于同一店铺）
        shop_ids = {p.shop_id for p in postings.values()}
        if len(shop_ids) > 1:
            raise HTTPException(status_code=400, detail="不能批量打印不同店铺的订单")

        shop_id = list(shop_ids)[0]

        # 获取店铺信息
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        shop = shop_result.scalar_one_or_none()
        if not shop:
            raise HTTPException(status_code=404, detail="店铺不存在")

        # 4. 分类：有缓存 vs 无缓存
        cached_postings = []
        need_fetch_postings = []

        for pn in posting_numbers:
            posting = postings.get(pn)
            if not posting:
                # posting不存在，记录到need_fetch中（后续会报错）
                need_fetch_postings.append(pn)
                continue

            # 检查缓存文件是否存在
            if posting.label_pdf_path and os.path.exists(posting.label_pdf_path):
                cached_postings.append(pn)
            else:
                need_fetch_postings.append(pn)

        logger.info(f"批量打印: 总{len(posting_numbers)}个, 缓存{len(cached_postings)}个, 需获取{len(need_fetch_postings)}个")

        # 5. 调用OZON API获取未缓存的标签（逐个尝试，捕获错误）
        failed_postings = []
        success_postings = []
        pdf_files = []

        # 5.1 添加已缓存的PDF
        for pn in cached_postings:
            posting = postings.get(pn)
            if posting and posting.label_pdf_path:
                pdf_files.append(posting.label_pdf_path)
                success_postings.append(pn)

        # 5.2 获取未缓存的标签（逐个调用，避免一个失败影响全部）
        from ..api.client import OzonAPIClient

        async with OzonAPIClient(shop.client_id, shop.api_key_enc, shop.id) as client:
            for pn in need_fetch_postings:
                # 检查posting是否存在
                posting = postings.get(pn)
                if not posting:
                    failed_postings.append({
                        "posting_number": pn,
                        "error": "货件不存在",
                        "suggestion": "请检查货件编号是否正确"
                    })
                    continue

                try:
                    # 单个调用OZON API
                    result = await client.get_package_labels([pn])

                    # 解析PDF数据
                    pdf_content_base64 = result.get('file_content', '')
                    if not pdf_content_base64:
                        logger.error(f"OZON API返回的PDF内容为空，result keys: {list(result.keys())}")
                        raise ValueError("OZON API返回的PDF内容为空")

                    pdf_content = base64.b64decode(pdf_content_base64)

                    # 保存PDF文件（保存到 dist 目录，Nginx 可直接访问）
                    label_dir = f"web/dist/downloads/labels/{shop_id}"
                    os.makedirs(label_dir, exist_ok=True)
                    pdf_path = f"{label_dir}/{pn}.pdf"

                    with open(pdf_path, 'wb') as f:
                        f.write(pdf_content)

                    logger.info(f"成功保存标签PDF: {pdf_path}")

                    # 更新数据库
                    await db.execute(
                        update(OzonPosting)
                        .where(OzonPosting.posting_number == pn)
                        .values(label_pdf_path=pdf_path, updated_at=utcnow())
                    )

                    pdf_files.append(pdf_path)
                    success_postings.append(pn)

                except httpx.HTTPStatusError as e:
                    # 捕获HTTP错误，解析OZON API返回的错误信息
                    error_detail = "未知错误"
                    suggestion = "请稍后重试"

                    try:
                        error_data = e.response.json() if e.response else {}
                        error_message = error_data.get('message', '') or str(e)

                        # 解析常见错误
                        if 'aren\'t ready' in error_message.lower() or 'not ready' in error_message.lower():
                            error_detail = "标签未就绪"
                            suggestion = "请在订单装配后45-60秒重试"
                        elif 'not found' in error_message.lower():
                            error_detail = "货件不存在"
                            suggestion = "订单可能已取消或不存在"
                        elif 'invalid' in error_message.lower():
                            error_detail = "货件编号无效"
                            suggestion = "请检查货件编号是否正确"
                        else:
                            error_detail = error_message[:100]  # 限制长度
                    except Exception:
                        error_detail = f"HTTP {e.response.status_code if e.response else 'unknown'}"

                    failed_postings.append({
                        "posting_number": pn,
                        "error": error_detail,
                        "suggestion": suggestion
                    })
                    logger.warning(f"获取标签失败 {pn}: {error_detail}")

                except Exception as e:
                    # 安全地转换异常为字符串，避免UTF-8解码错误
                    exc_type = type(e).__name__
                    try:
                        # 对于httpx.HTTPStatusError，提取状态码
                        if hasattr(e, 'response') and hasattr(e.response, 'status_code'):
                            error_msg = f"{exc_type}: HTTP {e.response.status_code}"
                        elif e.args:
                            # 安全地处理args[0]
                            arg = e.args[0]
                            if isinstance(arg, bytes):
                                error_msg = f"{exc_type}: <binary data, {len(arg)} bytes>"
                            elif isinstance(arg, str):
                                error_msg = f"{exc_type}: {arg[:100]}"
                            else:
                                error_msg = f"{exc_type}: {type(arg).__name__}"
                        else:
                            error_msg = f"{exc_type}: Unknown"
                    except Exception:
                        # 如果所有方法都失败，使用安全的默认消息
                        error_msg = f"{exc_type}: <error details unavailable>"

                    failed_postings.append({
                        "posting_number": pn,
                        "error": error_msg,
                        "suggestion": "请检查网络或联系技术支持"
                    })
                    logger.error(f"获取标签异常 {pn}: {error_msg}")

        await db.commit()

        # 6. 合并PDF文件
        pdf_url = None
        if pdf_files:
            try:
                from PyPDF2 import PdfMerger

                merger = PdfMerger()
                for pdf_file in pdf_files:
                    merger.append(pdf_file)

                # 生成批量PDF文件名（保存到 dist 目录，Nginx 可直接访问）
                batch_filename = f"batch_{int(datetime.now().timestamp())}_{uuid.uuid4().hex[:8]}.pdf"
                batch_path = f"web/dist/downloads/labels/{batch_filename}"

                # 确保目录存在
                os.makedirs(os.path.dirname(batch_path), exist_ok=True)

                merger.write(batch_path)
                merger.close()

                pdf_url = f"/downloads/labels/{batch_filename}"
                logger.info(f"成功合并PDF: {batch_path}")
            except Exception as e:
                logger.error(f"合并PDF失败: {e}")
                # 合并失败不影响结果，只是没有合并后的PDF
                pdf_url = None

        # 7. 返回结果（不再自动标记已打印状态，需用户手动标记）
        if failed_postings and not success_postings:
            # 全部失败
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "ALL_FAILED",
                    "message": "所有订单打印失败",
                    "failed_postings": failed_postings
                }
            )
        elif failed_postings:
            # 部分失败
            return {
                "success": False,
                "error": "PARTIAL_FAILURE",
                "message": f"成功打印{len(success_postings)}个，失败{len(failed_postings)}个",
                "failed_postings": failed_postings,
                "success_postings": success_postings,
                "pdf_url": pdf_url,
                "cached_count": len(cached_postings),
                "fetched_count": len(success_postings) - len(cached_postings),
                "total": len(success_postings)
            }
        else:
            # 全部成功
            return {
                "success": True,
                "message": f"成功打印{len(success_postings)}个标签",
                "pdf_url": pdf_url,
                "cached_count": len(cached_postings),
                "fetched_count": len(success_postings) - len(cached_postings),
                "total": len(success_postings)
            }

    except HTTPException:
        raise
    except Exception as e:
        # 安全地记录异常（避免UTF-8解码错误）
        try:
            error_msg = str(e)
        except UnicodeDecodeError:
            error_msg = repr(e)
        except Exception:
            error_msg = "未知错误"

        logger.error(f"批量打印失败: {error_msg}")
        import traceback
        try:
            logger.error(traceback.format_exc())
        except Exception:
            pass  # traceback也可能包含二进制内容，忽略记录错误
        raise HTTPException(status_code=500, detail=f"打印失败: {error_msg}")


@router.get("/packing/postings/search-by-tracking")
async def search_posting_by_tracking(
    tracking_number: str = Query(..., description="追踪号码/国内单号/货件编号"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    根据追踪号码/国内单号/货件编号查询货件（精确匹配，智能识别）

    智能识别规则：
    1. 包含"-" → 货件编号（posting_number），如 "12345-0001-1"
    2. 结尾是字母 且 包含数字 → OZON追踪号码（packages.tracking_number），如 "UNIM83118549CN"
    3. 纯数字 或 字母开头+数字 → 国内单号（domestic_tracking_number），如 "75324623944112" 或 "SF1234567890"

    返回：posting 详情 + 订单信息 + 商品列表
    """
    from sqlalchemy.orm import selectinload
    from ..models import OzonShipmentPackage

    try:
        search_value = tracking_number.strip()
        posting = None

        # 智能识别单号类型
        if '-' in search_value:
            # 规则1: 包含"-" → 货件编号
            logger.info(f"识别为货件编号: {search_value}")
            result = await db.execute(
                select(OzonPosting)
                .options(
                    selectinload(OzonPosting.packages),
                    selectinload(OzonPosting.order).selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
                    selectinload(OzonPosting.order).selectinload(OzonOrder.items),
                    selectinload(OzonPosting.order).selectinload(OzonOrder.refunds)
                )
                .where(OzonPosting.posting_number == search_value)
            )
            posting = result.scalar_one_or_none()

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
                        selectinload(OzonPosting.order).selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.items),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.refunds)
                    )
                    .where(OzonPosting.id == package.posting_id)
                )
                posting = result.scalar_one_or_none()
            else:
                logger.warning(f"未找到包裹，尝试从raw_payload查询: {search_value}")
                # 如果packages表中没有，尝试从raw_payload查询
                result = await db.execute(
                    select(OzonPosting)
                    .options(
                        selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.items),
                        selectinload(OzonPosting.order).selectinload(OzonOrder.refunds)
                    )
                    .where(OzonPosting.raw_payload['tracking_number'].astext == search_value)
                )
                posting = result.scalar_one_or_none()

        else:
            # 规则3: 纯数字 或 字母开头+数字 → 国内单号（结尾是数字）
            logger.info(f"识别为国内单号（纯数字或字母开头+数字）: {search_value}")
            # 通过关联表查询
            result = await db.execute(
                select(OzonPosting)
                .options(
                    selectinload(OzonPosting.packages),
                    selectinload(OzonPosting.order).selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
                    selectinload(OzonPosting.order).selectinload(OzonOrder.items),
                    selectinload(OzonPosting.order).selectinload(OzonOrder.refunds)
                )
                .join(OzonDomesticTracking, OzonDomesticTracking.posting_id == OzonPosting.id)
                .where(OzonDomesticTracking.tracking_number == search_value)
            )
            posting = result.scalar_one_or_none()

        if not posting:
            raise HTTPException(status_code=404, detail=f"未找到单号为 {tracking_number} 的货件")

        # 获取订单信息
        order = posting.order
        if not order:
            raise HTTPException(status_code=404, detail="订单信息不存在")

        # 查询商品图片（与其他标签逻辑一致）
        offer_id_images = {}
        if order.items:
            all_offer_ids = [item.offer_id for item in order.items if item.offer_id]
            if all_offer_ids:
                product_query = select(OzonProduct.offer_id, OzonProduct.images).where(
                    OzonProduct.offer_id.in_(all_offer_ids)
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

        # 转换为字典并添加图片
        order_dict = order.to_dict()
        if order_dict.get("items"):
            for item in order_dict["items"]:
                if item.get("offer_id") and item["offer_id"] in offer_id_images:
                    item["image"] = offer_id_images[item["offer_id"]]

        # 添加前端期望的字段（从第一个 posting 提取）
        if order.postings and len(order.postings) > 0:
            first_posting = order.postings[0]
            # 添加 status（前端期望的字段名）
            order_dict['status'] = first_posting.status
            # 添加 operation_status
            order_dict['operation_status'] = first_posting.operation_status
            # 添加 tracking_number（从 packages 或 raw_payload 提取）
            if first_posting.packages and len(first_posting.packages) > 0:
                order_dict['tracking_number'] = first_posting.packages[0].tracking_number
            elif first_posting.raw_payload and 'tracking_number' in first_posting.raw_payload:
                order_dict['tracking_number'] = first_posting.raw_payload['tracking_number']
            else:
                order_dict['tracking_number'] = None
            # 添加 delivery_method（配送方式）
            order_dict['delivery_method'] = first_posting.delivery_method_name or order.delivery_method

        # 返回与其他标签一致的数据结构
        return {
            "data": order_dict
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"查询追踪号码失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")


@router.post("/packing/postings/{posting_number}/mark-printed")
async def mark_posting_printed(
    posting_number: str,
    db: AsyncSession = Depends(get_async_session)
):
    """
    将货件标记为"已打印"状态

    条件检查：
    - posting 必须存在
    - ozon_status 必须是 'awaiting_deliver'
    """
    try:
        # 查询 posting
        result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            raise HTTPException(status_code=404, detail=f"货件不存在: {posting_number}")

        # 检查状态
        if posting.status != 'awaiting_deliver':
            raise HTTPException(
                status_code=422,
                detail=f"只能标记'等待发运'状态的订单为已打印，当前状态：{posting.status}"
            )

        # 检查互斥状态：已打印和单号确认互斥
        if posting.operation_status == 'tracking_confirmed':
            raise HTTPException(
                status_code=422,
                detail="该订单已完成单号确认，不能标记为已打印"
            )

        # 更新状态
        posting.operation_status = 'printed'
        posting.operation_time = utcnow()

        await db.commit()
        await db.refresh(posting)

        logger.info(f"货件 {posting_number} 已标记为已打印状态")

        return {
            "success": True,
            "message": "已标记为已打印",
            "data": {
                "posting_number": posting.posting_number,
                "operation_status": posting.operation_status,
                "operation_time": posting.operation_time.isoformat() if posting.operation_time else None
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"标记已打印失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"操作失败: {str(e)}")


@router.post("/postings/{posting_number}/sync-material-cost")
async def sync_material_cost(
    posting_number: str,
    db: AsyncSession = Depends(get_async_session)
):
    """
    从跨境巴士同步单个发货单的打包费用

    同步流程：
    1. 调用跨境巴士API获取订单信息
    2. 检查订单状态是否为"已打包"
    3. 更新 material_cost（打包费用）
    4. 更新 domestic_tracking_number（如果本地没有）
    5. 重新计算利润

    返回：
    - success: 同步是否成功
    - message: 提示信息
    - data: 更新后的字段值（material_cost、domestic_tracking_number、profit_amount_cny、profit_rate）
    """
    from ..services.posting_operations import PostingOperationsService

    try:
        service = PostingOperationsService(db)
        result = await service.sync_material_cost_single(posting_number)

        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["message"])

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"同步打包费用失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"同步失败: {str(e)}")


@router.post("/postings/{posting_number}/sync-finance")
async def sync_finance(
    posting_number: str,
    db: AsyncSession = Depends(get_async_session)
):
    """
    从 OZON 同步单个发货单的财务费用

    同步流程：
    1. 调用 OZON Finance API 获取财务交易记录
    2. 计算汇率（基于 RUB 到 CNY 的转换）
    3. 提取并转换费用到 CNY
    4. 更新 ozon_commission_cny（OZON佣金）
    5. 更新 last_mile_delivery_fee_cny（末端配送费）
    6. 更新 international_logistics_fee_cny（国际物流费）
    7. 重新计算利润

    返回：
    - success: 同步是否成功
    - message: 提示信息
    - data: 更新后的字段值（ozon_commission_cny、last_mile_delivery_fee_cny、
            international_logistics_fee_cny、exchange_rate、profit_amount_cny、profit_rate）
    """
    from ..services.posting_operations import PostingOperationsService

    try:
        service = PostingOperationsService(db)
        result = await service.sync_finance_single(posting_number)

        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["message"])

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"同步财务费用失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"同步失败: {str(e)}")
