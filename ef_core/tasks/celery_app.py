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

    # 注意：OZON 类目同步和特征同步任务已移除（未实现对应的任务函数）
    # 如需启用，需在 OZON 插件中注册对应的 Celery 任务

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
def cleanup_results(self, older_than_days=1):
    """
    清理过期的任务结果

    Args:
        older_than_days: 清理多少天前的结果（默认1天）

    Returns:
        清理统计信息
    """
    import time
    from datetime import datetime, UTC

    try:
        logger.info(f"Starting cleanup of task results older than {older_than_days} days")

        # 获取 Redis 连接
        redis_client = celery_app.backend.client

        # 统计信息
        stats = {
            "started_at": datetime.now(UTC).isoformat(),
            "scanned": 0,
            "cleaned": 0,
            "errors": 0,
            "older_than_days": older_than_days
        }

        # 计算过期时间戳（秒）
        cutoff_timestamp = time.time() - (older_than_days * 24 * 3600)

        # 扫描所有 Celery 任务结果键
        # Celery 默认使用 "celery-task-meta-{task_id}" 作为键名
        cursor = 0
        batch_size = 1000

        while True:
            # 使用 SCAN 命令批量扫描键（避免阻塞 Redis）
            cursor, keys = redis_client.scan(
                cursor=cursor,
                match="celery-task-meta-*",
                count=batch_size
            )

            stats["scanned"] += len(keys)

            # 检查每个键
            for key in keys:
                try:
                    # 获取键的 TTL（剩余生存时间）
                    ttl = redis_client.ttl(key)

                    # TTL = -1 表示永不过期，TTL = -2 表示键不存在
                    if ttl == -1:
                        # 对于永不过期的键，检查创建时间
                        # 尝试获取任务结果的时间戳
                        result = redis_client.get(key)
                        if result:
                            # Celery 结果包含 date_done 字段
                            import json
                            try:
                                result_data = json.loads(result)
                                date_done = result_data.get('date_done')

                                if date_done:
                                    # 解析时间戳
                                    from dateutil import parser
                                    done_time = parser.parse(date_done)
                                    done_timestamp = done_time.timestamp()

                                    # 如果超过阈值，删除
                                    if done_timestamp < cutoff_timestamp:
                                        redis_client.delete(key)
                                        stats["cleaned"] += 1
                            except (json.JSONDecodeError, ValueError):
                                # 无法解析的结果，跳过
                                pass

                    elif ttl == -2:
                        # 键已经不存在，跳过
                        pass

                except Exception as e:
                    logger.warning(f"Error processing key {key}: {e}")
                    stats["errors"] += 1

            # 如果游标回到0，表示扫描完成
            if cursor == 0:
                break

        # 额外清理：删除已过期但未被自动清理的键
        # Celery 有时会留下一些过期键
        cursor = 0
        while True:
            cursor, keys = redis_client.scan(
                cursor=cursor,
                match="celery-task-meta-*",
                count=batch_size
            )

            for key in keys:
                try:
                    ttl = redis_client.ttl(key)
                    # 如果 TTL <= 0（已过期），直接删除
                    if ttl == -2 or (ttl > 0 and ttl < 0):
                        redis_client.delete(key)
                        stats["cleaned"] += 1
                except Exception as e:
                    stats["errors"] += 1

            if cursor == 0:
                break

        # 记录完成时间
        stats["completed_at"] = datetime.now(UTC).isoformat()

        logger.info(
            f"Task results cleanup completed",
            scanned=stats["scanned"],
            cleaned=stats["cleaned"],
            errors=stats["errors"]
        )

        return stats

    except Exception as e:
        logger.error("Task results cleanup failed", exc_info=True)
        return {
            "error": str(e),
            "scanned": 0,
            "cleaned": 0,
            "errors": 1
        }


# Celery 任务名到 service_key 的映射
TASK_TO_SERVICE_KEY_MAPPING = {
    "ef.system.database_backup": "database_backup",
    "ef.ozon.kuajing84.material_cost": "kuajing84_material_cost",
    "ef.ozon.finance.sync": "ozon_finance_sync",
    "ef.ozon.finance.transactions": "ozon_finance_transactions_daily",
    "ef.ozon.orders.pull": "ozon_sync_incremental",
    "ef.finance.rates.refresh": "exchange_rate_refresh",
    "ef.ozon.promotions.sync": "ozon_promotion_sync",
    # 注意：以下任务没有对应的 sync_service 记录，不需要统计
    # ef.ozon.inventory.sync
    # ef.ozon.promotions.health_check  （健康检查不需要统计）
    # ef.ozon.category.sync
    # ef.ozon.attributes.sync
}

# 缓存 SyncService 模型类（避免重复导入导致 SQLAlchemy 表重定义错误）
_sync_service_model = None


def _update_service_stats(task_name: str, success: bool, task_id: str, error_message: str = None):
    """
    更新同步服务统计信息（使用同步数据库操作）

    Args:
        task_name: Celery 任务名
        success: 是否成功
        task_id: 任务ID
        error_message: 错误信息（失败时）
    """
    print(f"[DEBUG] _update_service_stats called: task_name={task_name}, success={success}", flush=True)

    # 检查是否是需要统计的服务任务
    service_key = TASK_TO_SERVICE_KEY_MAPPING.get(task_name)
    if not service_key:
        # 不是注册的服务任务，跳过统计
        print(f"[DEBUG] No service_key mapping for task {task_name}, skipping stats update", flush=True)
        return

    print(f"[DEBUG] Updating stats for service_key={service_key}", flush=True)

    try:
        from datetime import datetime, UTC
        from sqlalchemy import create_engine, select
        from sqlalchemy.orm import sessionmaker
        from ef_core.config import get_settings

        # 使用缓存的模型类
        global _sync_service_model
        if _sync_service_model is None:
            from plugins.ef.system.sync_service.models.sync_service import SyncService
            _sync_service_model = SyncService

        SyncService = _sync_service_model

        # 创建同步数据库引擎（适用于 gevent 环境）
        settings = get_settings()
        sync_db_url = settings.database_url.replace('+asyncpg', '')  # 移除 asyncpg，使用 psycopg2
        engine = create_engine(sync_db_url, pool_pre_ping=True, pool_recycle=3600)
        SessionLocal = sessionmaker(bind=engine)

        with SessionLocal() as db:
            # 查询服务记录
            stmt = select(SyncService).where(SyncService.service_key == service_key)
            service = db.execute(stmt).scalar_one_or_none()

            if not service:
                logger.warning(f"Service not found for task {task_name} (service_key: {service_key})")
                print(f"[DEBUG] ⚠️  Service not found: {service_key}", flush=True)
                return

            # 更新统计字段
            service.run_count = (service.run_count or 0) + 1
            service.last_run_at = datetime.now(UTC)

            if success:
                service.success_count = (service.success_count or 0) + 1
                service.last_run_status = "success"
                service.last_run_message = "任务执行成功"
            else:
                service.error_count = (service.error_count or 0) + 1
                service.last_run_status = "error"
                service.last_run_message = error_message or "任务执行失败"

            db.commit()

            logger.info(
                f"Updated stats for service {service_key}: "
                f"run_count={service.run_count}, "
                f"success_count={service.success_count}, "
                f"error_count={service.error_count}"
            )
            print(
                f"[DEBUG] ✅ Stats updated successfully: service_key={service_key}, "
                f"run_count={service.run_count}, success_count={service.success_count}, "
                f"error_count={service.error_count}",
                flush=True
            )

    except Exception as e:
        logger.error(f"Failed to update service stats for {task_name}: {e}", exc_info=True)
        print(f"[DEBUG] ❌ Failed to update stats: {e}", flush=True)


# Celery 信号处理器（注意：必须在模块级别定义，Worker 启动时会自动注册）
@signals.task_prerun.connect
def task_prerun_handler(sender=None, task_id=None, task=None, args=None, kwargs=None, **kwds):
    """任务开始前的处理"""
    print(f"[DEBUG] Task prerun: {task.name}, task_id={task_id}", flush=True)
    logger.info(f"Task starting: {task.name}", task_id=task_id)


@signals.task_postrun.connect
def task_postrun_handler(sender=None, task_id=None, task=None, args=None, kwargs=None, retval=None, state=None, **kwds):
    """任务完成后的处理"""
    print(f"[DEBUG] Task postrun: {task.name}, task_id={task_id}, state={state}", flush=True)
    logger.info(f"Task completed: {task.name}", task_id=task_id, state=state)

    # 更新同步服务统计（仅针对注册的服务任务）
    print(f"[DEBUG] About to call _update_service_stats for {task.name}", flush=True)
    try:
        _update_service_stats(task.name, success=True, task_id=task_id)
        print(f"[DEBUG] _update_service_stats call completed", flush=True)
    except Exception as e:
        print(f"[DEBUG] ❌ Exception in _update_service_stats: {e}", flush=True)
        logger.error(f"Exception in _update_service_stats: {e}", exc_info=True)


@signals.task_failure.connect
def task_failure_handler(sender=None, task_id=None, exception=None, traceback=None, einfo=None, **kwds):
    """任务失败的处理"""
    logger.error(f"Task failed: {sender.name}", task_id=task_id, exception=str(exception))

    # 更新同步服务统计（仅针对注册的服务任务）
    _update_service_stats(sender.name, success=False, task_id=task_id, error_message=str(exception))


@signals.task_retry.connect
def task_retry_handler(sender=None, task_id=None, reason=None, einfo=None, **kwds):
    """任务重试的处理"""
    logger.warning(f"Task retrying: {sender.name}", task_id=task_id, reason=str(reason))


# ====================================================================================
# 关键：在模块加载时初始化插件（确保 Celery Beat 和 Worker 都能加载插件任务）
# ====================================================================================
def _initialize_plugins_for_celery():
    """
    Celery 模块加载时初始化插件并注册定时任务

    这是关键！Celery Beat 作为独立进程启动，不会触发 FastAPI 的 startup 事件，
    所以必须在模块加载时显式初始化插件，否则插件注册的定时任务不会被调度。

    放在模块级别执行，确保无论是 Beat 还是 Worker，只要导入了 celery_app 就会初始化。
    """
    try:
        import asyncio
        from ef_core.plugin_host import get_plugin_host
        from ef_core.tasks.registry import TaskRegistry
        from ef_core.event_bus import EventBus

        logger.info("🔧 Initializing plugins for Celery...")

        # 在同一个事件循环中完成所有异步初始化
        async def async_init():
            # 创建任务注册表和事件总线
            task_registry = TaskRegistry()
            event_bus = EventBus()

            try:
                # 初始化事件总线
                await event_bus.initialize()

                # 获取插件宿主并注入依赖
                plugin_host = get_plugin_host()
                plugin_host.task_registry = task_registry
                plugin_host.event_bus = event_bus

                # 初始化所有插件（会调用每个插件的 setup() 并注册定时任务）
                await plugin_host.initialize()

                return task_registry
            finally:
                # 关键修复：在事件循环结束前正确关闭 EventBus，避免 "Event loop is closed" 错误
                await event_bus.shutdown()

        # 在单个事件循环中执行所有异步操作
        task_registry = asyncio.run(async_init())

        logger.info(f"✅ Celery plugin initialization completed, registered {len(task_registry.registered_tasks)} tasks")

        # 输出注册的任务列表（便于调试）
        for task_name in task_registry.registered_tasks.keys():
            logger.info(f"  📋 Registered task: {task_name}")

    except Exception as e:
        logger.error(f"❌ Failed to initialize plugins for Celery: {e}", exc_info=True)
        import traceback
        traceback.print_exc()

# 立即执行插件初始化
_initialize_plugins_for_celery()

# 确认信号处理器已注册
print(f"[DEBUG] Celery signal handlers registered: task_postrun={len(signals.task_postrun.receivers)}, task_failure={len(signals.task_failure.receivers)}", flush=True)
logger.info(f"Celery signal handlers registered: task_postrun={len(signals.task_postrun.receivers)}, task_failure={len(signals.task_failure.receivers)}")


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


# ============================================================================
# 导入核心任务模块以注册核心系统任务
# ============================================================================
# 导入 core_tasks 模块会自动执行其中的 register_core_tasks() 函数
# 这会将以下核心系统任务添加到 Celery Beat 调度中：
# - ef.core.system_health_check (每5分钟)
# - ef.core.cleanup_expired_data (每天凌晨3点)
# - ef.core.metrics_collection (每10分钟)
# - ef.core.event_bus_maintenance (每天凌晨1:30)
from . import core_tasks  # noqa: F401