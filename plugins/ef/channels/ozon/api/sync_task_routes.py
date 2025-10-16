"""
同步任务状态查询 API路由
"""
from fastapi import APIRouter, HTTPException
import logging

from ..utils.datetime_utils import utcnow

router = APIRouter(prefix="/sync", tags=["ozon-sync-tasks"])
logger = logging.getLogger(__name__)


@router.get("/task/{task_id}")
async def get_task_status(task_id: str):
    """获取同步任务状态"""
    from ..services import OzonSyncService

    status = OzonSyncService.get_task_status(task_id)

    if not status:
        raise HTTPException(status_code=404, detail="Task not found")

    return {
        "task_id": task_id,
        "status": status
    }


@router.get("/status/debug")
async def debug_sync_status():
    """Debug endpoint to test sync status"""
    from ..services import OzonSyncService
    from ..services.ozon_sync import SYNC_TASKS

    # Add a test task
    SYNC_TASKS['debug_task'] = {
        'status': 'running',
        'progress': 75,
        'message': 'Debug task',
        'started_at': utcnow().isoformat()
    }

    # Get all tasks
    return {
        "ok": True,
        "tasks": SYNC_TASKS,
        "debug_task_status": OzonSyncService.get_task_status('debug_task')
    }


@router.get("/status/{task_id}")
async def get_sync_status(
    task_id: str
):
    """获取同步任务状态"""
    # Simplified version for debugging
    from ..services.ozon_sync import SYNC_TASKS

    # Get the task status directly
    status = SYNC_TASKS.get(task_id)

    if not status:
        # Return a 404 response
        return {
            "ok": False,
            "error": {
                "status": 404,
                "detail": f"Task {task_id} not found"
            }
        }

    # Return the status
    return {
        "ok": True,
        "data": status
    }
