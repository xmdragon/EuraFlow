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

    # 任务1: 常规数据库备份（排除类目表）
    async def database_backup_task(**kwargs):
        """Celery Beat 定时任务：数据库备份（排除类目表）"""
        from ef_core.tasks.task_logger import update_task_result, record_task_error

        try:
            # 排除类目表（类目表单独备份）
            result = await backup_service.backup_database({}, exclude_catalog_tables=True)

            if result.get("success"):
                data = result.get("data", {})
                update_task_result(
                    task_name="ef.system.database_backup",
                    records_processed=1,
                    records_updated=1,
                    extra_data={
                        "backup_file": data.get("backup_file"),
                        "file_size_mb": data.get("file_size_mb"),
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
        description="自动备份 PostgreSQL 数据库（排除类目表）"
    )

    logger.info("✓ Registered Celery Beat task: ef.system.database_backup")
    logger.info("  - Schedule: 0 5,17 * * * (UTC) = 13:00,01:00 (Beijing)")
    logger.info("  - Excludes: ozon_categories, ozon_category_attributes, ozon_attribute_dictionary_values")

    # 任务2: 类目表备份（每周一，类目/特征同步后约1小时）
    # 类目同步: 21:00 UTC, 特征同步: 21:30 UTC
    # 类目表备份: 22:30 UTC（同步后约1小时）
    async def catalog_backup_task(**kwargs):
        """Celery Beat 定时任务：类目表备份"""
        from ef_core.tasks.task_logger import update_task_result, record_task_error

        try:
            result = await backup_service.backup_catalog_tables({})

            if result.get("success"):
                data = result.get("data", {})
                update_task_result(
                    task_name="ef.system.database_backup_catalog",
                    records_processed=len(data.get("tables", [])),
                    records_updated=1,
                    extra_data={
                        "backup_file": data.get("backup_file"),
                        "file_size_mb": data.get("file_size_mb"),
                        "tables": data.get("tables"),
                    }
                )
            else:
                record_task_error(
                    task_name="ef.system.database_backup_catalog",
                    error_message=result.get("message", "Unknown error"),
                    extra_data={"error_code": result.get("error")}
                )

            return result
        except Exception as e:
            record_task_error(
                task_name="ef.system.database_backup_catalog",
                error_message=str(e)
            )
            raise

    await hooks.register_cron(
        name="ef.system.database_backup_catalog",
        cron="30 22 * * 1",  # 每周一 22:30 UTC（类目/特征同步后约1小时）
        task=catalog_backup_task,
        display_name="类目表备份",
        description="备份类目、特征、字典表（每周一，同步后执行）"
    )

    logger.info("✓ Registered Celery Beat task: ef.system.database_backup_catalog")
    logger.info("  - Schedule: 30 22 * * 1 (UTC) = 每周一 22:30 UTC（北京时间周二 06:30）")
    logger.info("  - Tables: ozon_categories, ozon_category_attributes, ozon_attribute_dictionary_values")


async def teardown() -> None:
    """插件清理函数"""
    logger.info("Database backup plugin shutting down...")
