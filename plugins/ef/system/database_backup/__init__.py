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

    # 注册 Celery Beat 定时任务
    # 注意：不再在初始化时读取数据库配置，使用固定的默认 cron
    # 配置通过 Web UI 修改后由 Celery Beat 动态加载
    async def database_backup_task(**kwargs):
        """Celery Beat 定时任务：数据库备份"""
        from ef_core.tasks.task_logger import update_task_result, record_task_error

        try:
            result = await backup_service.backup_database({})

            if result.get("success"):
                data = result.get("data", {})
                update_task_result(
                    task_name="ef.system.database_backup",
                    records_processed=1,
                    records_updated=1 if data.get("s3_uploaded") else 0,
                    extra_data={
                        "backup_file": data.get("backup_file"),
                        "file_size_mb": data.get("file_size_mb"),
                        "s3_uploaded": data.get("s3_uploaded")
                    }
                )
            else:
                record_task_error(
                    task_name="ef.system.database_backup",
                    error_message=result.get("message", "Unknown error"),
                    extra_data={"error_code": result.get("error")}
                )

            return result
        except Exception as e:
            record_task_error(
                task_name="ef.system.database_backup",
                error_message=str(e)
            )
            raise

    await hooks.register_cron(
        name="ef.system.database_backup",
        cron="0 5,17 * * *",
        task=database_backup_task,
        display_name="数据库备份",
        description="自动备份 PostgreSQL 数据库"
    )

    logger.info("✓ Registered Celery Beat task: ef.system.database_backup")
    logger.info("  - Schedule: 0 5,17 * * * (UTC) = 13:00,01:00 (Beijing)")


async def teardown() -> None:
    """插件清理函数"""
    logger.info("Database backup plugin shutting down...")
