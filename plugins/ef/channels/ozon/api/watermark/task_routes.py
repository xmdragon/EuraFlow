"""
水印任务管理 API 路由
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session

from ...models.watermark import WatermarkTask
from .dto import WatermarkTaskResponse

router = APIRouter(tags=["watermark-tasks"])
logger = logging.getLogger(__name__)


@router.get("/tasks/{task_id}")
async def get_task_status(
    task_id: str,
    db: AsyncSession = Depends(get_async_session)
):
    """获取任务状态"""
    task = await db.get(WatermarkTask, task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return WatermarkTaskResponse(
        id=task.id,
        shop_id=task.shop_id,
        product_id=task.product_id,
        task_type=task.task_type,
        status=task.status,
        watermark_config_id=task.watermark_config_id,
        error_message=task.error_message,
        retry_count=task.retry_count,
        batch_id=task.batch_id,
        batch_total=task.batch_total,
        batch_position=task.batch_position,
        created_at=task.created_at,
        processing_started_at=task.processing_started_at,
        completed_at=task.completed_at
    )


@router.get("/tasks")
async def list_tasks(
    shop_id: Optional[int] = Query(None),
    batch_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_async_session)
):
    """获取任务列表"""
    query = select(WatermarkTask)

    if shop_id is not None:
        query = query.where(WatermarkTask.shop_id == shop_id)

    if batch_id:
        query = query.where(WatermarkTask.batch_id == batch_id)

    if status:
        query = query.where(WatermarkTask.status == status)

    query = query.order_by(WatermarkTask.created_at.desc()).limit(limit)

    result = await db.execute(query)
    tasks = result.scalars().all()

    return [
        WatermarkTaskResponse(
            id=task.id,
            shop_id=task.shop_id,
            product_id=task.product_id,
            task_type=task.task_type,
            status=task.status,
            watermark_config_id=task.watermark_config_id,
            error_message=task.error_message,
            retry_count=task.retry_count,
            batch_id=task.batch_id,
            batch_total=task.batch_total,
            batch_position=task.batch_position,
            created_at=task.created_at,
            processing_started_at=task.processing_started_at,
            completed_at=task.completed_at
        )
        for task in tasks
    ]
