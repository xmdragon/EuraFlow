"""
发货 API 路由
"""
from fastapi import APIRouter, Depends, Request

from ef_core.services import ShipmentsService  
from ef_core.utils.logger import get_logger
from .models import ApiResponse, CreateShipmentRequest, ShipmentResponse

router = APIRouter()
logger = get_logger(__name__)


async def get_shipments_service() -> ShipmentsService:
    """依赖注入：获取发货服务"""
    return ShipmentsService()


@router.post("", response_model=ApiResponse[dict])
async def create_shipment(
    request: Request,
    shipment_data: CreateShipmentRequest,
    shipments_service: ShipmentsService = Depends(get_shipments_service)
):
    """创建发货记录"""
    # TODO: 实现发货创建逻辑
    return ApiResponse.success({"message": "Shipment API not implemented yet"})


@router.get("/pending", response_model=ApiResponse[list])
async def get_pending_shipments(
    request: Request,
    shipments_service: ShipmentsService = Depends(get_shipments_service)
):
    """获取待推送的发货记录"""
    # TODO: 实现待推送发货查询逻辑
    return ApiResponse.success([])