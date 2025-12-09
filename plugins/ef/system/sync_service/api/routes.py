"""
同步服务管理API路由

功能：
1. GET /handlers - 列出所有可用Handler
2. GET /sync-services - 查看所有同步服务
3. PUT /{id} - 更新服务配置（cron表达式、启用/禁用）
4. GET /{id}/logs - 查看服务日志
5. GET /{id}/stats - 查看服务统计
6. POST /{id}/trigger - 手动触发服务（调用 Celery）
7. DELETE /{id}/logs - 清空服务日志

注意：
- 定时任务统一由 Celery Beat 调度（在插件 setup() 中注册）
- 配置存储在数据库中，支持动态修改
- celery_task_name 字段用于关联 Celery 任务
"""
import logging
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, desc, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.middleware.auth import require_role
from ef_core.tasks.registry import get_task_registry
from ..models.sync_service import SyncService
from ..models.sync_service_log import SyncServiceLog
from ..services.handler_registry import get_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sync-services", tags=["Sync Services"])


# ========== DTOs ==========

class HandlerInfoResponse(BaseModel):
    """可用Handler信息响应"""
    service_key: str
    name: str
    description: str
    plugin: str
    config_schema: dict


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
    # Celery 集成字段
    celery_task_name: Optional[str] = None
    plugin_name: Optional[str] = None
    source: Optional[str] = None


class UpdateSyncServiceRequest(BaseModel):
    """更新同步服务请求DTO"""
    schedule_config: Optional[str] = Field(None, description="Cron表达式")
    is_enabled: Optional[bool] = Field(None, description="是否启用")


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


class ClearLogsRequest(BaseModel):
    """清空日志请求DTO"""
    before_date: Optional[str] = Field(None, description="清空此日期前的日志（ISO格式，可选）")


# ========== 路由处理函数 ==========

@router.get("/handlers", response_model=List[HandlerInfoResponse])
async def list_handlers():
    """列出所有可用的服务Handler"""
    registry = get_registry()
    handlers = registry.list_handlers()

    return [
        HandlerInfoResponse(
            service_key=h["service_key"],
            name=h["name"],
            description=h["description"],
            plugin=h["plugin"],
            config_schema=h.get("config_schema", {})
        )
        for h in handlers
    ]


@router.get("", response_model=List[SyncServiceResponse])
async def list_sync_services(
    is_enabled: Optional[bool] = Query(None, description="筛选启用状态"),
    include_deleted: bool = Query(False, description="是否包含已删除的服务"),
    db: AsyncSession = Depends(get_async_session)
):
    """获取同步服务列表"""
    query = select(SyncService)

    # 默认不显示已删除的服务
    if not include_deleted:
        query = query.where(SyncService.is_deleted == False)

    if is_enabled is not None:
        query = query.where(SyncService.is_enabled == is_enabled)

    # 按service_key字典序排序，保证顺序固定
    query = query.order_by(SyncService.service_key.asc())

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
            updated_at=service.updated_at.isoformat() if service.updated_at else "",
            celery_task_name=service.celery_task_name,
            plugin_name=service.plugin_name,
            source=service.source
        )
        for service in services
    ]


@router.put("/{service_id}")
async def update_sync_service(
    service_id: int,
    request: UpdateSyncServiceRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """
    更新同步服务配置（需要操作员权限）

    支持修改：
    - schedule_config: Cron 表达式
    - is_enabled: 启用/禁用
    """
    from croniter import croniter

    # 查找服务
    result = await db.execute(
        select(SyncService).where(SyncService.id == service_id)
    )
    service = result.scalar_one_or_none()

    if not service:
        raise HTTPException(status_code=404, detail=f"Service {service_id} not found")

    # 更新字段
    if request.schedule_config is not None:
        # 验证 cron 表达式
        try:
            croniter(request.schedule_config)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid cron expression: {request.schedule_config}"
            )
        service.schedule_config = request.schedule_config
        logger.info(f"Updated schedule_config for {service.service_key}: {request.schedule_config}")

    if request.is_enabled is not None:
        service.is_enabled = request.is_enabled
        logger.info(f"Updated is_enabled for {service.service_key}: {request.is_enabled}")

    await db.commit()
    await db.refresh(service)

    return {
        "ok": True,
        "message": f"Service {service.service_key} updated successfully",
        "data": {
            "id": service.id,
            "service_key": service.service_key,
            "schedule_config": service.schedule_config,
            "is_enabled": service.is_enabled
        }
    }


@router.post("/{service_id}/trigger")
async def trigger_sync_service(
    service_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """
    手动触发同步服务（需要操作员权限）

    通过 Celery 任务队列执行
    """
    # 查找服务
    result = await db.execute(
        select(SyncService).where(SyncService.id == service_id)
    )
    service = result.scalar_one_or_none()

    if not service:
        raise HTTPException(status_code=404, detail=f"Service {service_id} not found")

    # 使用 celery_task_name 字段
    task_name = service.celery_task_name

    if not task_name:
        raise HTTPException(
            status_code=400,
            detail=f"No Celery task linked for service: {service.service_key}. "
                   f"This service may not be registered via code."
        )

    # 触发 Celery 任务
    try:
        task_registry = get_task_registry()
        task_id = await task_registry.trigger_task_now(
            name=task_name,
            **(service.config_json or {})
        )

        logger.info(f"Service triggered manually via Celery: {service.service_key} -> {task_name}, task_id={task_id}")

        return {
            "ok": True,
            "message": f"Service {service.service_key} triggered successfully",
            "task_id": task_id,
            "task_name": task_name
        }

    except ValueError as e:
        # 任务未注册或被禁用
        logger.error(f"Failed to trigger service: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        logger.error(f"Failed to trigger service: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to trigger service: {str(e)}")


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


@router.delete("/{service_id}/logs")
async def clear_sync_service_logs(
    service_id: int,
    request: ClearLogsRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """清空同步服务日志（需要操作员权限）"""
    # 查找服务
    result = await db.execute(
        select(SyncService).where(SyncService.id == service_id)
    )
    service = result.scalar_one_or_none()

    if not service:
        raise HTTPException(status_code=404, detail=f"Service {service_id} not found")

    # 解析日期
    before_date = None
    if request.before_date:
        try:
            before_date = datetime.fromisoformat(request.before_date.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format, use ISO 8601")

    # 构建删除查询
    delete_query = delete(SyncServiceLog).where(
        SyncServiceLog.service_key == service.service_key
    )

    if before_date:
        delete_query = delete_query.where(SyncServiceLog.started_at < before_date)

    # 执行删除
    delete_result = await db.execute(delete_query)
    deleted_count = delete_result.rowcount

    await db.commit()

    logger.info(f"Cleared {deleted_count} logs for service {service.service_key}")

    return {
        "ok": True,
        "data": {
            "deleted_count": deleted_count
        },
        "message": f"Cleared {deleted_count} log(s)"
    }


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


@router.post("/{service_id}/reset-stats")
async def reset_sync_service_stats(
    service_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """重置同步服务统计数据（需要操作员权限）"""
    # 查找服务
    result = await db.execute(
        select(SyncService).where(SyncService.id == service_id)
    )
    service = result.scalar_one_or_none()

    if not service:
        raise HTTPException(status_code=404, detail=f"Service {service_id} not found")

    # 重置统计数据
    service.run_count = 0
    service.success_count = 0
    service.error_count = 0
    service.last_run_at = None
    service.last_run_status = None
    service.last_run_message = None

    await db.commit()

    logger.info(f"Reset statistics for service {service.service_key}")

    return {
        "ok": True,
        "message": "统计数据已重置"
    }
