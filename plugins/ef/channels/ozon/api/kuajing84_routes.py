"""跨境巴士同步 API 路由"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.config import get_settings
from ..services.kuajing84_sync import Kuajing84SyncService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/kuajing84", tags=["跨境巴士同步"])


# ============ Pydantic 模型 ============

class Kuajing84ConfigRequest(BaseModel):
    """跨境巴士全局配置请求"""
    username: str = Field(..., min_length=1, max_length=100, description="跨境巴士用户名")
    password: str = Field(..., min_length=1, max_length=100, description="跨境巴士密码")
    enabled: bool = Field(True, description="是否启用")


class Kuajing84ConfigResponse(BaseModel):
    """跨境巴士配置响应"""
    success: bool
    message: str
    data: Optional[dict] = None


class SyncLogisticsRequest(BaseModel):
    """同步物流单号请求"""
    ozon_order_id: int = Field(..., description="OZON订单ID")
    posting_number: str = Field(..., description="货件编号（OZON posting number）")
    logistics_order: str = Field(..., min_length=1, max_length=100, description="国内物流单号")


class SyncLogisticsResponse(BaseModel):
    """同步物流单号响应"""
    success: bool
    message: str
    log_id: Optional[int] = None


class SyncLogItem(BaseModel):
    """同步日志项"""
    id: int
    order_number: str
    logistics_order: str
    kuajing84_oid: Optional[str]
    sync_status: str
    error_message: Optional[str]
    attempts: int
    created_at: Optional[str]
    synced_at: Optional[str]


class SyncLogsResponse(BaseModel):
    """同步日志列表响应"""
    success: bool
    data: list[SyncLogItem]


# ============ 依赖注入 ============

async def get_kuajing84_service(db: AsyncSession = Depends(get_async_session)) -> Kuajing84SyncService:
    """获取跨境巴士同步服务实例"""
    settings = get_settings()

    # 从环境变量获取加密密钥
    encryption_key = getattr(settings, "encryption_key", None)

    if not encryption_key:
        # 如果没有配置加密密钥，使用 secret_key 派生一个
        import hashlib
        import base64
        secret_key = settings.secret_key  # 直接访问属性
        derived_key = hashlib.sha256(secret_key.encode()).digest()
        encryption_key = base64.urlsafe_b64encode(derived_key)

    return Kuajing84SyncService(db=db, encryption_key=encryption_key)


# ============ API 路由 ============

@router.post("/config", response_model=Kuajing84ConfigResponse)
async def save_config(
    request: Kuajing84ConfigRequest,
    service: Kuajing84SyncService = Depends(get_kuajing84_service)
):
    """
    保存跨境巴士全局配置（单例模式）

    - **username**: 跨境巴士用户名
    - **password**: 跨境巴士密码
    - **enabled**: 是否启用（默认true）
    """
    try:
        result = await service.save_kuajing84_config(
            username=request.username,
            password=request.password,
            enabled=request.enabled
        )

        return Kuajing84ConfigResponse(
            success=result["success"],
            message=result["message"]
        )

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        logger.error(f"保存跨境巴士配置失败: {e}\n{error_detail}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/config", response_model=Kuajing84ConfigResponse)
async def get_config(
    service: Kuajing84SyncService = Depends(get_kuajing84_service)
):
    """
    获取跨境巴士全局配置
    """
    try:
        config = await service.get_kuajing84_config()

        if config:
            return Kuajing84ConfigResponse(
                success=True,
                message="配置获取成功",
                data=config
            )
        else:
            return Kuajing84ConfigResponse(
                success=False,
                message="未配置跨境巴士",
                data=None
            )

    except Exception as e:
        logger.error(f"获取跨境巴士配置失败: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/test-connection", response_model=Kuajing84ConfigResponse)
async def test_connection(
    service: Kuajing84SyncService = Depends(get_kuajing84_service)
):
    """
    测试跨境巴士连接（使用已保存的配置进行登录测试）
    """
    try:
        result = await service.test_connection()

        return Kuajing84ConfigResponse(
            success=result["success"],
            message=result["message"],
            data=result.get("data")
        )

    except Exception as e:
        logger.error(f"测试连接失败: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/sync", response_model=SyncLogisticsResponse)
async def sync_logistics_order(
    request: SyncLogisticsRequest,
    service: Kuajing84SyncService = Depends(get_kuajing84_service)
):
    """
    同步物流单号到跨境巴士

    - **ozon_order_id**: OZON订单ID
    - **posting_number**: 货件编号
    - **logistics_order**: 国内物流单号
    """
    try:
        result = await service.sync_logistics_order(
            ozon_order_id=request.ozon_order_id,
            posting_number=request.posting_number,
            logistics_order=request.logistics_order
        )

        return SyncLogisticsResponse(
            success=result["success"],
            message=result["message"],
            log_id=result.get("log_id")
        )

    except Exception as e:
        logger.error(f"同步物流单号失败: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/logs/{shop_id}", response_model=SyncLogsResponse)
async def get_sync_logs(
    shop_id: int,
    status: Optional[str] = None,
    limit: int = 50,
    service: Kuajing84SyncService = Depends(get_kuajing84_service)
):
    """
    获取同步日志列表

    - **shop_id**: 店铺ID
    - **status**: 状态筛选（可选）：pending/success/failed
    - **limit**: 返回数量限制（默认50）
    """
    try:
        logs = await service.get_sync_logs(
            shop_id=shop_id,
            status=status,
            limit=limit
        )

        return SyncLogsResponse(
            success=True,
            data=logs
        )

    except Exception as e:
        logger.error(f"获取同步日志失败: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
