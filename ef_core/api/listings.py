"""
价格 API 路由
"""
from fastapi import APIRouter, Depends, Request

from ef_core.services import ListingsService
from ef_core.utils.logging import get_logger
from .models import ApiResponse, UpdatePricesRequest

router = APIRouter()
logger = get_logger(__name__)


async def get_listings_service() -> ListingsService:
    """依赖注入：获取价格服务"""
    return ListingsService()


@router.post("", response_model=ApiResponse[dict])
async def update_prices(
    request: Request,
    price_data: UpdatePricesRequest,
    listings_service: ListingsService = Depends(get_listings_service)
):
    """更新价格"""
    # TODO: 实现价格更新逻辑
    return ApiResponse.success({"message": "Listings API not implemented yet"})