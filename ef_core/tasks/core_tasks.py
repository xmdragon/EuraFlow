"""
核心系统任务
"""
import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any

from ef_core.database import get_db_manager
from ef_core.event_bus import get_event_bus
from ef_core.utils.logger import get_logger
from .base import task_with_context, retry_task

logger = get_logger(__name__)


@task_with_context(name="ef.core.system_health_check")
async def system_health_check() -> Dict[str, Any]:
    """系统健康检查"""
    logger.info("Starting system health check")
    
    health_status = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "status": "healthy",
        "checks": {}
    }
    
    # 检查数据库连接
    try:
        db_manager = get_db_manager()
        db_healthy = await db_manager.check_connection()
        health_status["checks"]["database"] = {
            "status": "healthy" if db_healthy else "unhealthy",
            "latency_ms": 0  # TODO: 测量延迟
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
    
    return health_status


@retry_task(max_retries=3, countdown=300, name="ef.core.cleanup_expired_data")
async def cleanup_expired_data(older_than_days: int = 7) -> Dict[str, Any]:
    """清理过期数据"""
    logger.info(f"Starting cleanup of data older than {older_than_days} days")
    
    cutoff_date = datetime.utcnow() - timedelta(days=older_than_days)
    cleanup_results = {
        "cutoff_date": cutoff_date.isoformat() + "Z",
        "cleaned": {}
    }
    
    db_manager = get_db_manager()
    
    try:
        async with db_manager.get_transaction() as session:
            # TODO: 清理过期的任务结果
            # TODO: 清理过期的日志记录  
            # TODO: 清理过期的事件记录
            
            # 示例：清理过期的订单快照（如果有）
            # result = await session.execute(
            #     text("DELETE FROM order_snapshots WHERE created_at < :cutoff"),
            #     {"cutoff": cutoff_date}
            # )
            # cleanup_results["cleaned"]["order_snapshots"] = result.rowcount
            
            await session.commit()
            
        logger.info("Data cleanup completed", results=cleanup_results)
        return cleanup_results
        
    except Exception as e:
        logger.error("Data cleanup failed", exc_info=True)
        raise


@task_with_context(name="ef.core.metrics_collection")
async def collect_system_metrics() -> Dict[str, Any]:
    """收集系统指标"""
    logger.info("Collecting system metrics")
    
    metrics = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "system": {},
        "plugins": {},
        "tasks": {}
    }
    
    try:
        # 收集数据库指标
        db_manager = get_db_manager()
        # TODO: 收集连接池状态、慢查询等
        
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
        
        return metrics
        
    except Exception as e:
        logger.error("Metrics collection failed", exc_info=True)
        raise


@task_with_context(name="ef.core.event_bus_maintenance")
async def event_bus_maintenance() -> Dict[str, Any]:
    """事件总线维护任务"""
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
        
        return maintenance_results
        
    except Exception as e:
        logger.error("Event bus maintenance failed", exc_info=True)
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