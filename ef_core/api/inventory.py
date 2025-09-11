"""
库存 API 路由
"""
from fastapi import APIRouter, Depends, Request

from ef_core.services import InventoryService
from ef_core.utils.logging import get_logger
from .models import ApiResponse, UpdateInventoryRequest

router = APIRouter()
logger = get_logger(__name__)


async def get_inventory_service() -> InventoryService:
    """依赖注入：获取库存服务"""
    return InventoryService()


@router.post("", response_model=ApiResponse[dict])
async def update_inventory(
    request: Request,
    inventory_data: UpdateInventoryRequest,
    inventory_service: InventoryService = Depends(get_inventory_service)
):
    """更新库存"""
    # TODO: 实现库存更新逻辑
    return ApiResponse.success({"message": "Inventory API not implemented yet"})