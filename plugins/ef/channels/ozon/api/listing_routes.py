"""
商品上架管理 API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from decimal import Decimal
import logging

from ef_core.database import get_async_session
from ..models import OzonShop
from ..api.client import OzonAPIClient
from ..services.catalog_service import CatalogService
from ..services.media_import_service import MediaImportService
from ..services.product_import_service import ProductImportService
from ..services.product_listing_service import ProductListingService

router = APIRouter(tags=["ozon-listing"])
logger = logging.getLogger(__name__)


async def get_ozon_client(shop_id: int, db: AsyncSession) -> OzonAPIClient:
    """获取OZON API客户端"""
    shop = await db.scalar(select(OzonShop).where(OzonShop.id == shop_id))
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return OzonAPIClient(client_id=shop.client_id, api_key=shop.api_key_enc)


# ============ 类目与属性查询接口 ============

@router.get("/listings/categories/search")
async def search_categories(
    query: str = Query(..., description="搜索关键词"),
    only_leaf: bool = Query(True, description="仅返回叶子类目"),
    limit: int = Query(20, le=100, description="返回数量限制"),
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    搜索类目

    只有叶子类目才能用于创建商品
    """
    try:
        client = await get_ozon_client(shop_id, db)
        catalog_service = CatalogService(client, db)

        categories = await catalog_service.search_categories(
            query=query,
            only_leaf=only_leaf,
            limit=limit
        )

        return {
            "success": True,
            "data": [
                {
                    "category_id": cat.category_id,
                    "name": cat.name,
                    "parent_id": cat.parent_id,
                    "is_leaf": cat.is_leaf,
                    "level": cat.level
                }
                for cat in categories
            ],
            "total": len(categories)
        }

    except Exception as e:
        logger.error(f"Category search failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/categories/{category_id}/attributes")
async def get_category_attributes(
    category_id: int,
    required_only: bool = Query(False, description="仅返回必填属性"),
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取类目属性列表

    返回指定类目的所有属性，包括必填和选填
    """
    try:
        client = await get_ozon_client(shop_id, db)
        catalog_service = CatalogService(client, db)

        attributes = await catalog_service.get_category_attributes(
            category_id=category_id,
            required_only=required_only
        )

        return {
            "success": True,
            "data": [
                {
                    "attribute_id": attr.attribute_id,
                    "name": attr.name,
                    "description": attr.description,
                    "attribute_type": attr.attribute_type,
                    "is_required": attr.is_required,
                    "is_collection": attr.is_collection,
                    "dictionary_id": attr.dictionary_id,
                    "min_value": float(attr.min_value) if attr.min_value else None,
                    "max_value": float(attr.max_value) if attr.max_value else None
                }
                for attr in attributes
            ],
            "total": len(attributes)
        }

    except Exception as e:
        logger.error(f"Get category attributes failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/attributes/{dictionary_id}/values")
async def search_dictionary_values(
    dictionary_id: int,
    query: Optional[str] = Query(None, description="搜索关键词"),
    limit: int = Query(100, le=500, description="返回数量限制"),
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    搜索字典值

    用于属性值选择，如颜色、尺码等
    """
    try:
        client = await get_ozon_client(shop_id, db)
        catalog_service = CatalogService(client, db)

        values = await catalog_service.search_dictionary_values(
            dictionary_id=dictionary_id,
            query=query,
            limit=limit
        )

        return {
            "success": True,
            "data": [
                {
                    "value_id": val.value_id,
                    "value": val.value,
                    "info": val.info,
                    "picture": val.picture
                }
                for val in values
            ],
            "total": len(values)
        }

    except Exception as e:
        logger.error(f"Search dictionary values failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/categories/sync")
async def sync_category_tree(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
):
    """
    同步类目树

    从OZON拉取类目数据到本地数据库
    """
    try:
        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        force_refresh = request.get("force_refresh", False)
        root_category_id = request.get("root_category_id")

        client = get_ozon_client(shop_id, db)
        catalog_service = CatalogService(client, db)

        result = await catalog_service.sync_category_tree(
            root_category_id=root_category_id,
            force_refresh=force_refresh
        )

        return result

    except Exception as e:
        logger.error(f"Sync category tree failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


# ============ 商品上架接口 ============

@router.post("/listings/products/import")
async def import_product(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
):
    """
    导入商品到OZON（完整上架流程）

    支持两种模式：
    - NEW_CARD: 创建新商品卡片
    - FOLLOW_PDP: 跟随已有商品（需要条码）
    """
    try:
        shop_id = request.get("shop_id")
        offer_id = request.get("offer_id")
        mode = request.get("mode", "NEW_CARD")
        auto_advance = request.get("auto_advance", True)

        if not shop_id or not offer_id:
            raise HTTPException(status_code=400, detail="shop_id and offer_id are required")

        client = await get_ozon_client(shop_id, db)
        listing_service = ProductListingService(client, db)

        result = await listing_service.list_product(
            shop_id=shop_id,
            offer_id=offer_id,
            mode=mode,
            auto_advance=auto_advance
        )

        return result

    except Exception as e:
        logger.error(f"Product import failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/products/{offer_id}/status")
async def get_listing_status(
    offer_id: str,
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取商品上架状态

    返回商品在上架流程中的当前状态和时间戳
    """
    try:
        client = await get_ozon_client(shop_id, db)
        listing_service = ProductListingService(client, db)

        result = await listing_service.get_listing_status(
            shop_id=shop_id,
            offer_id=offer_id
        )

        return result

    except Exception as e:
        logger.error(f"Get listing status failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/products/{offer_id}/price")
async def update_product_price(
    offer_id: str,
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
):
    """
    更新商品价格

    可以更新售价、原价、最低价等
    """
    try:
        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        price = request.get("price")
        old_price = request.get("old_price")
        min_price = request.get("min_price")
        currency_code = request.get("currency_code", "RUB")
        auto_action_enabled = request.get("auto_action_enabled", False)

        if price is None:
            raise HTTPException(status_code=400, detail="price is required")

        client = await get_ozon_client(shop_id, db)
        listing_service = ProductListingService(client, db)

        result = await listing_service.update_price(
            shop_id=shop_id,
            offer_id=offer_id,
            price=Decimal(str(price)),
            old_price=Decimal(str(old_price)) if old_price else None,
            min_price=Decimal(str(min_price)) if min_price else None,
            currency_code=currency_code,
            auto_action_enabled=auto_action_enabled
        )

        return result

    except Exception as e:
        logger.error(f"Update price failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/products/{offer_id}/stock")
async def update_product_stock(
    offer_id: str,
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
):
    """
    更新商品库存

    更新指定仓库的库存数量
    """
    try:
        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        stock = request.get("stock")
        warehouse_id = request.get("warehouse_id", 1)
        product_id = request.get("product_id")

        if stock is None:
            raise HTTPException(status_code=400, detail="stock is required")

        client = await get_ozon_client(shop_id, db)
        listing_service = ProductListingService(client, db)

        result = await listing_service.update_stock(
            shop_id=shop_id,
            offer_id=offer_id,
            stock=int(stock),
            warehouse_id=warehouse_id,
            product_id=product_id
        )

        return result

    except Exception as e:
        logger.error(f"Update stock failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


# ============ 图片导入接口 ============

@router.post("/listings/products/{offer_id}/images")
async def import_product_images(
    offer_id: str,
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
):
    """
    导入商品图片

    从Cloudinary URL导入图片到OZON
    """
    try:
        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        image_urls = request.get("image_urls", [])
        validate_properties = request.get("validate_properties", False)

        if not image_urls:
            raise HTTPException(status_code=400, detail="image_urls is required")

        client = await get_ozon_client(shop_id, db)
        media_service = MediaImportService(client, db)

        result = await media_service.import_images_for_product(
            shop_id=shop_id,
            offer_id=offer_id,
            image_urls=image_urls,
            validate_properties=validate_properties
        )

        return result

    except Exception as e:
        logger.error(f"Import images failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/products/{offer_id}/images/status")
async def get_images_status(
    offer_id: str,
    shop_id: int = Query(..., description="店铺ID"),
    state: Optional[str] = Query(None, description="状态过滤"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取商品图片导入状态
    """
    try:
        client = await get_ozon_client(shop_id, db)
        media_service = MediaImportService(client, db)

        logs = await media_service.get_import_logs(
            shop_id=shop_id,
            offer_id=offer_id,
            state=state
        )

        return {
            "success": True,
            "data": [
                {
                    "id": log.id,
                    "source_url": log.source_url,
                    "file_name": log.file_name,
                    "position": log.position,
                    "state": log.state,
                    "ozon_file_id": log.ozon_file_id,
                    "ozon_url": log.ozon_url,
                    "error_code": log.error_code,
                    "error_message": log.error_message,
                    "retry_count": log.retry_count,
                    "created_at": log.created_at.isoformat() if log.created_at else None
                }
                for log in logs
            ],
            "total": len(logs)
        }

    except Exception as e:
        logger.error(f"Get images status failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


# ============ 导入日志查询接口 ============

@router.get("/listings/logs/products")
async def get_product_import_logs(
    shop_id: int = Query(..., description="店铺ID"),
    offer_id: Optional[str] = Query(None, description="商品Offer ID"),
    state: Optional[str] = Query(None, description="状态过滤"),
    limit: int = Query(50, le=200, description="返回数量限制"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取商品导入日志
    """
    try:
        client = await get_ozon_client(shop_id, db)
        product_service = ProductImportService(client, db)

        logs = await product_service.get_import_logs(
            shop_id=shop_id,
            offer_id=offer_id,
            state=state,
            limit=limit
        )

        return {
            "success": True,
            "data": [
                {
                    "id": log.id,
                    "offer_id": log.offer_id,
                    "import_mode": log.import_mode,
                    "state": log.state,
                    "task_id": log.task_id,
                    "ozon_product_id": log.ozon_product_id,
                    "ozon_sku": log.ozon_sku,
                    "error_code": log.error_code,
                    "error_message": log.error_message,
                    "errors": log.errors,
                    "retry_count": log.retry_count,
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                    "updated_at": log.updated_at.isoformat() if log.updated_at else None
                }
                for log in logs
            ],
            "total": len(logs)
        }

    except Exception as e:
        logger.error(f"Get product import logs failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


logger.info("Listing routes initialized successfully")
