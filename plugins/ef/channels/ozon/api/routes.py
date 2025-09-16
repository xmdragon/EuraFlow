"""
Ozon 平台 API 端点
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from typing import Optional, Dict, Any
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from ef_core.database import get_async_session

# 使用 get_async_session 作为 get_session 的别名
get_session = get_async_session
from ..models import OzonShop, OzonProduct, OzonOrder
from sqlalchemy import select, func
# from .auth import get_current_user  # Временно отключено для разработки

router = APIRouter(prefix="/ozon", tags=["Ozon"])
logger = logging.getLogger(__name__)


# DTO 模型
class ShopCreateDTO(BaseModel):
    shop_name: str
    platform: str = "ozon"
    api_credentials: Dict[str, str]
    config: Dict[str, Any] = Field(default_factory=dict)

class ShopUpdateDTO(BaseModel):
    shop_name: Optional[str] = None
    status: Optional[str] = None
    api_credentials: Optional[Dict[str, str]] = None
    config: Optional[Dict[str, Any]] = None

class ShopResponseDTO(BaseModel):
    id: int
    shop_name: str
    platform: str
    status: str
    api_credentials: Optional[Dict[str, str]]
    config: Dict[str, Any]
    stats: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime

# 店铺管理端点
@router.get("/shops")
async def get_shops(
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """获取 Ozon 店铺列表"""
    # 从数据库获取店铺列表
    result = await db.execute(
        select(OzonShop).where(OzonShop.owner_user_id == 1)  # 临时硬编码用户ID
    )
    shops = result.scalars().all()
    
    # 计算真实的统计数据
    shops_data = []
    for shop in shops:
        shop_dict = shop.to_dict(include_credentials=True)
        
        # 获取真实的商品和订单数量
        products_count = await db.execute(
            select(func.count()).select_from(OzonProduct).where(OzonProduct.shop_id == shop.id)
        )
        orders_count = await db.execute(
            select(func.count()).select_from(OzonOrder).where(OzonOrder.shop_id == shop.id)
        )
        
        # 更新统计数据为真实值
        shop_dict["stats"] = {
            "total_products": products_count.scalar() or 0,
            "total_orders": orders_count.scalar() or 0,
            "last_sync_at": shop.last_sync_at.isoformat() if shop.last_sync_at else None,
            "sync_status": "success" if shop.last_sync_at else "pending"
        }
        
        shops_data.append(shop_dict)
    
    return {"data": shops_data}

@router.post("/shops")
async def create_shop(
    shop_data: ShopCreateDTO,
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """创建新的 Ozon 店铺"""
    new_shop = OzonShop(
        shop_name=shop_data.shop_name,
        platform=shop_data.platform,
        status="active",
        owner_user_id=1,  # 临时硬编码
        client_id=shop_data.api_credentials.get("client_id", ""),
        api_key_enc=shop_data.api_credentials.get("api_key", ""),  # 实际应该加密
        config=shop_data.config or {}
    )
    
    db.add(new_shop)
    await db.commit()
    await db.refresh(new_shop)
    
    return new_shop.to_dict(include_credentials=True)

@router.put("/shops/{shop_id}")
async def update_shop(
    shop_id: int,
    shop_data: ShopUpdateDTO,
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """更新 Ozon 店铺配置"""
    # 查找店铺
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()
    
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    
    # 更新店铺信息
    if shop_data.shop_name is not None:
        shop.shop_name = shop_data.shop_name
    if shop_data.status is not None:
        shop.status = shop_data.status
    if shop_data.api_credentials is not None:
        shop.client_id = shop_data.api_credentials.get("client_id", shop.client_id)
        if shop_data.api_credentials.get("api_key") and shop_data.api_credentials["api_key"] != "******":
            shop.api_key_enc = shop_data.api_credentials["api_key"]  # 实际应该加密
    if shop_data.config is not None:
        # 合并配置
        current_config = shop.config or {}
        current_config.update(shop_data.config)
        shop.config = current_config
    
    shop.updated_at = datetime.now()
    
    await db.commit()
    await db.refresh(shop)
    
    return shop.to_dict(include_credentials=True)

@router.delete("/shops/{shop_id}")
async def delete_shop(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """删除 Ozon 店铺"""
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()
    
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    
    await db.delete(shop)
    await db.commit()
    
    return {"message": "Shop deleted successfully"}

@router.post("/shops/{shop_id}/test-connection")
async def test_connection(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """测试店铺 API 连接"""
    # 获取店铺信息
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()
    
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    
    # 验证API凭证是否存在
    if not shop.client_id or not shop.api_key_enc:
        return {
            "success": False,
            "message": "API credentials not configured",
            "details": {
                "error": "Missing client_id or api_key"
            }
        }
    
    # 使用真实的Ozon API客户端测试连接
    from ..api.client import OzonAPIClient
    
    try:
        # 创建Ozon API客户端
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc  # 注意：实际应该解密
        )
        
        # 执行测试连接
        result = await client.test_connection()
        
        # 如果连接成功，更新店铺状态
        if result["success"]:
            shop.last_sync_at = datetime.now()
            if shop.stats is None:
                shop.stats = {}
            shop.stats["last_connection_test"] = datetime.now().isoformat()
            shop.stats["connection_status"] = "success"
            await db.commit()
        
        return result
        
    except Exception as e:
        return {
            "success": False,
            "message": "Test connection failed",
            "details": {
                "error": str(e)
            }
        }

@router.post("/shops/{shop_id}/sync")
async def trigger_sync(
    shop_id: int,
    sync_type: str = Query("all", description="Sync type: all, products, orders"),
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """触发店铺同步"""
    import uuid
    import asyncio
    from ..services import OzonSyncService
    
    # 生成真实的任务ID
    task_id = f"task_{uuid.uuid4().hex[:12]}"
    
    # 根据同步类型执行不同的同步任务
    async def run_sync():
        # 创建新的数据库会话用于异步任务
        async with get_async_session() as task_db:
            try:
                if sync_type in ["all", "products"]:
                    await OzonSyncService.sync_products(shop_id, task_db, task_id)
                
                if sync_type in ["all", "orders"]:
                    # 如果是全部同步，为订单生成新的任务ID
                    order_task_id = task_id if sync_type == "orders" else f"task_{uuid.uuid4().hex[:12]}"
                    await OzonSyncService.sync_orders(shop_id, task_db, order_task_id)
            except Exception as e:
                logger.error(f"Sync failed: {e}")
                import traceback
                logger.error(traceback.format_exc())
    
    # 在后台启动同步任务（不等待完成）
    asyncio.create_task(run_sync())
    
    return {
        "task_id": task_id,
        "status": "started",
        "sync_type": sync_type,
        "message": f"Sync {sync_type} started for shop {shop_id}"
    }

@router.get("/sync/status/{task_id}")
async def get_sync_status(
    task_id: str
):
    """获取同步任务状态"""
    from ..services import OzonSyncService
    
    status = OzonSyncService.get_task_status(task_id)
    
    if not status:
        raise HTTPException(
            status_code=404,
            detail="Task not found"
        )
    
    return status

# 商品管理端点
@router.get("/products")
async def get_products(
    offset: int = 0,
    limit: int = Query(50, le=100),
    shop_id: Optional[int] = None,
    sku: Optional[str] = None,
    title: Optional[str] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """获取 Ozon 商品列表"""
    # 构建查询
    query = select(OzonProduct)
    
    # 应用过滤条件
    if shop_id:
        query = query.where(OzonProduct.shop_id == shop_id)
    else:
        # 默认获取第一个店铺的商品
        query = query.where(OzonProduct.shop_id == 1)
    
    if sku:
        query = query.where(OzonProduct.sku.contains(sku))
    if title:
        query = query.where(OzonProduct.title.contains(title))
    if status:
        query = query.where(OzonProduct.status == status)
    
    # 执行查询获取总数
    total_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = total_result.scalar()
    
    # 添加分页
    query = query.offset(offset).limit(limit).order_by(OzonProduct.updated_at.desc())
    
    # 执行查询
    result = await db.execute(query)
    products = result.scalars().all()
    
    # 计算统计信息
    stats_query = select(
        func.count().filter(OzonProduct.status == 'active').label('active'),
        func.count().filter(OzonProduct.available == 0).label('out_of_stock'),
        func.count().filter(OzonProduct.sync_status == 'failed').label('sync_failed')
    ).select_from(OzonProduct)
    
    if shop_id:
        stats_query = stats_query.where(OzonProduct.shop_id == shop_id)
    else:
        stats_query = stats_query.where(OzonProduct.shop_id == 1)
    
    stats_result = await db.execute(stats_query)
    stats = stats_result.first()
    
    return {
        "data": [product.to_dict() for product in products],
        "total": total,
        "offset": offset,
        "limit": limit,
        "stats": {
            "active": stats.active if stats else 0,
            "out_of_stock": stats.out_of_stock if stats else 0,
            "sync_failed": stats.sync_failed if stats else 0
        }
    }

@router.post("/products/sync")
async def sync_products(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """同步商品数据"""
    full_sync = request.get("full_sync", False)
    shop_id = request.get("shop_id", 1)  # 默认使用第一个店铺
    
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
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """批量更新商品价格"""
    updates = request.get("updates", [])
    shop_id = request.get("shop_id", 1)

    if not updates:
        return {
            "success": False,
            "message": "未提供价格更新数据"
        }

    try:
        # 获取店铺信息
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            return {
                "success": False,
                "message": "店铺不存在"
            }

        updated_count = 0
        errors = []

        # 创建Ozon API客户端
        from ..api.client import OzonAPIClient
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc
        )

        for update in updates:
            sku = update.get("sku")
            new_price = update.get("price")
            old_price = update.get("old_price")

            if not sku or new_price is None:
                errors.append(f"SKU {sku}: 缺少必要字段")
                continue

            try:
                # 查找本地商品
                product_result = await db.execute(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.sku == sku
                    )
                )
                product = product_result.scalar_one_or_none()

                if not product:
                    errors.append(f"SKU {sku}: 商品不存在")
                    continue

                # 调用Ozon API更新价格
                price_data = {
                    "prices": [{
                        "offer_id": product.offer_id,
                        "price": str(new_price),
                        "old_price": str(old_price) if old_price else "",
                        "product_id": product.ozon_product_id
                    }]
                }

                api_result = await client.update_prices(price_data)

                if api_result.get("result"):
                    # 更新本地数据库
                    product.price = Decimal(str(new_price))
                    if old_price:
                        product.old_price = Decimal(str(old_price))
                    product.updated_at = datetime.now()

                    updated_count += 1
                else:
                    errors.append(f"SKU {sku}: Ozon API更新失败")

            except Exception as e:
                errors.append(f"SKU {sku}: {str(e)}")

        await db.commit()

        result = {
            "success": True,
            "message": f"成功更新 {updated_count} 个商品价格",
            "updated_count": updated_count
        }

        if errors:
            result["errors"] = errors[:10]  # 最多显示10个错误
            if len(errors) > 10:
                result["errors"].append(f"还有 {len(errors) - 10} 个错误未显示...")

        return result

    except Exception as e:
        logger.error(f"Price update failed: {e}")
        return {
            "success": False,
            "message": f"价格更新失败: {str(e)}"
        }

@router.post("/products/stocks")
async def update_stocks(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """批量更新商品库存"""
    updates = request.get("updates", [])
    shop_id = request.get("shop_id", 1)

    if not updates:
        return {
            "success": False,
            "message": "未提供库存更新数据"
        }

    try:
        # 获取店铺信息
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            return {
                "success": False,
                "message": "店铺不存在"
            }

        updated_count = 0
        errors = []

        # 创建Ozon API客户端
        from ..api.client import OzonAPIClient
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc
        )

        for update in updates:
            sku = update.get("sku")
            stock = update.get("stock")
            warehouse_id = update.get("warehouse_id", 1)

            if not sku or stock is None:
                errors.append(f"SKU {sku}: 缺少必要字段")
                continue

            try:
                # 查找本地商品
                product_result = await db.execute(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.sku == sku
                    )
                )
                product = product_result.scalar_one_or_none()

                if not product:
                    errors.append(f"SKU {sku}: 商品不存在")
                    continue

                # 调用Ozon API更新库存
                stock_data = {
                    "stocks": [{
                        "offer_id": product.offer_id,
                        "product_id": product.ozon_product_id,
                        "stock": int(stock),
                        "warehouse_id": warehouse_id
                    }]
                }

                api_result = await client.update_stocks(stock_data)

                if api_result.get("result"):
                    # 更新本地数据库
                    product.stock = int(stock)
                    product.available = int(stock)  # 简化：认为所有库存都可用
                    product.updated_at = datetime.now()

                    updated_count += 1
                else:
                    errors.append(f"SKU {sku}: Ozon API更新失败")

            except Exception as e:
                errors.append(f"SKU {sku}: {str(e)}")

        await db.commit()

        result = {
            "success": True,
            "message": f"成功更新 {updated_count} 个商品库存",
            "updated_count": updated_count
        }

        if errors:
            result["errors"] = errors[:10]  # 最多显示10个错误
            if len(errors) > 10:
                result["errors"].append(f"还有 {len(errors) - 10} 个错误未显示...")

        return result

    except Exception as e:
        logger.error(f"Stock update failed: {e}")
        return {
            "success": False,
            "message": f"库存更新失败: {str(e)}"
        }

# 单个商品操作端点
@router.post("/products/{product_id}/sync")
async def sync_single_product(
    product_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """同步单个商品"""
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
        
        if product_info.get("result"):
            item = product_info["result"]
            # 更新商品信息
            product.title = item.get("name", product.title)
            product.ozon_product_id = item.get("product_id")
            product.ozon_sku = item.get("sku")
            product.status = "active" if item.get("is_visible") else "inactive"
            product.visibility = item.get("is_visible", False)
            product.is_archived = item.get("is_archived", False)
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
    db: AsyncSession = Depends(get_async_session)
):
    """更新商品信息"""
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
        if "sku" in product_data:
            product.sku = product_data["sku"]
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
    db: AsyncSession = Depends(get_async_session)
):
    """归档商品"""
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
    db: AsyncSession = Depends(get_async_session)
):
    """删除商品"""
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
    db: AsyncSession = Depends(get_async_session)
):
    """导出商品数据为CSV"""
    import csv
    import io
    from fastapi.responses import StreamingResponse
    
    shop_id = request.get("shop_id", 1)
    
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
            product.sku or '',
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
    db: AsyncSession = Depends(get_async_session)
):
    """导入商品数据"""
    import csv
    import io
    import base64
    
    try:
        # 获取上传的文件内容
        file_content = request.get("file_content", "")
        shop_id = request.get("shop_id", 1)
        
        if not file_content:
            return {
                "success": False,
                "message": "未提供文件内容"
            }
        
        # 解码base64文件内容
        try:
            decoded_content = base64.b64decode(file_content).decode('utf-8-sig')
        except:
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
        return {
            "success": False,
            "message": f"导入失败: {str(e)}"
        }

# 订单管理端点
@router.get("/orders")
async def get_orders(
    offset: int = 0,
    limit: int = Query(50, le=100),
    shop_id: Optional[int] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """获取 Ozon 订单列表"""
    # 构建查询
    query = select(OzonOrder)
    
    # 应用过滤条件
    if shop_id:
        query = query.where(OzonOrder.shop_id == shop_id)
    else:
        # 默认获取第一个店铺的订单
        query = query.where(OzonOrder.shop_id == 1)
    
    if status:
        query = query.where(OzonOrder.status == status)
    
    # 执行查询获取总数
    total_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = total_result.scalar()
    
    # 添加分页
    query = query.offset(offset).limit(limit).order_by(OzonOrder.created_at.desc())
    
    # 执行查询
    result = await db.execute(query)
    orders = result.scalars().all()
    
    return {
        "data": [order.to_dict() for order in orders],
        "total": total,
        "offset": offset,
        "limit": limit
    }

@router.post("/orders/sync")
async def sync_orders(
    request: Dict[str, Any] = {},
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """同步订单数据"""
    date_from = request.get("date_from", datetime.now().strftime("%Y-%m-%dT00:00:00Z"))
    date_to = request.get("date_to", datetime.now().strftime("%Y-%m-%dT23:59:59Z"))
    shop_id = request.get("shop_id", 1)
    
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
    
    # 使用 Ozon API 客户端获取订单
    from ..api.client import OzonAPIClient
    
    try:
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc
        )
        
        # 调用真实的 Ozon API
        orders_data = await client.get_orders(date_from=date_from, date_to=date_to)
        
        if not orders_data.get("result"):
            return {
                "success": False,
                "message": "获取订单数据失败",
                "error": "No orders data returned from Ozon API"
            }
        
        postings = orders_data["result"].get("postings", [])
        
        # 同步订单到数据库
        synced_count = 0
        for posting in postings:
            # 查找或创建订单
            existing = await db.execute(
                select(OzonOrder).where(
                    OzonOrder.shop_id == shop_id,
                    OzonOrder.posting_number == posting.get("posting_number", "")
                )
            )
            order = existing.scalar_one_or_none()
            
            # 计算总价
            total_price = Decimal("0")
            items_data = []
            for product in posting.get("products", []):
                price = Decimal(str(product.get("price", "0")))
                quantity = product.get("quantity", 0)
                total_price += price * quantity
                items_data.append({
                    "sku": product.get("sku"),
                    "name": product.get("name"),
                    "quantity": quantity,
                    "price": str(price)
                })
            
            if not order:
                order = OzonOrder(
                    shop_id=shop_id,
                    order_id=posting.get("order_id", ""),
                    order_number=posting.get("order_number", ""),
                    posting_number=posting.get("posting_number", ""),
                    status=posting.get("status", "pending"),
                    substatus=posting.get("substatus"),
                    delivery_type=posting.get("delivery_method", {}).get("tpl_provider", "FBS"),
                    is_express=posting.get("is_express", False),
                    is_premium=posting.get("is_premium", False),
                    total_price=total_price,
                    delivery_method=posting.get("delivery_method", {}).get("name"),
                    tracking_number=posting.get("tracking_number"),
                    items=items_data,
                    in_process_at=datetime.fromisoformat(posting["in_process_at"].replace("Z", "+00:00")) if posting.get("in_process_at") else None,
                    shipment_date=datetime.fromisoformat(posting["shipment_date"].replace("Z", "+00:00")) if posting.get("shipment_date") else None,
                    analytics_data=posting.get("analytics_data"),
                    financial_data=posting.get("financial_data"),
                    sync_status="success",
                    last_sync_at=datetime.now()
                )
                db.add(order)
            else:
                # 更新现有订单
                order.status = posting.get("status", order.status)
                order.substatus = posting.get("substatus")
                order.tracking_number = posting.get("tracking_number")
                order.items = items_data
                order.sync_status = "success"
                order.last_sync_at = datetime.now()
            
            synced_count += 1
        
        await db.commit()
        
        return {
            "success": True,
            "message": f"成功同步 {synced_count} 个订单",
            "synced_count": synced_count,
            "date_range": {
                "from": date_from,
                "to": date_to
            }
        }
        
    except Exception as e:
        return {
            "success": False,
            "message": "同步失败",
            "error": str(e)
        }


@router.get("/sync-logs")
async def get_sync_logs(
    shop_id: Optional[int] = Query(None, description="店铺ID"),
    entity_type: Optional[str] = Query(None, description="实体类型"),
    status: Optional[str] = Query(None, description="状态"),
    limit: int = Query(20, ge=1, le=100, description="返回数量"),
    offset: int = Query(0, ge=0, description="偏移量"),
    session: AsyncSession = Depends(get_session)
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
    from datetime import datetime
    
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
            time_diff = datetime.utcnow() - log.started_at
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