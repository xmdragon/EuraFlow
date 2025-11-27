"""
商品上架操作 API 路由
"""

import logging
from decimal import Decimal
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.middleware.auth import require_role
from ef_core.models.users import User

from ...api.client import OzonAPIClient
from ...models import OzonShop
from ...services.product_listing_service import ProductListingService

router = APIRouter(tags=["ozon-listing-product"])
logger = logging.getLogger(__name__)


async def get_ozon_client(shop_id: int, db: AsyncSession) -> OzonAPIClient:
    """获取OZON API客户端"""
    shop = await db.scalar(select(OzonShop).where(OzonShop.id == shop_id))
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return OzonAPIClient(client_id=shop.client_id, api_key=shop.api_key_enc)


@router.post("/listings/products/import")
async def import_product(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    导入商品到OZON（完整上架流程）（需要操作员权限）

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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    更新商品价格（需要操作员权限）

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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    更新商品库存（需要操作员权限）

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


@router.post("/listings/products/unarchive")
async def unarchive_product(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    重新上架商品（从归档中还原）（需要操作员权限）

    将已下架/归档的商品重新激活
    """
    try:
        shop_id = request.get("shop_id")
        product_id = request.get("product_id")

        if not shop_id or not product_id:
            raise HTTPException(status_code=400, detail="shop_id and product_id are required")

        client = await get_ozon_client(shop_id, db)

        # 调用OZON API取消归档
        result = await client.unarchive_products([product_id])

        if result.get("result"):
            # 更新数据库中的商品状态
            from ...models.products import OzonProduct
            stmt = select(OzonProduct).where(
                OzonProduct.shop_id == shop_id,
                OzonProduct.ozon_product_id == product_id
            )
            product = await db.scalar(stmt)

            if product:
                product.ozon_archived = False
                product.status = "on_sale"  # 重新设置为在售状态
                await db.commit()

            return {
                "success": True,
                "message": "商品已重新上架"
            }
        else:
            error_msg = result.get("error", {}).get("message", "Unknown error")
            return {
                "success": False,
                "error": error_msg
            }

    except Exception as e:
        logger.error(f"Unarchive product failed: {e}", exc_info=True)
        await db.rollback()
        return {
            "success": False,
            "error": str(e)
        }
