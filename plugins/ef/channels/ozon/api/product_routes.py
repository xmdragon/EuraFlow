"""
商品管理 API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, Field, field_validator
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.middleware.auth import require_role
from ef_core.api.auth import get_current_user_flexible
from ..models import OzonProduct, OzonShop
from .permissions import filter_by_shop_permission, build_shop_filter_condition

router = APIRouter(tags=["ozon-products"])
logger = logging.getLogger(__name__)


# ========== Pydantic Schemas ==========

class ImportBySkuItem(BaseModel):
    """通过SKU导入商品的单个商品数据"""
    sku: int = Field(..., description="OZON SKU（必需，正整数）", gt=0)
    offer_id: str = Field(..., description="商家SKU（必需）", max_length=100)
    price: str = Field(..., description="售价（必需，字符串格式）")
    name: Optional[str] = Field(None, description="商品名称（可选）", max_length=500)
    old_price: Optional[str] = Field(None, description="原价（可选）")
    vat: Optional[str] = Field(None, description="增值税率（可选，0-1范围）")
    currency_code: Optional[str] = Field("CNY", description="货币代码（默认CNY）")

    @field_validator('price', 'old_price')
    @classmethod
    def validate_price_format(cls, v):
        """验证价格格式"""
        if v is not None:
            try:
                price_decimal = Decimal(v)
                if price_decimal < 0:
                    raise ValueError('价格不能为负数')
            except Exception:
                raise ValueError('价格格式错误，必须是有效的数字字符串')
        return v

    @field_validator('vat')
    @classmethod
    def validate_vat(cls, v):
        """验证增值税率范围"""
        if v is not None:
            try:
                vat_decimal = Decimal(v)
                if not (0 <= vat_decimal <= 1):
                    raise ValueError('增值税率必须在0-1范围内')
            except ValueError as e:
                raise e
            except Exception:
                raise ValueError('增值税率格式错误')
        return v


class ImportBySkuRequest(BaseModel):
    """通过SKU导入商品的请求"""
    shop_id: int = Field(..., description="店铺ID", gt=0)
    items: List[ImportBySkuItem] = Field(..., description="商品列表（最多1000个）", min_length=1, max_length=1000)


@router.get("/products")
async def get_products(
    page: int = Query(1, description="页码"),
    page_size: int = Query(20, le=100, description="每页数量"),
    # 保留offset/limit以兼容
    offset: Optional[int] = None,
    limit: Optional[int] = None,
    shop_id: Optional[int] = None,
    search: Optional[str] = Query(None, description="通用搜索（SKU、标题、offer_id、条码）"),
    sku: Optional[str] = None,
    title: Optional[str] = None,
    status: Optional[str] = None,
    price_min: Optional[float] = Query(None, description="最低价格"),
    price_max: Optional[float] = Query(None, description="最高价格"),
    stock_min: Optional[int] = Query(None, description="最低库存"),
    stock_max: Optional[int] = Query(None, description="最高库存"),
    has_stock: Optional[bool] = Query(None, description="是否有库存"),
    visibility: Optional[bool] = Query(None, description="是否可见"),
    archived: Optional[bool] = Query(None, description="是否归档"),
    category_id: Optional[int] = Query(None, description="类目ID"),
    brand: Optional[str] = Query(None, description="品牌"),
    created_from: Optional[str] = Query(None, description="创建日期起始（YYYY-MM-DD）"),
    created_to: Optional[str] = Query(None, description="创建日期结束（YYYY-MM-DD）"),
    sort_by: Optional[str] = Query("updated_at", description="排序字段：price,stock,created_at,updated_at,title"),
    sort_order: Optional[str] = Query("desc", description="排序方向：asc,desc"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取 Ozon 商品列表

    支持多种搜索和筛选方式：
    - 通用搜索：在SKU、标题、offer_id、条码中搜索
    - 精确筛选：按状态、价格范围、库存范围等
    - 灵活排序：支持多字段排序

    权限控制：
    - admin: 可以访问所有店铺的商品
    - operator/viewer: 只能访问已授权店铺的商品
    """
    from sqlalchemy import cast, Numeric

    # 权限过滤：根据用户角色过滤店铺
    try:
        allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    # 处理分页参数
    if offset is None and limit is None:
        # 使用page和page_size
        offset = (page - 1) * page_size
        limit = page_size
    elif limit is None:
        limit = 50  # 默认limit

    # 构建查询
    query = select(OzonProduct)

    # 应用权限过滤条件
    shop_filter = build_shop_filter_condition(OzonProduct, allowed_shop_ids)
    if shop_filter is not True:
        query = query.where(shop_filter)

    # 通用搜索 - 在多个字段中搜索
    if search:
        logger.info(f"[PRODUCT SEARCH] search={search}, shop_id={shop_id}")
        search_term = f"%{search}%"
        # 对于纯数字搜索，也搜索ozon_sku字段
        search_conditions = [
            OzonProduct.title.ilike(search_term),
            OzonProduct.offer_id.ilike(search_term),
            OzonProduct.barcode.ilike(search_term)
        ]

        # 如果搜索词是纯数字，也在ozon_sku字段中搜索
        if search.strip().isdigit():
            from sqlalchemy import Text
            search_conditions.append(cast(OzonProduct.ozon_sku, Text).ilike(search_term))
            logger.info("[PRODUCT SEARCH] Numeric search, also searching ozon_sku")

        query = query.where(or_(*search_conditions))

    # 特定字段搜索（优先级高于通用搜索）
    if sku:
        logger.info(f"[PRODUCT SEARCH] sku={sku}, shop_id={shop_id}")
        sku_term = f"%{sku}%"

        # 如果是纯数字，优先搜索 ozon_sku
        if sku.strip().isdigit():
            from sqlalchemy import Text
            query = query.where(cast(OzonProduct.ozon_sku, Text).ilike(sku_term))
            logger.info("[PRODUCT SEARCH] Numeric SKU, searching ozon_sku")
        else:
            # 非纯数字，搜索 offer_id
            query = query.where(OzonProduct.offer_id.ilike(sku_term))
            logger.info("[PRODUCT SEARCH] Non-numeric SKU, searching offer_id")
    if title:
        query = query.where(OzonProduct.title.ilike(f"%{title}%"))
    if status:
        query = query.where(OzonProduct.status == status)

    # 价格范围筛选
    if price_min is not None:
        query = query.where(OzonProduct.price >= cast(price_min, Numeric))
    if price_max is not None:
        query = query.where(OzonProduct.price <= cast(price_max, Numeric))

    # 库存范围筛选
    if stock_min is not None:
        query = query.where(OzonProduct.stock >= stock_min)
    if stock_max is not None:
        query = query.where(OzonProduct.stock <= stock_max)

    # 库存状态筛选
    if has_stock is not None:
        if has_stock:
            query = query.where(OzonProduct.stock > 0)
        else:
            query = query.where(OzonProduct.stock == 0)

    # 可见性筛选
    if visibility is not None:
        query = query.where(OzonProduct.visibility == visibility)

    # 归档状态筛选
    if archived is not None:
        if archived:
            query = query.where(or_(OzonProduct.is_archived.is_(True), OzonProduct.ozon_archived.is_(True)))
        else:
            query = query.where(and_(OzonProduct.is_archived.is_(False), OzonProduct.ozon_archived.is_(False)))

    # 类目筛选
    if category_id:
        query = query.where(OzonProduct.category_id == category_id)

    # 品牌筛选
    if brand:
        query = query.where(OzonProduct.brand.ilike(f"%{brand}%"))

    # 创建日期范围筛选（使用 Ozon 平台创建时间）
    if created_from:
        try:
            created_from_dt = datetime.fromisoformat(created_from + "T00:00:00")
            query = query.where(OzonProduct.ozon_created_at >= created_from_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid created_from format, expected YYYY-MM-DD")

    if created_to:
        try:
            created_to_dt = datetime.fromisoformat(created_to + "T23:59:59")
            query = query.where(OzonProduct.ozon_created_at <= created_to_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid created_to format, expected YYYY-MM-DD")

    # 执行查询获取总数
    total_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = total_result.scalar()

    # 添加排序
    sort_order_desc = sort_order.lower() == "desc"

    # 根据排序字段选择排序列
    if sort_by == "price":
        order_column = OzonProduct.price.desc() if sort_order_desc else OzonProduct.price.asc()
    elif sort_by == "stock":
        order_column = OzonProduct.stock.desc() if sort_order_desc else OzonProduct.stock.asc()
    elif sort_by == "created_at":
        # 使用 Ozon 平台创建时间排序
        order_column = OzonProduct.ozon_created_at.desc() if sort_order_desc else OzonProduct.ozon_created_at.asc()
    elif sort_by == "title":
        order_column = OzonProduct.title.desc() if sort_order_desc else OzonProduct.title.asc()
    else:  # 默认按updated_at
        order_column = OzonProduct.updated_at.desc() if sort_order_desc else OzonProduct.updated_at.asc()

    # 添加分页和排序
    query = query.offset(offset).limit(limit).order_by(order_column)

    # 执行查询
    result = await db.execute(query)
    products = result.scalars().all()

    # 调试日志：打印查询结果
    logger.info(f"[PRODUCT SEARCH RESULT] Found {len(products)} products, total={total}, search={search}, sku={sku}, shop_id={shop_id}")

    # 计算统计信息 - 支持5种状态
    stats_query = select(
        func.count().filter(OzonProduct.status == 'on_sale').label('on_sale'),
        func.count().filter(OzonProduct.status == 'ready_to_sell').label('ready_to_sell'),
        func.count().filter(OzonProduct.status == 'error').label('error'),
        func.count().filter(OzonProduct.status == 'pending_modification').label('pending_modification'),
        func.count().filter(OzonProduct.status == 'inactive').label('inactive'),
        func.count().filter(OzonProduct.status == 'archived').label('archived'),
        # 保留旧字段以便前端过渡
        func.count().filter(OzonProduct.status == 'on_sale').label('active'),
        func.count().filter(OzonProduct.stock == 0).label('out_of_stock'),
        func.count().filter(OzonProduct.sync_status == 'failed').label('sync_failed')
    ).select_from(OzonProduct)

    # 应用与主查询相同的权限过滤
    if shop_filter is not True:
        stats_query = stats_query.where(shop_filter)

    stats_result = await db.execute(stats_query)
    stats = stats_result.first()

    # 构建响应，包含搜索信息
    response = {
        "data": [product.to_dict() for product in products],
        "total": total,
        "page": page if page else (offset // limit + 1) if limit else 1,
        "page_size": limit,
        "stats": {
            "on_sale": stats.on_sale if stats else 0,
            "ready_to_sell": stats.ready_to_sell if stats else 0,
            "error": stats.error if stats else 0,
            "pending_modification": stats.pending_modification if stats else 0,
            "inactive": stats.inactive if stats else 0,
            "archived": stats.archived if stats else 0,
            # 保留旧字段以便前端过渡
            "active": stats.active if stats else 0,
            "out_of_stock": stats.out_of_stock if stats else 0,
            "sync_failed": stats.sync_failed if stats else 0
        }
    }

    # 如果有搜索，添加搜索信息
    if search or sku or title or brand or any([
        price_min, price_max, stock_min, stock_max, has_stock is not None,
        visibility is not None, archived is not None, category_id
    ]):
        response["search_info"] = {
            "query": search or sku or title or brand,
            "filters_applied": {
                "status": status,
                "price_range": [price_min, price_max] if price_min or price_max else None,
                "stock_range": [stock_min, stock_max] if stock_min is not None or stock_max is not None else None,
                "has_stock": has_stock,
                "visibility": visibility,
                "archived": archived,
                "category_id": category_id,
                "brand": brand
            },
            "results_count": len(products),
            "sort": {"by": sort_by, "order": sort_order}
        }

    return response


@router.post("/products/sync")
async def sync_products(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """同步商品数据（需要操作员权限）"""
    full_sync = request.get("full_sync", False)
    shop_id = request.get("shop_id")  # 必须明确指定店铺ID
    if not shop_id:
        raise HTTPException(status_code=400, detail="shop_id is required")

    # 从数据库获取店铺信息
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()

    if not shop:
        return {
            "success": False,
            "message": "店铺不存在",
            "error": "Shop not found"
        }

    # 使用 Ozon API 客户端获取商品
    from ..api.client import OzonAPIClient

    try:
        # 创建 API 客户端
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc  # 注意：实际生产环境应该解密
        )

        # 调用真实的 Ozon API (限制数量以减少API调用)
        try:
            products_data = await client.get_products(limit=10)  # 先测试少量商品
        except Exception as e:
            return {
                "success": False,
                "message": "获取商品数据失败",
                "error": f"Ozon API调用失败: {str(e)}"
            }

        if not products_data.get("result"):
            return {
                "success": False,
                "message": "获取商品数据失败",
                "error": "No products data returned from Ozon API",
                "api_response": products_data
            }

        items = products_data["result"].get("items", [])

        # 同步商品到数据库
        synced_count = 0
        for item in items:
            # 获取商品详情（包含图片和完整信息）
            detailed_info = None
            images_from_api = None

            try:
                # 使用product_id获取详细信息
                logger.info(f"Getting details for product: {item.get('product_id', item.get('offer_id'))}")
                if item.get("product_id"):
                    detailed_info = await client.get_product_info(product_id=item["product_id"])
                elif item.get("offer_id"):
                    detailed_info = await client.get_product_info(offer_id=item["offer_id"])

                # 打印完整的API响应结构来调试
                import json
                if detailed_info:
                    logger.info(f"Product detail API complete response: {json.dumps(detailed_info, indent=2, ensure_ascii=False)}")
                else:
                    logger.warning("No detailed_info received from API")

                if detailed_info and detailed_info.get("result"):
                    product_detail = detailed_info["result"]
                    logger.info(f"Product detail keys: {list(product_detail.keys())}")

                    # 提取图片信息 - 先查看所有可能的图片字段
                    images_fields = ["images", "image", "primary_image", "media", "photos", "pictures"]
                    for field in images_fields:
                        if product_detail.get(field):
                            logger.info(f"Found images in field '{field}': {product_detail[field]}")

                    # 提取图片信息
                    if product_detail.get("images"):
                        images = product_detail["images"]
                        logger.info(f"Images structure: {images}")
                        if images:
                            images_from_api = {
                                "primary": images[0].get("original_url") or images[0].get("url"),
                                "additional": [
                                    img.get("original_url") or img.get("url")
                                    for img in images[1:] if img.get("original_url") or img.get("url")
                                ],
                                "count": len(images)
                            }
                            logger.info(f"Extracted images_from_api: {images_from_api}")

                    # 更新商品信息为详细信息
                    if product_detail.get("name"):
                        item["name"] = product_detail["name"]
                    if product_detail.get("description"):
                        item["description"] = product_detail["description"]
                    if product_detail.get("category_id"):
                        item["category_id"] = product_detail["category_id"]
                    if product_detail.get("brand"):
                        item["brand"] = product_detail["brand"]
                    if product_detail.get("barcode"):
                        item["barcode"] = product_detail["barcode"]

            except Exception as e:
                logger.warning(f"Failed to get detailed info for product {item.get('product_id', item.get('offer_id'))}: {e}")
                # 继续使用基本信息

            # 添加延迟以避免API限流
            import asyncio
            await asyncio.sleep(0.2)  # 200ms延迟
            # 查找或创建商品
            existing = await db.execute(
                select(OzonProduct).where(
                    OzonProduct.shop_id == shop_id,
                    OzonProduct.offer_id == item.get("offer_id", "")
                )
            )
            product = existing.scalar_one_or_none()

            # 处理图片信息：优先使用API获取的真实图片
            images_data = images_from_api  # 使用从API获取的图片数据

            if not product:
                product = OzonProduct(
                    shop_id=shop_id,
                    sku=item.get("offer_id", ""),
                    offer_id=item.get("offer_id", ""),
                    ozon_product_id=item.get("product_id"),
                    ozon_sku=item.get("sku"),
                    title=item.get("name", "未知商品"),
                    description=item.get("description"),
                    barcode=item.get("barcode"),
                    category_id=item.get("category_id"),
                    brand=item.get("brand"),
                    status="active" if item.get("is_visible") else "inactive",
                    visibility=item.get("is_visible", False),
                    is_archived=item.get("is_archived", False),
                    price=Decimal(str(item.get("price", "0"))) if item.get("price") else None,
                    old_price=Decimal(str(item.get("old_price", "0"))) if item.get("old_price") else None,
                    stock=item.get("stocks", {}).get("present", 0),
                    available=item.get("stocks", {}).get("available", 0),
                    reserved=item.get("stocks", {}).get("reserved", 0),
                    images=images_data,
                    sync_status="success",
                    last_sync_at=datetime.now()
                )
                db.add(product)
            else:
                # 更新现有商品
                product.title = item.get("name", product.title)
                if item.get("description"):
                    product.description = item.get("description")
                if item.get("brand"):
                    product.brand = item.get("brand")
                if item.get("barcode"):
                    product.barcode = item.get("barcode")
                if item.get("category_id"):
                    product.category_id = item.get("category_id")
                product.ozon_product_id = item.get("product_id")
                product.ozon_sku = item.get("sku")
                product.status = "active" if item.get("is_visible") else "inactive"
                product.visibility = item.get("is_visible", False)
                product.is_archived = item.get("is_archived", False)
                if item.get("price"):
                    product.price = Decimal(str(item.get("price")))
                if item.get("old_price"):
                    product.old_price = Decimal(str(item.get("old_price")))
                product.stock = item.get("stocks", {}).get("present", 0)
                product.available = item.get("stocks", {}).get("available", 0)
                product.reserved = item.get("stocks", {}).get("reserved", 0)
                if images_data:
                    product.images = images_data
                product.sync_status = "success"
                product.last_sync_at = datetime.now()

            synced_count += 1

        await db.commit()

        return {
            "success": True,
            "message": f"成功同步 {synced_count} 个商品",
            "synced_count": synced_count,
            "sync_type": "full" if full_sync else "incremental"
        }

    except Exception as e:
        return {
            "success": False,
            "message": "同步失败",
            "error": str(e)
        }


@router.post("/products/prices")
async def update_prices(
    request: Dict[str, Any],
    current_user: User = Depends(require_role("operator"))
):
    """批量更新商品价格（异步任务）"""
    from ..tasks.batch_price_update_task import batch_update_prices_task

    updates = request.get("updates", [])
    shop_id = request.get("shop_id")

    if not shop_id:
        raise HTTPException(status_code=400, detail="shop_id is required")

    if not updates:
        raise HTTPException(status_code=400, detail="未提供价格更新数据")

    # 提交异步任务
    task = batch_update_prices_task.delay(shop_id, updates)

    return {
        "success": True,
        "message": "批量价格更新任务已提交",
        "task_id": task.id
    }


@router.get("/products/prices/task/{task_id}")
async def get_batch_price_update_task_status(
    task_id: str,
    current_user: User = Depends(require_role("operator"))
):
    """
    查询批量价格更新任务状态

    Args:
        task_id: 任务ID

    Returns:
        任务状态信息（包含进度）
    """
    try:
        from celery.result import AsyncResult
        import redis
        import json

        task = AsyncResult(task_id)

        # 从 Redis 获取进度信息
        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        progress_key = f"celery-task-progress:{task_id}"
        progress_data = redis_client.get(progress_key)

        response = {
            "task_id": task_id,
            "state": task.state,
        }

        # 如果有进度数据，使用进度数据
        if progress_data:
            progress_info = json.loads(progress_data)
            response["info"] = progress_info
            response["progress"] = progress_info.get('percent', 0)

        if task.state == 'PENDING':
            response["status"] = "等待执行"
            if "progress" not in response:
                response["progress"] = 0
        elif task.state == 'PROGRESS':
            response["status"] = "执行中"
            if "progress" not in response:
                response["progress"] = 50
        elif task.state == 'SUCCESS':
            response["status"] = "已完成"
            response["result"] = task.result
            if "progress" not in response:
                response["progress"] = 100
        elif task.state == 'FAILURE':
            response["status"] = "失败"
            response["error"] = str(task.info)
            if "progress" not in response:
                response["progress"] = 0
        else:
            response["status"] = task.state
            response["info"] = str(task.info) if task.info else None
            response["progress"] = 0

        return response

    except Exception as e:
        logger.error(f"查询任务状态失败: {e}", exc_info=True)
        return {
            "task_id": task_id,
            "state": "UNKNOWN",
            "status": "查询失败",
            "error": str(e)
        }


@router.post("/products/stocks")
async def update_stocks(
    request: Dict[str, Any],
    current_user: User = Depends(require_role("operator"))
):
    """批量更新商品库存（异步任务）"""
    from ..tasks.batch_stock_update_task import batch_update_stocks_task

    updates = request.get("updates", [])
    shop_id = request.get("shop_id")  # 必须明确指定店铺ID
    if not shop_id:
        raise HTTPException(status_code=400, detail="shop_id is required")

    if not updates:
        raise HTTPException(status_code=400, detail="未提供库存更新数据")

    # 提交异步任务
    task = batch_update_stocks_task.delay(shop_id, updates)

    return {
        "success": True,
        "message": "批量库存更新任务已提交",
        "task_id": task.id
    }


# 旧的同步实现已移除，改为异步任务

@router.get("/products/stocks/task/{task_id}")
async def get_batch_stock_update_task_status(
    task_id: str,
    current_user: User = Depends(require_role("operator"))
):
    """
    查询批量库存更新任务状态

    Args:
        task_id: 任务ID

    Returns:
        任务状态信息（包含进度）
    """
    try:
        from celery.result import AsyncResult
        import redis
        import json

        task = AsyncResult(task_id)

        # 从 Redis 获取进度信息
        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        progress_key = f"celery-task-progress:{task_id}"
        progress_data = redis_client.get(progress_key)

        response = {
            "task_id": task_id,
            "state": task.state,
        }

        # 如果有进度数据，使用进度数据
        if progress_data:
            progress_info = json.loads(progress_data)
            response["info"] = progress_info
            response["progress"] = progress_info.get('percent', 0)

        if task.state == 'PENDING':
            response["status"] = "等待执行"
            if "progress" not in response:
                response["progress"] = 0
        elif task.state == 'PROGRESS':
            response["status"] = "执行中"
            if "progress" not in response:
                response["progress"] = 50
        elif task.state == 'SUCCESS':
            response["status"] = "已完成"
            response["result"] = task.result
            if "progress" not in response:
                response["progress"] = 100
        elif task.state == 'FAILURE':
            response["status"] = "失败"
            response["error"] = str(task.info)
            if "progress" not in response:
                response["progress"] = 0
        else:
            response["status"] = task.state
            response["info"] = str(task.info) if task.info else None
            response["progress"] = 0

        return response

    except Exception as e:
        logger.error(f"查询任务状态失败: {e}", exc_info=True)
        return {
            "task_id": task_id,
            "state": "UNKNOWN",
            "status": "查询失败",
            "error": str(e)
        }


# 旧的同步实现已移除，改为异步任务

@router.post("/products/{product_id}/sync")
async def sync_single_product(
    product_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """同步单个商品（需要操作员权限）"""
    # 获取商品信息
    result = await db.execute(
        select(OzonProduct).where(OzonProduct.id == product_id)
    )
    product = result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    try:
        # 获取店铺信息
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == product.shop_id)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            raise HTTPException(status_code=404, detail="Shop not found")

        # 创建API客户端
        from ..api.client import OzonAPIClient
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc
        )

        # 获取商品详情（使用offer_id）
        product_info = await client.get_product_info(product.offer_id)

        # OZON API 新版格式：数据直接在顶层，而不是包装在 result 中
        # 兼容新旧格式
        item = product_info.get("result") or product_info

        if item and item.get("id"):  # 检查是否获取到有效数据
            # 更新商品信息
            product.title = item.get("name", product.title)
            product.ozon_product_id = item.get("id") or item.get("product_id")
            product.ozon_sku = item.get("sku")
            product.status = "active" if item.get("visible") or item.get("is_visible") else "inactive"
            product.visibility = item.get("visible") or item.get("is_visible", False)
            product.is_archived = item.get("archived") or item.get("is_archived", False)
            if item.get("price"):
                product.price = Decimal(str(item.get("price")))
            if item.get("old_price"):
                product.old_price = Decimal(str(item.get("old_price")))
            product.sync_status = "success"
            product.last_sync_at = datetime.now()

            await db.commit()

            return {
                "success": True,
                "message": f"商品 {product.title} 同步成功"
            }
        else:
            product.sync_status = "failed"
            product.sync_error = "Failed to fetch product info from Ozon"
            await db.commit()

            return {
                "success": False,
                "message": "从Ozon获取商品信息失败"
            }

    except Exception as e:
        product.sync_status = "failed"
        product.sync_error = str(e)
        await db.commit()

        return {
            "success": False,
            "message": f"同步失败: {str(e)}"
        }


@router.put("/products/{product_id}")
async def update_product(
    product_id: int,
    product_data: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """更新商品信息（需要操作员权限）"""
    # 获取商品
    result = await db.execute(
        select(OzonProduct).where(OzonProduct.id == product_id)
    )
    product = result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    try:
        # 更新可编辑字段
        if "title" in product_data:
            product.title = product_data["title"]
        if "price" in product_data and product_data["price"] is not None:
            product.price = Decimal(str(product_data["price"]))
        if "old_price" in product_data and product_data["old_price"] is not None:
            product.old_price = Decimal(str(product_data["old_price"]))
        if "stock" in product_data and product_data["stock"] is not None:
            product.stock = int(product_data["stock"])
        if "available" in product_data and product_data["available"] is not None:
            product.available = int(product_data["available"])
        if "description" in product_data:
            if not product.attributes:
                product.attributes = {}
            product.attributes["description"] = product_data["description"]
        if "category_id" in product_data and product_data["category_id"] is not None:
            product.category_id = int(product_data["category_id"])
        if "barcode" in product_data:
            product.barcode = product_data["barcode"]
        if "visibility" in product_data:
            product.visibility = bool(product_data["visibility"])
            product.status = "active" if product.visibility else "inactive"
        if "purchase_url" in product_data:
            product.purchase_url = product_data["purchase_url"]
        if "suggested_purchase_price" in product_data and product_data["suggested_purchase_price"] is not None:
            product.suggested_purchase_price = Decimal(str(product_data["suggested_purchase_price"]))
        if "purchase_note" in product_data:
            product.purchase_note = product_data["purchase_note"]

        product.updated_at = datetime.now()
        await db.commit()

        return {
            "success": True,
            "message": "商品信息更新成功",
            "data": product.to_dict()
        }

    except Exception as e:
        return {
            "success": False,
            "message": f"更新失败: {str(e)}"
        }


@router.post("/products/{product_id}/archive")
async def archive_product(
    product_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """归档商品（需要操作员权限）"""
    # 获取商品
    result = await db.execute(
        select(OzonProduct).where(OzonProduct.id == product_id)
    )
    product = result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    try:
        product.is_archived = True
        product.status = "archived"
        product.visibility = False
        product.updated_at = datetime.now()

        await db.commit()

        return {
            "success": True,
            "message": f"商品 {product.title} 已归档"
        }

    except Exception as e:
        return {
            "success": False,
            "message": f"归档失败: {str(e)}"
        }


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """删除商品（需要操作员权限）"""
    # 获取商品
    result = await db.execute(
        select(OzonProduct).where(OzonProduct.id == product_id)
    )
    product = result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    try:
        title = product.title
        await db.delete(product)
        await db.commit()

        return {
            "success": True,
            "message": f"商品 {title} 已删除"
        }

    except Exception as e:
        return {
            "success": False,
            "message": f"删除失败: {str(e)}"
        }


@router.post("/products/export")
async def export_products(
    request: Dict[str, Any] = {},
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """导出商品数据为CSV（需要操作员权限）"""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    shop_id = request.get("shop_id")  # 必须明确指定店铺ID
    if not shop_id:
        raise HTTPException(status_code=400, detail="shop_id is required")

    # 获取商品数据
    query = select(OzonProduct).where(OzonProduct.shop_id == shop_id)
    result = await db.execute(query)
    products = result.scalars().all()

    # 创建CSV内容
    output = io.StringIO()
    writer = csv.writer(output)

    # CSV标题行
    writer.writerow([
        'SKU', '商品名称', '价格', '原价', '库存', '可用库存',
        '分类ID', '条码', '状态', '可见性', '归档状态', '最后同步时间'
    ])

    # 写入数据行
    for product in products:
        writer.writerow([
            product.offer_id or '',
            product.title or '',
            str(product.price) if product.price else '',
            str(product.old_price) if product.old_price else '',
            product.stock or 0,
            product.available or 0,
            product.category_id or '',
            product.barcode or '',
            product.status or '',
            '是' if product.visibility else '否',
            '是' if product.is_archived else '否',
            product.last_sync_at.strftime('%Y-%m-%d %H:%M:%S') if product.last_sync_at else ''
        ])

    output.seek(0)

    # 返回CSV文件
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8-sig')),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=products_export.csv"}
    )


@router.post("/products/import")
async def import_products(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """导入商品数据（需要操作员权限）"""
    import csv
    import io
    import base64

    try:
        # 获取上传的文件内容
        file_content = request.get("file_content", "")
        shop_id = request.get("shop_id")  # 必须明确指定店铺ID

        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        if not file_content:
            return {
                "success": False,
                "message": "未提供文件内容"
            }

        # 解码base64文件内容
        try:
            decoded_content = base64.b64decode(file_content).decode('utf-8-sig')
        except Exception:
            return {
                "success": False,
                "message": "文件内容格式错误"
            }

        # 解析CSV
        csv_reader = csv.DictReader(io.StringIO(decoded_content))

        imported_count = 0
        errors = []

        for row_num, row in enumerate(csv_reader, start=2):
            try:
                sku = row.get('SKU', '').strip()
                if not sku:
                    errors.append(f"第{row_num}行：SKU不能为空")
                    continue

                # 查找现有商品
                existing = await db.execute(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.sku == sku
                    )
                )
                product = existing.scalar_one_or_none()

                if not product:
                    # 创建新商品
                    product = OzonProduct(
                        shop_id=shop_id,
                        sku=sku,
                        offer_id=sku,
                        title=row.get('商品名称', '').strip(),
                        price=Decimal(str(row.get('价格', 0))) if row.get('价格') else None,
                        old_price=Decimal(str(row.get('原价', 0))) if row.get('原价') else None,
                        stock=int(row.get('库存', 0)) if row.get('库存') else 0,
                        available=int(row.get('可用库存', 0)) if row.get('可用库存') else 0,
                        category_id=int(row.get('分类ID')) if row.get('分类ID') else None,
                        barcode=row.get('条码', '').strip() or None,
                        status=row.get('状态', 'active').strip(),
                        visibility=row.get('可见性', '').strip() in ['是', 'true', '1', 'yes'],
                        is_archived=row.get('归档状态', '').strip() in ['是', 'true', '1', 'yes'],
                        sync_status="imported",
                        last_sync_at=datetime.now()
                    )
                    db.add(product)
                else:
                    # 更新现有商品
                    if row.get('商品名称'):
                        product.title = row.get('商品名称').strip()
                    if row.get('价格'):
                        product.price = Decimal(str(row.get('价格')))
                    if row.get('原价'):
                        product.old_price = Decimal(str(row.get('原价')))
                    if row.get('库存'):
                        product.stock = int(row.get('库存'))
                    if row.get('可用库存'):
                        product.available = int(row.get('可用库存'))
                    if row.get('分类ID'):
                        product.category_id = int(row.get('分类ID'))
                    if row.get('条码'):
                        product.barcode = row.get('条码').strip()
                    if row.get('状态'):
                        product.status = row.get('状态').strip()
                    if row.get('可见性'):
                        product.visibility = row.get('可见性').strip() in ['是', 'true', '1', 'yes']
                    if row.get('归档状态'):
                        product.is_archived = row.get('归档状态').strip() in ['是', 'true', '1', 'yes']
                    product.sync_status = "imported"
                    product.last_sync_at = datetime.now()

                imported_count += 1

            except Exception as e:
                errors.append(f"第{row_num}行：{str(e)}")

        await db.commit()

        result = {
            "success": True,
            "message": f"成功导入 {imported_count} 个商品",
            "imported_count": imported_count
        }

        if errors:
            result["warnings"] = errors[:10]  # 最多显示10个错误
            if len(errors) > 10:
                result["warnings"].append(f"还有 {len(errors) - 10} 个错误未显示...")

        return result

    except Exception as e:
        logger.error(f"Import failed: {e}")
        return {
            "success": False,
            "message": f"导入失败: {str(e)}"
        }


@router.get("/products/{product_id}/sync-errors")
async def get_product_sync_errors(
    product_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取商品的错误信息（OZON平台返回的商品审核错误详情）
    """
    from ..models.products import OzonProductSyncError

    # 先查询商品，确保商品存在并且用户有权限访问
    product_query = select(OzonProduct).where(OzonProduct.id == product_id)
    product_result = await db.execute(product_query)
    product = product_result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")

    # 权限检查：确保用户有权限访问该店铺的商品
    try:
        allowed_shop_ids = await filter_by_shop_permission(current_user, db, product.shop_id)
        if product.shop_id not in allowed_shop_ids:
            raise HTTPException(status_code=403, detail="无权访问此商品")
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    # 查询最新的同步错误记录
    error_query = (
        select(OzonProductSyncError)
        .where(OzonProductSyncError.product_id == product_id)
        .order_by(OzonProductSyncError.created_at.desc())
        .limit(1)
    )
    error_result = await db.execute(error_query)
    sync_error = error_result.scalar_one_or_none()

    if not sync_error:
        return {
            "has_errors": False,
            "message": "该商品没有错误记录"
        }

    return {
        "has_errors": True,
        "sync_error": {
            "id": sync_error.id,
            "offer_id": sync_error.offer_id,
            "task_id": sync_error.task_id,
            "status": sync_error.status,
            "errors": sync_error.errors or [],
            "created_at": sync_error.created_at.isoformat() if sync_error.created_at else None,
            "updated_at": sync_error.updated_at.isoformat() if sync_error.updated_at else None
        }
    }


@router.post("/products/import-by-sku")
async def import_products_by_sku(
    request: ImportBySkuRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    通过SKU批量创建商品

    使用OZON API的 /v1/product/import-by-sku 接口，通过指定现有商品的SKU快速创建商品卡片副本。

    **功能说明**：
    - 复制现有商品的卡片结构（类目、属性等）
    - 只需提供SKU和基础价格信息
    - 适用于快速复制竞品或已有商品

    **限制条件**：
    - 单次最多1000个商品
    - 如果原商品禁止复制，将无法创建
    - 无法用于更新已有商品（仅用于创建）

    **权限控制**：
    - admin: 可以为所有店铺导入
    - shop_manager/operator: 只能为自己管理的店铺导入

    Args:
        request: 导入请求，包含 shop_id 和 items 列表

    Returns:
        包含 task_id 和 unmatched_sku_list 的响应
    """
    # 查询店铺信息
    shop_query = select(OzonShop).where(OzonShop.id == request.shop_id)
    shop_result = await db.execute(shop_query)
    shop = shop_result.scalar_one_or_none()

    if not shop:
        raise HTTPException(
            status_code=404,
            detail={
                "type": "about:blank",
                "title": "Shop not found",
                "status": 404,
                "detail": f"店铺 ID {request.shop_id} 不存在",
                "code": "SHOP_NOT_FOUND"
            }
        )

    # 权限检查（admin可以访问所有店铺，其他角色只能访问自己的店铺）
    if current_user.role not in ['admin'] and shop.user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail={
                "type": "about:blank",
                "title": "Forbidden",
                "status": 403,
                "detail": "无权访问此店铺",
                "code": "FORBIDDEN"
            }
        )

    # 导入OZON API客户端
    from ..api.client import OzonAPIClient

    # 创建API客户端
    async with OzonAPIClient(
        client_id=shop.client_id,
        api_key=shop.api_key_enc,
        shop_id=shop.id
    ) as client:
        try:
            # 转换请求数据为API格式
            items_data = [item.model_dump() for item in request.items]

            # 调用OZON API
            result = await client.import_products_by_sku(items_data)

            # 提取结果
            task_id = result.get("result", {}).get("task_id")
            unmatched_sku_list = result.get("result", {}).get("unmatched_sku_list", [])

            # 记录日志
            logger.info(
                f"[Import by SKU] User {current_user.id} imported {len(request.items)} products for shop {request.shop_id}. "
                f"Task ID: {task_id}, Unmatched SKUs: {len(unmatched_sku_list)}"
            )

            return {
                "success": True,
                "task_id": task_id,
                "unmatched_sku_list": unmatched_sku_list,
                "message": f"已提交 {len(request.items)} 个商品的导入任务"
            }

        except ValueError as e:
            # 客户端验证错误（如商品数量超限）
            raise HTTPException(
                status_code=400,
                detail={
                    "type": "about:blank",
                    "title": "Bad Request",
                    "status": 400,
                    "detail": str(e),
                    "code": "VALIDATION_ERROR"
                }
            )
        except Exception as e:
            # OZON API错误或其他异常
            logger.error(f"[Import by SKU] Error importing products: {str(e)}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail={
                    "type": "about:blank",
                    "title": "Internal Server Error",
                    "status": 500,
                    "detail": f"导入失败: {str(e)}",
                    "code": "IMPORT_FAILED"
                }
            )


@router.put("/products/{sku}/purchase-info")
async def update_product_purchase_info(
    sku: str,
    request_data: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """更新商品采购信息（采购地址、建议采购价、采购备注）"""
    from decimal import Decimal

    # 查询商品
    result = await db.execute(
        select(OzonProduct).where(OzonProduct.ozon_sku == int(sku))
    )
    product = result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    try:
        # 更新采购信息
        if "purchase_url" in request_data:
            product.purchase_url = request_data["purchase_url"]
        if "suggested_purchase_price" in request_data:
            product.suggested_purchase_price = Decimal(str(request_data["suggested_purchase_price"])) if request_data["suggested_purchase_price"] else None
        if "purchase_note" in request_data:
            product.purchase_note = request_data["purchase_note"]

        product.updated_at = datetime.now()
        await db.commit()

        return {
            "success": True,
            "message": "采购信息更新成功",
            "data": {
                "sku": sku,
                "purchase_url": product.purchase_url,
                "suggested_purchase_price": str(product.suggested_purchase_price) if product.suggested_purchase_price else None,
                "purchase_note": product.purchase_note
            }
        }

    except Exception as e:
        await db.rollback()
        return {
            "success": False,
            "message": f"更新失败: {str(e)}"
        }
