"""
EuraFlow 数据库备份插件

提供自动化数据库备份功能
"""
from typing import Optional
import logging
logger = logging.getLogger(__name__)
from fastapi import APIRouter

__version__ = "1.0.0"


def get_router() -> Optional[APIRouter]:
    """获取插件的 API 路由"""
    from .routes import router
    return router


async def setup(hooks) -> None:
    """
    插件初始化函数
    注册数据库备份服务到同步服务管理系统
    """
    logger.info("Database backup plugin initializing...")
    logger.info(f"Version: {__version__}")

    # 获取同步服务注册器
    from plugins.ef.system.sync_service.services.handler_registry import get_registry
    registry = get_registry()

    # 导入备份服务
    from .backup_service import DatabaseBackupService
    backup_service = DatabaseBackupService()

    # 注册备份服务handler
    # 调度配置：建议在前端配置为 cron: "0 17,5 * * *" (UTC 17:00和05:00 = 北京时间 01:00和13:00)
    registry.register(
        service_key="database_backup",
        handler=backup_service.backup_database,
        name="数据库备份",
        description="备份PostgreSQL数据库到backups目录（建议配置为每天北京时间01:00和13:00执行，cron表达式: 0 17,5 * * *）",
        plugin="ef.system.database_backup",
        config_schema={
            "type": "object",
            "properties": {
                "max_backups": {
                    "type": "integer",
                    "description": "保留的最大备份数量",
                    "default": 30
                }
            }
        }
    )

    logger.info("✓ Registered database backup sync service handler")
    logger.info(f"  - Service: database_backup")
    logger.info(f"  - Recommended schedule: cron='0 5,17 * * *' (UTC) = 13:00,01:00 (Beijing)")

    # 注册 Celery Beat 定时任务（使用数据库配置）
    async def database_backup_task(**kwargs):
        """Celery Beat 定时任务：数据库备份"""
        return await backup_service.backup_database({})

    try:
        from ef_core.database import get_db_manager
        from plugins.ef.system.sync_service.models.sync_service import SyncService
        from sqlalchemy import select

        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            # 从数据库读取配置
            result = await db.execute(
                select(SyncService).where(SyncService.service_key == "database_backup")
            )
            service = result.scalar_one_or_none()

            if service and service.is_enabled:
                cron = service.schedule_config
                logger.info(f"Using database backup schedule from database: '{cron}'")
            else:
                cron = "0 5,17 * * *"  # 默认值
                logger.info(f"Using default database backup schedule: '{cron}'")

            await hooks.register_cron(
                name="ef.system.database_backup",
                cron=cron,
                task=database_backup_task
            )
    except Exception as e:
        logger.warning(f"Failed to load database backup schedule: {e}, using default")
        await hooks.register_cron(
            name="ef.system.database_backup",
            cron="0 5,17 * * *",
            task=database_backup_task
        )

    logger.info("✓ Registered Celery Beat task: ef.system.database_backup")
    logger.info(f"  - Schedule: 0 17,5 * * * (UTC) = 01:00,13:00 (Beijing)")


async def teardown() -> None:
    """插件清理函数"""
    logger.info("Database backup plugin shutting down...")
