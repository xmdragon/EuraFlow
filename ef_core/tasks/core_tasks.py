"""
核心系统任务
"""
import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any

from ef_core.event_bus import get_event_bus
from ef_core.utils.logger import get_logger
from .base import task_with_context, retry_task

logger = get_logger(__name__)


@task_with_context(bind=False, name="ef.core.system_health_check")
async def system_health_check() -> Dict[str, Any]:
    """系统健康检查"""
    from ef_core.tasks.task_logger import update_task_result, record_task_error

    logger.info("Starting system health check")

    health_status = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "status": "healthy",
        "checks": {}
    }

    try:
        # 检查数据库连接（使用独立引擎避免事件循环冲突）
        try:
            from sqlalchemy.ext.asyncio import create_async_engine
            from ef_core.config import get_settings

            settings = get_settings()
            start_time = datetime.utcnow()

            # 创建独立的引擎实例（不使用单例，避免事件循环绑定问题）
            temp_engine = create_async_engine(
                settings.database_url,
                pool_pre_ping=True,
                pool_size=1,
                max_overflow=0,
            )
            try:
                async with temp_engine.begin() as conn:
                    from sqlalchemy import text
                    await conn.execute(text("SELECT 1"))
                db_healthy = True
            finally:
                await temp_engine.dispose()

            latency_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            health_status["checks"]["database"] = {
                "status": "healthy" if db_healthy else "unhealthy",
                "latency_ms": latency_ms
            }
        except Exception as e:
            logger.error("Database health check failed", exc_info=True)
            health_status["checks"]["database"] = {
                "status": "unhealthy",
                "error": str(e)
            }
            health_status["status"] = "unhealthy"

        # 检查事件总线
        try:
            event_bus = get_event_bus()
            # TODO: 实现 Redis 连接检查
            health_status["checks"]["event_bus"] = {
                "status": "healthy"
            }
        except Exception as e:
            logger.error("Event bus health check failed", exc_info=True)
            health_status["checks"]["event_bus"] = {
                "status": "unhealthy",
                "error": str(e)
            }
            health_status["status"] = "unhealthy"

        # 检查插件状态
        try:
            from ef_core.plugin_host import get_plugin_host
            plugin_host = get_plugin_host()

            plugin_count = len(plugin_host.plugins)
            enabled_count = sum(
                1 for p in plugin_host.plugins.values()
                if p.metadata.enabled
            )

            health_status["checks"]["plugins"] = {
                "status": "healthy",
                "total": plugin_count,
                "enabled": enabled_count
            }

        except Exception as e:
            logger.error("Plugin health check failed", exc_info=True)
            health_status["checks"]["plugins"] = {
                "status": "unhealthy",
                "error": str(e)
            }

        logger.info("System health check completed",
                   status=health_status["status"],
                   checks=len(health_status["checks"]))

        # 记录任务结果
        update_task_result(
            task_name="ef.core.system_health_check",
            records_processed=len(health_status["checks"]),
            records_updated=0,
            extra_data={
                "status": health_status["status"],
                "checks": {k: v.get("status") for k, v in health_status["checks"].items()}
            }
        )

        return health_status

    except Exception as e:
        record_task_error(
            task_name="ef.core.system_health_check",
            error_message=str(e)
        )
        raise


@retry_task(max_retries=3, countdown=300, name="ef.core.cleanup_expired_data")
async def cleanup_expired_data(older_than_days: int = 7) -> Dict[str, Any]:
    """清理过期数据"""
    from ef_core.tasks.task_logger import update_task_result, record_task_error

    try:
        logger.info(f"Starting cleanup of data older than {older_than_days} days")

        cutoff_date = datetime.utcnow() - timedelta(days=older_than_days)
        cleanup_results = {
            "cutoff_date": cutoff_date.isoformat() + "Z",
            "cleaned": {}
        }

        # TODO: 实现清理逻辑
        # 当需要执行数据库操作时，使用独立引擎避免事件循环冲突：
        # from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
        # from ef_core.config import get_settings
        # settings = get_settings()
        # temp_engine = create_async_engine(settings.database_url, pool_size=1, max_overflow=0)
        # try:
        #     async_session = async_sessionmaker(temp_engine, expire_on_commit=False)
        #     async with async_session() as session:
        #         # 执行清理操作
        #         pass
        # finally:
        #     await temp_engine.dispose()

        logger.info("Data cleanup completed (no-op)", results=cleanup_results)

        # 记录任务结果
        update_task_result(
            task_name="ef.core.cleanup_expired_data",
            records_processed=0,
            records_updated=0,
            extra_data={
                "cutoff_date": cutoff_date.isoformat(),
                "status": "no_op",
                "message": "Cleanup not yet implemented"
            }
        )

        return cleanup_results

    except Exception as e:
        record_task_error(
            task_name="ef.core.cleanup_expired_data",
            error_message=str(e)
        )
        raise


@task_with_context(bind=False, name="ef.core.metrics_collection")
async def collect_system_metrics() -> Dict[str, Any]:
    """收集系统指标"""
    from ef_core.tasks.task_logger import update_task_result, record_task_error

    logger.info("Collecting system metrics")

    metrics = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "system": {},
        "plugins": {},
        "tasks": {}
    }

    try:
        # TODO: 收集数据库指标（连接池状态、慢查询等）
        # 如需数据库操作，使用独立引擎避免事件循环冲突

        # 收集插件指标
        from ef_core.plugin_host import get_plugin_host
        plugin_host = get_plugin_host()

        for plugin_name, plugin in plugin_host.plugins.items():
            metrics["plugins"][plugin_name] = {
                "enabled": plugin.metadata.enabled,
                "version": plugin.metadata.version,
                "capabilities": plugin.metadata.capabilities
            }

        # 收集任务指标
        from .registry import get_task_registry
        task_registry = get_task_registry()

        for task_name, task_info in task_registry.registered_tasks.items():
            metrics["tasks"][task_name] = {
                "enabled": task_info["enabled"],
                "plugin": task_info["plugin"]
            }

        logger.info("System metrics collected",
                   plugins=len(metrics["plugins"]),
                   tasks=len(metrics["tasks"]))

        # 记录任务结果
        update_task_result(
            task_name="ef.core.metrics_collection",
            records_processed=len(metrics["plugins"]) + len(metrics["tasks"]),
            records_updated=0,
            extra_data={
                "plugins_count": len(metrics["plugins"]),
                "tasks_count": len(metrics["tasks"])
            }
        )

        return metrics

    except Exception as e:
        logger.error("Metrics collection failed", exc_info=True)
        record_task_error(
            task_name="ef.core.metrics_collection",
            error_message=str(e)
        )
        raise


@task_with_context(bind=False, name="ef.core.event_bus_maintenance")
async def event_bus_maintenance() -> Dict[str, Any]:
    """事件总线维护任务"""
    from ef_core.tasks.task_logger import update_task_result, record_task_error

    logger.info("Starting event bus maintenance")

    maintenance_results = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "actions": []
    }

    try:
        event_bus = get_event_bus()

        # TODO: 清理死信队列
        # TODO: 重试失败的消息
        # TODO: 清理过期的消费者

        maintenance_results["actions"].append("cleanup_dead_letters")

        logger.info("Event bus maintenance completed",
                   actions=len(maintenance_results["actions"]))

        # 记录任务结果
        update_task_result(
            task_name="ef.core.event_bus_maintenance",
            records_processed=len(maintenance_results["actions"]),
            records_updated=0,
            extra_data={
                "actions": maintenance_results["actions"],
                "status": "no_op",
                "message": "Maintenance not yet implemented"
            }
        )

        return maintenance_results

    except Exception as e:
        logger.error("Event bus maintenance failed", exc_info=True)
        record_task_error(
            task_name="ef.core.event_bus_maintenance",
            error_message=str(e)
        )
        raise


# 注册定时任务到 Celery Beat
def register_core_tasks():
    """注册核心系统任务"""
    from .celery_app import celery_app
    from celery.schedules import crontab
    
    # 更新 beat_schedule
    celery_app.conf.beat_schedule.update({
        "system-health-check": {
            "task": "ef.core.system_health_check",
            "schedule": crontab(minute="*/5"),  # 每5分钟
            "options": {"queue": "ef_core"}
        },
        
        "cleanup-expired-data": {
            "task": "ef.core.cleanup_expired_data",
            "schedule": crontab(hour="3", minute="0"),  # 每天凌晨3点
            "options": {"queue": "ef_core"}
        },
        
        "collect-system-metrics": {
            "task": "ef.core.metrics_collection", 
            "schedule": crontab(minute="*/10"),  # 每10分钟
            "options": {"queue": "ef_core"}
        },
        
        "event-bus-maintenance": {
            "task": "ef.core.event_bus_maintenance",
            "schedule": crontab(hour="1", minute="30"),  # 每天凌晨1:30
            "options": {"queue": "ef_core"}
        }
    })


# 在模块加载时注册任务
register_core_tasks()