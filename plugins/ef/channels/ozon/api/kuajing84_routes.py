"""跨境巴士同步 API 路由"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
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
    from ..services.kuajing84_sync import create_kuajing84_sync_service
    return create_kuajing84_sync_service(db)


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

    - **posting_number**: 货件编号（OZON posting number）
    - **logistics_order**: 国内物流单号
    """
    try:
        result = await service.sync_logistics_order(
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


@router.get("/sync-status/{sync_log_id}")
async def get_sync_status(
    sync_log_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """
    查询跨境巴士同步状态（用于前端轮询）

    返回示例：
    ```json
    {
      "sync_log_id": 123,
      "status": "in_progress",  // pending / in_progress / success / failed
      "sync_type": "submit_tracking",  // submit_tracking / discard_order
      "message": "同步中...",
      "attempts": 1,
      "created_at": "2025-10-21T12:00:00Z",
      "started_at": "2025-10-21T12:00:05Z",
      "synced_at": null,
      "error_message": null
    }
    ```

    Args:
        sync_log_id: 同步日志ID

    Returns:
        同步状态详情
    """
    from sqlalchemy import select
    from ..models.kuajing84 import Kuajing84SyncLog

    try:
        # 查询同步日志
        result = await db.execute(
            select(Kuajing84SyncLog).where(Kuajing84SyncLog.id == sync_log_id)
        )
        sync_log = result.scalar_one_or_none()

        if not sync_log:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"同步日志不存在: sync_log_id={sync_log_id}"
            )

        # 构造友好的状态消息
        status_messages = {
            "pending": "等待同步",
            "in_progress": "同步中...",
            "success": "同步成功",
            "failed": f"同步失败: {sync_log.error_message or '未知错误'}"
        }
        message = status_messages.get(sync_log.sync_status, "未知状态")

        return {
            "sync_log_id": sync_log.id,
            "status": sync_log.sync_status,
            "sync_type": sync_log.sync_type,
            "message": message,
            "attempts": sync_log.attempts,
            "created_at": sync_log.created_at.isoformat() if sync_log.created_at else None,
            "started_at": sync_log.started_at.isoformat() if sync_log.started_at else None,
            "synced_at": sync_log.synced_at.isoformat() if sync_log.synced_at else None,
            "error_message": sync_log.error_message,
            "order_number": sync_log.order_number,
            "logistics_order": sync_log.logistics_order if sync_log.sync_type == "submit_tracking" else None
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"查询同步状态失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"查询同步状态失败: {str(e)}"
        )
