"""
促销活动管理 API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from typing import List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from decimal import Decimal
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from ..services.promotion_service import PromotionService

router = APIRouter(tags=["ozon-promotions"])
logger = logging.getLogger(__name__)


# ========== Pydantic 模型 ==========

class ActivateProductRequest(BaseModel):
    """添加商品到促销的请求"""
    product_id: int = Field(..., description="商品ID")
    promotion_price: Decimal = Field(..., description="促销价格")
    promotion_stock: int = Field(..., description="促销库存")


class ActivateProductsRequest(BaseModel):
    """批量添加商品到促销的请求"""
    products: List[ActivateProductRequest] = Field(..., description="商品列表")


class DeactivateProductsRequest(BaseModel):
    """批量取消商品促销的请求"""
    product_ids: List[int] = Field(..., description="商品ID列表")


class AutoCancelRequest(BaseModel):
    """设置自动取消的请求"""
    enabled: bool = Field(..., description="是否启用自动取消")


class SetAddModeRequest(BaseModel):
    """设置add_mode的请求"""
    add_mode: str = Field(..., description="加入方式: manual或automatic")


# ========== API 端点 ==========

@router.post("/shops/{shop_id}/promotions/sync")
async def sync_promotions(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    同步店铺的促销活动和商品数据

    包括：
    1. 同步活动清单
    2. 同步每个活动的候选商品和参与商品
    """
    try:
        # 同步活动清单
        result1 = await PromotionService.sync_actions(shop_id, db)

        # 获取所有活动
        actions = await PromotionService.get_actions_with_stats(shop_id, db)

        # 同步每个活动的商品
        total_candidates = 0
        total_products = 0

        for action in actions:
            action_id = action["action_id"]

            # 同步候选商品
            result2 = await PromotionService.sync_action_candidates(shop_id, action_id, db)
            total_candidates += result2.get("synced_count", 0)

            # 同步参与商品
            result3 = await PromotionService.sync_action_products(shop_id, action_id, db)
            total_products += result3.get("synced_count", 0)

        return {
            "ok": True,
            "data": {
                "synced_actions": result1.get("synced_count", 0),
                "synced_candidates": total_candidates,
                "synced_products": total_products
            }
        }
    except Exception as e:
        logger.error(f"Failed to sync promotions for shop {shop_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/shops/{shop_id}/promotions/actions")
async def get_actions(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取店铺的促销活动列表（带统计）

    返回活动列表，包含：
    - 候选商品数量
    - 参与商品数量
    - 自动取消开关状态
    """
    try:
        actions = await PromotionService.get_actions_with_stats(shop_id, db)
        return {"ok": True, "data": actions}
    except Exception as e:
        logger.error(f"Failed to get actions for shop {shop_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/shops/{shop_id}/promotions/actions/{action_id}/candidates")
async def get_candidates(
    shop_id: int,
    action_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取活动的候选商品列表

    可参加但尚未参加促销的商品
    """
    try:
        products = await PromotionService.get_candidates(shop_id, action_id, db)
        return {"ok": True, "data": products}
    except Exception as e:
        logger.error(f"Failed to get candidates for action {action_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/shops/{shop_id}/promotions/actions/{action_id}/products")
async def get_active_products(
    shop_id: int,
    action_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取活动的参与商品列表

    已参加促销的商品，包含促销价格、库存、加入方式等信息
    """
    try:
        products = await PromotionService.get_active_products(shop_id, action_id, db)
        return {"ok": True, "data": products}
    except Exception as e:
        logger.error(f"Failed to get products for action {action_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/shops/{shop_id}/promotions/actions/{action_id}/activate")
async def activate_products(
    shop_id: int,
    action_id: int,
    request: ActivateProductsRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    添加商品到促销活动

    用户手动添加，商品会被标记为 add_mode=manual
    """
    try:
        products = [p.dict() for p in request.products]
        result = await PromotionService.activate_products(shop_id, action_id, products, db)
        return {"ok": True, "data": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to activate products for action {action_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/shops/{shop_id}/promotions/actions/{action_id}/deactivate")
async def deactivate_products(
    shop_id: int,
    action_id: int,
    request: DeactivateProductsRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    从促销活动中移除商品

    取消商品参与促销
    """
    try:
        result = await PromotionService.deactivate_products(
            shop_id, action_id, request.product_ids, db
        )
        return {"ok": True, "data": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to deactivate products from action {action_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/shops/{shop_id}/promotions/actions/{action_id}/auto-cancel")
async def set_auto_cancel(
    shop_id: int,
    action_id: int,
    request: AutoCancelRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    切换活动的自动取消开关

    开启后，定时任务会自动取消 add_mode=automatic 的商品
    """
    try:
        result = await PromotionService.set_auto_cancel(
            shop_id, action_id, request.enabled, db
        )
        return {"ok": True, "data": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to set auto_cancel for action {action_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/shops/{shop_id}/promotions/actions/{action_id}/products/{product_id}/add-mode")
async def set_add_mode(
    shop_id: int,
    action_id: int,
    product_id: int,
    request: SetAddModeRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    切换商品的 add_mode（手动/自动）

    - manual: 不会被自动取消
    - automatic: 可能被自动取消（如果活动开启了自动取消）
    """
    try:
        result = await PromotionService.set_add_mode(
            shop_id, action_id, product_id, request.add_mode, db
        )
        return {"ok": True, "data": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(
            f"Failed to set add_mode for product {product_id} in action {action_id}: {e}",
            exc_info=True
        )
        raise HTTPException(status_code=500, detail=str(e))
