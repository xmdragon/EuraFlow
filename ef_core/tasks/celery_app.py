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

    # 任务超时配置（防止僵尸任务）
    task_soft_time_limit=300,  # 5分钟软超时（触发 SoftTimeLimitExceeded 异常）
    task_time_limit=360,  # 6分钟硬超时（强制终止任务）

    # 速率限制
    task_annotations={
        "*": {"rate_limit": "100/m"},  # 全局限制
        # 长时间任务单独配置超时
        "ef.ozon.orders.pull": {"soft_time_limit": 600, "time_limit": 660},  # 10分钟
        "ef.ozon.inventory.sync": {"soft_time_limit": 600, "time_limit": 660},  # 10分钟
        "ef.ozon.promotions.sync": {"soft_time_limit": 600, "time_limit": 660},  # 10分钟
        "ef.ozon.batch_update_stocks": {"soft_time_limit": 900, "time_limit": 960},  # 15分钟
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


# 存储任务 log_id 的上下文（任务开始时创建，结束时更新）
_task_log_ids = {}

# 存储任务开始时间
_task_start_times = {}


def _record_task_start(task_name: str, task_id: str):
    """
    记录任务开始（使用同步数据库操作）

    Args:
        task_name: Celery 任务名
        task_id: 任务ID

    Returns:
        log_id，用于后续更新
    """
    import time
    _task_start_times[task_id] = time.time()

    try:
        from datetime import datetime, timezone
        from sqlalchemy import create_engine, select
        from sqlalchemy.orm import sessionmaker
        from ef_core.config import get_settings
        from plugins.ef.system.sync_service.models.sync_service import SyncService
        from plugins.ef.system.sync_service.models.sync_service_log import SyncServiceLog

        settings = get_settings()
        sync_db_url = settings.database_url.replace('+asyncpg', '')
        engine = create_engine(sync_db_url, pool_pre_ping=True, pool_recycle=3600)
        SessionLocal = sessionmaker(bind=engine)

        with SessionLocal() as db:
            # 通过 celery_task_name 查找服务
            stmt = select(SyncService).where(SyncService.celery_task_name == task_name)
            service = db.execute(stmt).scalar_one_or_none()

            if not service:
                logger.debug(f"Service not found for task: {task_name}")
                return None

            # 更新服务状态
            service.last_run_at = datetime.now(timezone.utc)
            service.last_run_status = "running"

            # 创建日志记录
            log = SyncServiceLog(
                service_key=service.service_key,
                run_id=task_id,
                started_at=datetime.now(timezone.utc),
                status="running",
            )
            db.add(log)
            db.commit()
            db.refresh(log)

            logger.debug(f"Task started: {task_name}, log_id={log.id}")
            return log.id

    except Exception as e:
        logger.error(f"Failed to record task start for {task_name}: {e}", exc_info=True)
        return None


def _record_task_end(task_name: str, task_id: str, success: bool, error_message: str = None):
    """
    记录任务结束（使用同步数据库操作）

    Args:
        task_name: Celery 任务名
        task_id: 任务ID
        success: 是否成功
        error_message: 错误信息（失败时）
    """
    import time

    # 计算执行时间
    start_time = _task_start_times.pop(task_id, None)
    execution_time_ms = int((time.time() - start_time) * 1000) if start_time else 0

    # 获取 log_id
    log_id = _task_log_ids.pop(task_id, None)

    try:
        from datetime import datetime, timezone
        from sqlalchemy import create_engine, select
        from sqlalchemy.orm import sessionmaker
        from ef_core.config import get_settings
        from plugins.ef.system.sync_service.models.sync_service import SyncService
        from plugins.ef.system.sync_service.models.sync_service_log import SyncServiceLog

        settings = get_settings()
        sync_db_url = settings.database_url.replace('+asyncpg', '')
        engine = create_engine(sync_db_url, pool_pre_ping=True, pool_recycle=3600)
        SessionLocal = sessionmaker(bind=engine)

        with SessionLocal() as db:
            # 更新日志记录
            if log_id:
                stmt = select(SyncServiceLog).where(SyncServiceLog.id == log_id)
                log = db.execute(stmt).scalar_one_or_none()

                if log:
                    log.finished_at = datetime.now(timezone.utc)
                    log.status = "success" if success else "failed"
                    log.execution_time_ms = execution_time_ms
                    if error_message:
                        log.error_message = error_message[:2000]  # 截断过长的错误信息

            # 更新服务统计
            stmt = select(SyncService).where(SyncService.celery_task_name == task_name)
            service = db.execute(stmt).scalar_one_or_none()

            if service:
                service.run_count = (service.run_count or 0) + 1
                if success:
                    service.success_count = (service.success_count or 0) + 1
                    service.last_run_status = "success"
                    service.last_run_message = f"执行成功，耗时 {execution_time_ms}ms"
                else:
                    service.error_count = (service.error_count or 0) + 1
                    service.last_run_status = "failed"
                    service.last_run_message = error_message[:500] if error_message else "执行失败"

            db.commit()
            logger.debug(f"Task ended: {task_name}, success={success}, time={execution_time_ms}ms")

    except Exception as e:
        logger.error(f"Failed to record task end for {task_name}: {e}", exc_info=True)


def _sync_registry_to_database(registered_tasks: dict):
    """
    同步 TaskRegistry 到数据库

    策略：
    1. 遍历 registry 中的所有任务
    2. 如果数据库中不存在该 celery_task_name，则创建
    3. 如果存在但配置不同，更新（仅更新 source=code 的记录）
    4. 标记数据库中存在但 registry 中不存在的任务为 is_deleted=True
    """
    try:
        from sqlalchemy import create_engine, select
        from sqlalchemy.orm import sessionmaker
        from ef_core.config import get_settings
        from plugins.ef.system.sync_service.models.sync_service import SyncService

        settings = get_settings()
        sync_db_url = settings.database_url.replace('+asyncpg', '')
        engine = create_engine(sync_db_url, pool_pre_ping=True, pool_recycle=3600)
        SessionLocal = sessionmaker(bind=engine)

        created = 0
        updated = 0
        deleted = 0

        with SessionLocal() as db:
            # 获取所有现有服务（按 celery_task_name）
            stmt = select(SyncService)
            existing_services = {s.celery_task_name: s for s in db.execute(stmt).scalars().all() if s.celery_task_name}

            # 获取所有现有 service_key
            all_services = {s.service_key: s for s in db.execute(select(SyncService)).scalars().all()}

            registered_task_names = set(registered_tasks.keys())

            # 同步任务
            for task_name, task_info in registered_tasks.items():
                cron = task_info.get("cron", "")
                plugin = task_info.get("plugin", "")
                display_name = task_info.get("display_name") or task_name
                description = task_info.get("description") or ""

                # 生成 service_key（从任务名转换）
                service_key = task_name.replace(".", "_")

                if task_name in existing_services:
                    # 已存在，检查是否需要更新
                    service = existing_services[task_name]
                    if service.source == "code":
                        # 只更新代码来源的配置
                        need_update = False
                        if service.schedule_config != cron:
                            service.schedule_config = cron
                            need_update = True
                        if service.service_name != display_name:
                            service.service_name = display_name
                            need_update = True
                        if service.service_description != description:
                            service.service_description = description
                            need_update = True
                        if service.is_deleted:
                            service.is_deleted = False
                            need_update = True

                        if need_update:
                            updated += 1
                            logger.debug(f"Updated sync service: {task_name}")
                elif service_key in all_services:
                    # service_key 存在但没有 celery_task_name，更新它
                    service = all_services[service_key]
                    service.celery_task_name = task_name
                    service.plugin_name = plugin
                    service.source = "code"
                    service.is_deleted = False
                    if service.schedule_config != cron:
                        service.schedule_config = cron
                    updated += 1
                    logger.debug(f"Linked existing service {service_key} to {task_name}")
                else:
                    # 创建新服务
                    new_service = SyncService(
                        service_key=service_key,
                        service_name=display_name,
                        service_description=description,
                        service_type="cron",
                        schedule_config=cron,
                        is_enabled=True,
                        celery_task_name=task_name,
                        plugin_name=plugin,
                        source="code",
                        is_deleted=False,
                    )
                    db.add(new_service)
                    created += 1
                    logger.debug(f"Created sync service: {task_name}")

            # 标记已删除的任务
            for task_name, service in existing_services.items():
                if task_name not in registered_task_names and service.source == "code" and not service.is_deleted:
                    service.is_deleted = True
                    deleted += 1
                    logger.debug(f"Marked sync service as deleted: {task_name}")

            db.commit()

        logger.info(f"📊 Synced registry to database: created={created}, updated={updated}, deleted={deleted}")

    except Exception as e:
        logger.error(f"Failed to sync registry to database: {e}", exc_info=True)


# Celery 信号处理器（注意：必须在模块级别定义，Worker 启动时会自动注册）
@signals.task_prerun.connect
def task_prerun_handler(sender=None, task_id=None, task=None, args=None, kwargs=None, **kwds):
    """任务开始前的处理"""
    logger.debug(f"Task prerun: {task.name}, task_id={task_id}")
    logger.info(f"Task starting: {task.name}", task_id=task_id)

    # 记录任务开始到 sync_service_logs
    try:
        log_id = _record_task_start(task.name, task_id)
        if log_id:
            _task_log_ids[task_id] = log_id
    except Exception as e:
        logger.error(f"Failed to record task start: {e}", exc_info=True)


@signals.task_postrun.connect
def task_postrun_handler(sender=None, task_id=None, task=None, args=None, kwargs=None, retval=None, state=None, **kwds):
    """任务完成后的处理"""
    logger.debug(f"Task postrun: {task.name}, task_id={task_id}, state={state}")
    logger.info(f"Task completed: {task.name}", task_id=task_id, state=state)

    # 记录任务结束到 sync_service_logs
    try:
        _record_task_end(task.name, task_id, success=True)
    except Exception as e:
        logger.error(f"Failed to record task end: {e}", exc_info=True)


@signals.task_failure.connect
def task_failure_handler(sender=None, task_id=None, exception=None, traceback=None, einfo=None, **kwds):
    """任务失败的处理"""
    logger.error(f"Task failed: {sender.name}", task_id=task_id, exception=str(exception))

    # 记录任务失败到 sync_service_logs
    try:
        _record_task_end(sender.name, task_id, success=False, error_message=str(exception))
    except Exception as e:
        logger.error(f"Failed to record task failure: {e}", exc_info=True)


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
        # 先检测是否已有运行中的事件循环，避免创建不会被 await 的协程
        try:
            asyncio.get_running_loop()
            has_running_loop = True
        except RuntimeError:
            has_running_loop = False

        if has_running_loop:
            # Celery worker 环境中已有运行中的事件循环
            # 创建新的事件循环来执行初始化
            logger.warning("Detected running event loop, creating new event loop for plugin initialization")
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                task_registry = loop.run_until_complete(async_init())
            finally:
                loop.close()
                # 重要：清理事件循环引用，避免后续冲突
                asyncio.set_event_loop(None)
        else:
            # 没有运行中的事件循环
            # 创建新的事件循环但不在结束后清除，以便 ARQ 等其他组件可以使用
            # 注意：asyncio.run() 会在结束后关闭事件循环，导致后续 get_event_loop() 失败
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                task_registry = loop.run_until_complete(async_init())
            finally:
                # 关闭事件循环但创建一个新的空循环供后续使用
                loop.close()
                # 创建新的事件循环供其他组件（如 ARQ）使用
                new_loop = asyncio.new_event_loop()
                asyncio.set_event_loop(new_loop)

        logger.info(f"✅ Celery plugin initialization completed, registered {len(task_registry.registered_tasks)} tasks")

        # 输出注册的任务列表（便于调试）
        for task_name in task_registry.registered_tasks.keys():
            logger.info(f"  📋 Registered task: {task_name}")

        # 同步任务注册表到数据库
        _sync_registry_to_database(task_registry.registered_tasks)

    except Exception as e:
        logger.error(f"Failed to initialize plugins for Celery: {e}", exc_info=True)

# 立即执行插件初始化
_initialize_plugins_for_celery()

# 确认信号处理器已注册
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