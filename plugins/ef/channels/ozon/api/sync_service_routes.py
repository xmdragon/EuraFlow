"""
同步服务管理API路由
"""
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.tasks.scheduler import get_scheduler
from ..models.sync_service import SyncService, SyncServiceLog

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sync-services", tags=["Sync Services"])


# ========== DTOs ==========

class SyncServiceCreate(BaseModel):
    """创建同步服务DTO"""
    service_key: str = Field(..., description="服务唯一标识")
    service_name: str = Field(..., description="服务显示名称")
    service_description: Optional[str] = Field(None, description="服务功能说明")
    service_type: str = Field(..., description="调度类型: cron | interval")
    schedule_config: str = Field(..., description="调度配置：cron表达式或间隔秒数")
    is_enabled: bool = Field(True, description="启用开关")
    config_json: Optional[dict] = Field(None, description="服务特定配置")


class SyncServiceUpdate(BaseModel):
    """更新同步服务DTO"""
    service_name: Optional[str] = Field(None, description="服务显示名称")
    service_description: Optional[str] = Field(None, description="服务功能说明")
    service_type: Optional[str] = Field(None, description="调度类型: cron | interval")
    schedule_config: Optional[str] = Field(None, description="调度配置")
    is_enabled: Optional[bool] = Field(None, description="启用开关")
    config_json: Optional[dict] = Field(None, description="服务特定配置")


class SyncServiceResponse(BaseModel):
    """同步服务响应DTO"""
    id: int
    service_key: str
    service_name: str
    service_description: Optional[str]
    service_type: str
    schedule_config: str
    is_enabled: bool
    last_run_at: Optional[str]
    last_run_status: Optional[str]
    last_run_message: Optional[str]
    run_count: int
    success_count: int
    error_count: int
    config_json: Optional[dict]
    created_at: str
    updated_at: str


class SyncServiceLogResponse(BaseModel):
    """同步服务日志响应DTO"""
    id: int
    service_key: str
    run_id: str
    started_at: str
    finished_at: Optional[str]
    status: str
    records_processed: int
    records_updated: int
    execution_time_ms: Optional[int]
    error_message: Optional[str]
    extra_data: Optional[dict]


class SyncServiceStatsResponse(BaseModel):
    """同步服务统计响应DTO"""
    total_runs: int
    success_rate: float
    avg_execution_time_ms: Optional[float]
    recent_errors: List[dict]


# ========== 路由处理函数 ==========

@router.get("", response_model=List[SyncServiceResponse])
async def list_sync_services(
    is_enabled: Optional[bool] = Query(None, description="筛选启用状态"),
    db: AsyncSession = Depends(get_async_session)
):
    """获取同步服务列表"""
    query = select(SyncService)

    if is_enabled is not None:
        query = query.where(SyncService.is_enabled == is_enabled)

    query = query.order_by(SyncService.created_at.desc())

    result = await db.execute(query)
    services = result.scalars().all()

    return [
        SyncServiceResponse(
            id=service.id,
            service_key=service.service_key,
            service_name=service.service_name,
            service_description=service.service_description,
            service_type=service.service_type,
            schedule_config=service.schedule_config,
            is_enabled=service.is_enabled,
            last_run_at=service.last_run_at.isoformat() if service.last_run_at else None,
            last_run_status=service.last_run_status,
            last_run_message=service.last_run_message,
            run_count=service.run_count,
            success_count=service.success_count,
            error_count=service.error_count,
            config_json=service.config_json,
            created_at=service.created_at.isoformat() if service.created_at else "",
            updated_at=service.updated_at.isoformat() if service.updated_at else ""
        )
        for service in services
    ]


@router.post("", response_model=SyncServiceResponse)
async def create_sync_service(
    data: SyncServiceCreate,
    db: AsyncSession = Depends(get_async_session)
):
    """创建同步服务"""
    # 检查service_key是否已存在
    existing = await db.execute(
        select(SyncService).where(SyncService.service_key == data.service_key)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Service key '{data.service_key}' already exists")

    # 创建服务
    service = SyncService(
        service_key=data.service_key,
        service_name=data.service_name,
        service_description=data.service_description,
        service_type=data.service_type,
        schedule_config=data.schedule_config,
        is_enabled=data.is_enabled,
        config_json=data.config_json
    )

    db.add(service)
    await db.commit()
    await db.refresh(service)

    # 如果启用，添加到调度器
    if service.is_enabled:
        scheduler = get_scheduler()
        try:
            await scheduler.add_service(
                service_key=service.service_key,
                service_type=service.service_type,
                schedule_config=service.schedule_config,
                config_json=service.config_json or {}
            )
            logger.info(f"Service added to scheduler: {service.service_key}")
        except Exception as e:
            logger.error(f"Failed to add service to scheduler: {e}")
            # 不阻止创建，只记录错误

    return SyncServiceResponse(
        id=service.id,
        service_key=service.service_key,
        service_name=service.service_name,
        service_description=service.service_description,
        service_type=service.service_type,
        schedule_config=service.schedule_config,
        is_enabled=service.is_enabled,
        last_run_at=None,
        last_run_status=None,
        last_run_message=None,
        run_count=0,
        success_count=0,
        error_count=0,
        config_json=service.config_json,
        created_at=service.created_at.isoformat(),
        updated_at=service.updated_at.isoformat()
    )


@router.put("/{service_id}", response_model=SyncServiceResponse)
async def update_sync_service(
    service_id: int,
    data: SyncServiceUpdate,
    db: AsyncSession = Depends(get_async_session)
):
    """更新同步服务配置"""
    # 查找服务
    result = await db.execute(
        select(SyncService).where(SyncService.id == service_id)
    )
    service = result.scalar_one_or_none()

    if not service:
        raise HTTPException(status_code=404, detail=f"Service {service_id} not found")

    # 更新字段
    if data.service_name is not None:
        service.service_name = data.service_name
    if data.service_description is not None:
        service.service_description = data.service_description
    if data.service_type is not None:
        service.service_type = data.service_type
    if data.schedule_config is not None:
        service.schedule_config = data.schedule_config
    if data.is_enabled is not None:
        service.is_enabled = data.is_enabled
    if data.config_json is not None:
        service.config_json = data.config_json

    await db.commit()
    await db.refresh(service)

    # 更新调度器
    scheduler = get_scheduler()
    try:
        # 移除旧任务
        await scheduler.remove_service(service.service_key)

        # 如果启用，添加新任务
        if service.is_enabled:
            await scheduler.add_service(
                service_key=service.service_key,
                service_type=service.service_type,
                schedule_config=service.schedule_config,
                config_json=service.config_json or {}
            )
            logger.info(f"Service updated in scheduler: {service.service_key}")
    except Exception as e:
        logger.error(f"Failed to update service in scheduler: {e}")

    return SyncServiceResponse(
        id=service.id,
        service_key=service.service_key,
        service_name=service.service_name,
        service_description=service.service_description,
        service_type=service.service_type,
        schedule_config=service.schedule_config,
        is_enabled=service.is_enabled,
        last_run_at=service.last_run_at.isoformat() if service.last_run_at else None,
        last_run_status=service.last_run_status,
        last_run_message=service.last_run_message,
        run_count=service.run_count,
        success_count=service.success_count,
        error_count=service.error_count,
        config_json=service.config_json,
        created_at=service.created_at.isoformat(),
        updated_at=service.updated_at.isoformat()
    )


@router.delete("/{service_id}")
async def delete_sync_service(
    service_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """删除同步服务"""
    # 查找服务
    result = await db.execute(
        select(SyncService).where(SyncService.id == service_id)
    )
    service = result.scalar_one_or_none()

    if not service:
        raise HTTPException(status_code=404, detail=f"Service {service_id} not found")

    # 从调度器移除
    scheduler = get_scheduler()
    try:
        await scheduler.remove_service(service.service_key)
        logger.info(f"Service removed from scheduler: {service.service_key}")
    except Exception as e:
        logger.warning(f"Failed to remove service from scheduler: {e}")

    # 删除服务
    await db.delete(service)
    await db.commit()

    return {"ok": True, "message": f"Service {service_id} deleted successfully"}


@router.post("/{service_id}/trigger")
async def trigger_sync_service(
    service_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """手动触发同步服务"""
    # 查找服务
    result = await db.execute(
        select(SyncService).where(SyncService.id == service_id)
    )
    service = result.scalar_one_or_none()

    if not service:
        raise HTTPException(status_code=404, detail=f"Service {service_id} not found")

    # 触发执行
    scheduler = get_scheduler()
    try:
        await scheduler.trigger_service_now(
            service_key=service.service_key,
            config_json=service.config_json or {}
        )
        logger.info(f"Service triggered manually: {service.service_key}")
    except Exception as e:
        logger.error(f"Failed to trigger service: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to trigger service: {str(e)}")

    return {"ok": True, "message": f"Service {service.service_key} triggered successfully"}


@router.post("/{service_id}/toggle")
async def toggle_sync_service(
    service_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """切换同步服务开关"""
    # 查找服务
    result = await db.execute(
        select(SyncService).where(SyncService.id == service_id)
    )
    service = result.scalar_one_or_none()

    if not service:
        raise HTTPException(status_code=404, detail=f"Service {service_id} not found")

    # 切换状态
    service.is_enabled = not service.is_enabled
    await db.commit()

    # 更新调度器
    scheduler = get_scheduler()
    try:
        if service.is_enabled:
            # 启用：添加到调度器
            await scheduler.add_service(
                service_key=service.service_key,
                service_type=service.service_type,
                schedule_config=service.schedule_config,
                config_json=service.config_json or {}
            )
            logger.info(f"Service enabled: {service.service_key}")
        else:
            # 禁用：从调度器移除
            await scheduler.remove_service(service.service_key)
            logger.info(f"Service disabled: {service.service_key}")
    except Exception as e:
        logger.error(f"Failed to toggle service in scheduler: {e}")

    return {
        "ok": True,
        "message": f"Service {service.service_key} {'enabled' if service.is_enabled else 'disabled'}",
        "is_enabled": service.is_enabled
    }


@router.get("/{service_id}/logs", response_model=List[SyncServiceLogResponse])
async def get_sync_service_logs(
    service_id: int,
    limit: int = Query(50, description="返回数量限制"),
    db: AsyncSession = Depends(get_async_session)
):
    """获取同步服务运行日志"""
    # 查找服务
    result = await db.execute(
        select(SyncService).where(SyncService.id == service_id)
    )
    service = result.scalar_one_or_none()

    if not service:
        raise HTTPException(status_code=404, detail=f"Service {service_id} not found")

    # 查询日志
    logs_result = await db.execute(
        select(SyncServiceLog)
        .where(SyncServiceLog.service_key == service.service_key)
        .order_by(desc(SyncServiceLog.started_at))
        .limit(limit)
    )
    logs = logs_result.scalars().all()

    return [
        SyncServiceLogResponse(
            id=log.id,
            service_key=log.service_key,
            run_id=log.run_id,
            started_at=log.started_at.isoformat(),
            finished_at=log.finished_at.isoformat() if log.finished_at else None,
            status=log.status,
            records_processed=log.records_processed,
            records_updated=log.records_updated,
            execution_time_ms=log.execution_time_ms,
            error_message=log.error_message,
            extra_data=log.extra_data
        )
        for log in logs
    ]


@router.get("/{service_id}/stats", response_model=SyncServiceStatsResponse)
async def get_sync_service_stats(
    service_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """获取同步服务统计数据"""
    # 查找服务
    result = await db.execute(
        select(SyncService).where(SyncService.id == service_id)
    )
    service = result.scalar_one_or_none()

    if not service:
        raise HTTPException(status_code=404, detail=f"Service {service_id} not found")

    # 查询最近100条日志
    logs_result = await db.execute(
        select(SyncServiceLog)
        .where(SyncServiceLog.service_key == service.service_key)
        .order_by(desc(SyncServiceLog.started_at))
        .limit(100)
    )
    logs = logs_result.scalars().all()

    # 计算统计数据
    total_runs = len(logs)
    success_count = sum(1 for log in logs if log.status == "success")
    success_rate = (success_count / total_runs * 100) if total_runs > 0 else 0.0

    # 计算平均执行时间
    execution_times = [log.execution_time_ms for log in logs if log.execution_time_ms is not None]
    avg_execution_time_ms = sum(execution_times) / len(execution_times) if execution_times else None

    # 获取最近的错误
    recent_errors = []
    for log in logs:
        if log.status == "failed" and log.error_message:
            recent_errors.append({
                "run_id": log.run_id,
                "started_at": log.started_at.isoformat(),
                "error_message": log.error_message[:200]  # 限制长度
            })
            if len(recent_errors) >= 5:  # 最多5条
                break

    return SyncServiceStatsResponse(
        total_runs=total_runs,
        success_rate=round(success_rate, 2),
        avg_execution_time_ms=round(avg_execution_time_ms, 2) if avg_execution_time_ms else None,
        recent_errors=recent_errors
    )
