"""
ARQ 任务工具模块

提供任务提交、状态查询等工具函数，供 API 路由和 Celery 派发器使用。
"""

import logging
import os
from typing import Any, Optional

from arq import create_pool
from arq.connections import RedisSettings
from arq.jobs import Job, JobStatus

logger = logging.getLogger(__name__)

# 全局连接池（懒加载）
_arq_pool = None


def get_redis_settings() -> RedisSettings:
    """
    获取 Redis 连接配置

    与 arq_worker.py 保持一致，使用 database=2
    """
    redis_host = os.getenv('EF__REDIS_HOST', 'localhost')
    redis_port = int(os.getenv('EF__REDIS_PORT', '6379'))
    redis_password = os.getenv('EF__REDIS_PASSWORD', None)

    return RedisSettings(
        host=redis_host,
        port=redis_port,
        password=redis_password,
        database=2,
    )


async def get_arq_pool():
    """
    获取 ARQ Redis 连接池

    使用单例模式，整个应用共享一个连接池。
    """
    global _arq_pool

    if _arq_pool is None:
        _arq_pool = await create_pool(get_redis_settings())
        logger.info("Created ARQ connection pool")

    return _arq_pool


async def close_arq_pool():
    """
    关闭 ARQ 连接池

    应在应用关闭时调用。
    """
    global _arq_pool

    if _arq_pool is not None:
        await _arq_pool.close()
        _arq_pool = None
        logger.info("Closed ARQ connection pool")


async def enqueue_task(
    func_name: str,
    *,
    _defer_by: Optional[int] = None,
    _defer_until: Optional[Any] = None,
    _job_id: Optional[str] = None,
    _queue_name: Optional[str] = None,
    **kwargs
) -> str:
    """
    提交单个任务到 ARQ 队列

    Args:
        func_name: 任务函数名（必须已在 WorkerSettings.functions 中注册）
        _defer_by: 延迟执行的秒数
        _defer_until: 延迟执行到指定时间（datetime）
        _job_id: 自定义任务 ID（用于幂等性）
        _queue_name: 队列名称（默认使用 arq:queue）
        **kwargs: 传递给任务函数的参数

    Returns:
        任务 ID (job_id)

    Usage:
        job_id = await enqueue_task("sync_shop_orders", shop_id=123)
    """
    pool = await get_arq_pool()

    job = await pool.enqueue_job(
        func_name,
        _defer_by=_defer_by,
        _defer_until=_defer_until,
        _job_id=_job_id,
        _queue_name=_queue_name,
        **kwargs
    )

    logger.info(f"Enqueued ARQ task: {func_name}, job_id={job.job_id}")
    return job.job_id


async def enqueue_batch(
    func_name: str,
    items: list,
    key_param: str = "item",
    *,
    _queue_name: Optional[str] = None,
) -> list[str]:
    """
    批量提交任务到 ARQ 队列

    为每个 item 创建一个独立任务，实现并行处理。

    Args:
        func_name: 任务函数名
        items: 要处理的项目列表
        key_param: 参数名（默认 "item"）
        _queue_name: 队列名称

    Returns:
        任务 ID 列表

    Usage:
        shop_ids = [1, 2, 3, 4, 5]
        job_ids = await enqueue_batch("sync_shop_orders", shop_ids, key_param="shop_id")
    """
    pool = await get_arq_pool()
    job_ids = []

    for item in items:
        job = await pool.enqueue_job(
            func_name,
            _queue_name=_queue_name,
            **{key_param: item}
        )
        job_ids.append(job.job_id)

    logger.info(f"Enqueued {len(job_ids)} ARQ tasks: {func_name}")
    return job_ids


async def get_job_status(job_id: str) -> dict[str, Any]:
    """
    获取任务状态

    Args:
        job_id: 任务 ID

    Returns:
        任务状态信息：
        {
            "job_id": "...",
            "status": "queued|in_progress|complete|not_found|deferred",
            "result": ...,  # 任务结果（如果已完成）
            "error": "...", # 错误信息（如果失败）
        }
    """
    pool = await get_arq_pool()
    job = Job(job_id, pool)
    status = await job.status()
    info = await job.info()

    if status == JobStatus.not_found:
        return {
            "job_id": job_id,
            "status": "not_found",
            "result": None,
            "error": None,
        }

    # 转换状态
    status_map = {
        JobStatus.queued: "queued",
        JobStatus.in_progress: "in_progress",
        JobStatus.complete: "complete",
        JobStatus.not_found: "not_found",
        JobStatus.deferred: "deferred",
    }

    result_data = {
        "job_id": job_id,
        "status": status_map.get(status, str(status)),
        "result": None,
        "error": None,
    }

    if info:
        result_data.update({
            "result": info.result if status == JobStatus.complete else None,
            "error": str(info.result) if status == JobStatus.complete and isinstance(info.result, Exception) else None,
            "function": info.function,
            "args": info.args,
            "kwargs": info.kwargs,
            "enqueue_time": info.enqueue_time.isoformat() if info.enqueue_time else None,
            "job_try": info.job_try,
        })

    return result_data


async def get_batch_status(job_ids: list[str]) -> dict[str, dict[str, Any]]:
    """
    批量获取任务状态

    Args:
        job_ids: 任务 ID 列表

    Returns:
        {job_id: status_info, ...}
    """
    results = {}
    for job_id in job_ids:
        results[job_id] = await get_job_status(job_id)
    return results


async def cancel_job(job_id: str) -> bool:
    """
    取消任务（仅对尚未开始的任务有效）

    Args:
        job_id: 任务 ID

    Returns:
        是否成功取消
    """
    pool = await get_arq_pool()
    job = Job(job_id, pool)

    try:
        await job.abort()
        logger.info(f"Cancelled ARQ job: {job_id}")
        return True
    except Exception as e:
        logger.warning(f"Failed to cancel ARQ job {job_id}: {e}")
        return False


async def get_queue_info(queue_name: str = "arq:queue") -> dict[str, Any]:
    """
    获取队列信息

    Args:
        queue_name: 队列名称

    Returns:
        队列信息：pending 数量等
    """
    pool = await get_arq_pool()

    # 获取队列长度
    pending_count = await pool.redis.llen(queue_name)

    return {
        "queue_name": queue_name,
        "pending": pending_count,
    }


# ====================================================================================
# 统一任务状态查询（支持 Celery 和 ARQ）
# ====================================================================================

async def get_unified_task_status(task_id: str, task_type: str = "auto") -> dict[str, Any]:
    """
    统一查询任务状态（自动识别 Celery/ARQ）

    Args:
        task_id: 任务 ID
        task_type: 任务类型，"celery"、"arq" 或 "auto"（自动检测）

    Returns:
        {
            "source": "celery" | "arq",
            "state": "PENDING|STARTED|SUCCESS|FAILURE|..." (Celery) 或 "queued|in_progress|complete|..." (ARQ),
            "result": ...,
            "error": ...,
        }
    """
    # 先尝试 ARQ
    if task_type in ("arq", "auto"):
        try:
            arq_status = await get_job_status(task_id)
            if arq_status["status"] != "not_found":
                return {
                    "source": "arq",
                    "state": arq_status["status"],
                    "result": arq_status["result"],
                    "error": arq_status["error"],
                }
        except Exception as e:
            logger.debug(f"ARQ status check failed for {task_id}: {e}")

    # 回退到 Celery
    if task_type in ("celery", "auto"):
        try:
            from celery.result import AsyncResult
            from ef_core.tasks.celery_app import celery_app

            result = AsyncResult(task_id, app=celery_app)

            return {
                "source": "celery",
                "state": result.state,
                "result": result.result if result.ready() else None,
                "error": str(result.result) if result.failed() else None,
            }
        except Exception as e:
            logger.debug(f"Celery status check failed for {task_id}: {e}")

    # 都找不到
    return {
        "source": "unknown",
        "state": "not_found",
        "result": None,
        "error": None,
    }
