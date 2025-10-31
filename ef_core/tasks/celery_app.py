"""
Celery 应用配置
"""
from celery import Celery, signals
from celery.schedules import crontab
from ef_core.config import get_settings
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)

# 获取配置
settings = get_settings()

# 创建 Celery 应用
celery_app = Celery(
    "euraflow",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "ef_core.tasks.core_tasks",
        "plugins.ef.channels.ozon.tasks",  # Ozon插件任务
    ]
)

# Celery 配置
celery_app.conf.update(
    # 任务序列化
    task_serializer=settings.celery_task_serializer,
    result_serializer=settings.celery_result_serializer,
    accept_content=settings.celery_accept_content,
    
    # 时区设置
    timezone=settings.celery_timezone,
    enable_utc=True,
    
    # 任务路由
    task_routes={
        "ef.core.*": {"queue": "ef_core"},
        "ef.*.pull_orders": {"queue": "ef_pull"},
        "ef.*.push_*": {"queue": "ef_push"},
    },
    
    # 任务结果配置
    result_expires=3600,  # 1小时后过期
    task_ignore_result=False,
    
    # Worker 配置
    worker_prefetch_multiplier=1,  # 公平调度
    task_acks_late=True,  # 任务完成后确认
    worker_max_tasks_per_child=1000,  # 每个worker处理1000个任务后重启
    
    # 重试配置
    task_default_retry_delay=60,  # 60秒后重试
    task_max_retries=5,  # 最多重试5次
    
    # 速率限制
    task_annotations={
        "*": {"rate_limit": "100/m"},  # 全局限制
    },
    
    # 监控配置
    worker_send_task_events=True,
    task_send_sent_event=True,
    
    # 任务压缩
    task_compression="gzip",
    result_compression="gzip",
)

# 定期任务配置（Beat Schedule）
celery_app.conf.beat_schedule = {
    # 系统健康检查
    "system-health-check": {
        "task": "ef.core.health_check",
        "schedule": crontab(minute="*/5"),  # 每5分钟
        "options": {"queue": "ef_core"}
    },

    # 清理过期任务结果
    "cleanup-expired-results": {
        "task": "ef.core.cleanup_results",
        "schedule": crontab(hour="2", minute="0"),  # 每天凌晨2点
        "options": {"queue": "ef_core"}
    },

    # OZON: 每天凌晨4点同步类目树
    "ozon-scheduled-category-sync": {
        "task": "ef.ozon.scheduled_category_sync",
        "schedule": crontab(hour=4, minute=0),  # 每天凌晨4点
        "options": {"queue": "ef_core"}
    },

    # OZON: 每周二凌晨4:10同步类目特征和字典值
    "ozon-scheduled-attributes-sync": {
        "task": "ef.ozon.scheduled_attributes_sync",
        "schedule": crontab(day_of_week=2, hour=4, minute=10),  # 周二凌晨4:10
        "options": {"queue": "ef_core"}
    },

    # 插件任务将通过 TaskRegistry 动态注册
}


@celery_app.task(bind=True, name="ef.core.health_check")
def health_check(self):
    """系统健康检查任务"""
    try:
        logger.info("Performing system health check")
        
        # TODO: 检查数据库连接
        # TODO: 检查 Redis 连接
        # TODO: 检查外部 API 连接
        
        logger.info("System health check completed", result="healthy")
        return {"status": "healthy", "timestamp": "2025-01-01T00:00:00Z"}
    
    except Exception as e:
        logger.error("System health check failed", exc_info=True)
        raise self.retry(countdown=60, max_retries=3)


@celery_app.task(bind=True, name="ef.core.cleanup_results")
def cleanup_results(self):
    """清理过期的任务结果"""
    try:
        logger.info("Cleaning up expired task results")
        
        # TODO: 清理 Redis 中过期的任务结果
        
        logger.info("Task results cleanup completed")
        return {"cleaned": 0, "timestamp": "2025-01-01T00:00:00Z"}
    
    except Exception as e:
        logger.error("Task results cleanup failed", exc_info=True)
        return {"error": str(e)}


# Celery 信号处理器
@signals.task_prerun.connect
def task_prerun_handler(sender=None, task_id=None, task=None, args=None, kwargs=None, **kwds):
    """任务开始前的处理"""
    logger.info(f"Task starting: {task.name}", task_id=task_id)


@signals.task_postrun.connect
def task_postrun_handler(sender=None, task_id=None, task=None, args=None, kwargs=None, retval=None, state=None, **kwds):
    """任务完成后的处理"""
    logger.info(f"Task completed: {task.name}", task_id=task_id, state=state)


@signals.task_failure.connect
def task_failure_handler(sender=None, task_id=None, exception=None, traceback=None, einfo=None, **kwds):
    """任务失败的处理"""
    logger.error(f"Task failed: {sender.name}", task_id=task_id, exception=str(exception))


@signals.task_retry.connect
def task_retry_handler(sender=None, task_id=None, reason=None, einfo=None, **kwds):
    """任务重试的处理"""
    logger.warning(f"Task retrying: {sender.name}", task_id=task_id, reason=str(reason))


@signals.worker_ready.connect
def cleanup_stale_tasks_on_startup(**kwargs):
    """
    Worker 启动时清理所有僵死的任务进度记录

    当 Celery worker 重启时，Redis 中可能还保留着旧的任务进度状态。
    这些状态会导致前端认为任务还在运行，但实际上 worker 已经重启，任务已经丢失。
    """
    try:
        import redis
        import json
        from celery.result import AsyncResult

        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        cleaned_count = 0
        zombie_count = 0

        for key in redis_client.keys("celery-task-progress:*"):
            try:
                data = redis_client.get(key)
                if not data:
                    continue

                progress = json.loads(data)
                task_id = key.replace("celery-task-progress:", "")

                # 检查任务状态
                if progress.get('status') in ['starting', 'syncing']:
                    # 检查 Celery 中任务是否真的在运行
                    result = AsyncResult(task_id, app=celery_app)

                    # PENDING 表示任务不存在或未开始，FAILURE/SUCCESS/REVOKED 表示任务已结束
                    if result.state in ['PENDING', 'FAILURE', 'SUCCESS', 'REVOKED']:
                        redis_client.delete(key)
                        zombie_count += 1
                        logger.warning(f"Cleaned zombie task {task_id} with Celery state {result.state}")
                    else:
                        logger.info(f"Task {task_id} is still running with state {result.state}")
                elif progress.get('status') in ['completed', 'failed']:
                    # 已完成的任务，清理掉
                    redis_client.delete(key)
                    cleaned_count += 1

            except Exception as e:
                logger.error(f"Error cleaning task progress {key}: {e}", exc_info=True)

        if zombie_count > 0 or cleaned_count > 0:
            logger.info(
                f"Startup cleanup completed: {zombie_count} zombie tasks, {cleaned_count} completed tasks removed"
            )
    except Exception as e:
        logger.error(f"Failed to cleanup stale tasks on startup: {e}", exc_info=True)