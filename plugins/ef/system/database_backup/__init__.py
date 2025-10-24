"""
EuraFlow 数据库备份插件

提供自动化数据库备份功能
"""
from typing import Optional
from fastapi import APIRouter

__version__ = "1.0.0"


def get_router() -> Optional[APIRouter]:
    """获取插件的 API 路由"""
    return None  # 此插件不提供API路由


async def setup(hooks) -> None:
    """
    插件初始化函数
    注册数据库备份服务到同步服务管理系统
    """
    print("Database backup plugin initializing...")
    print(f"Version: {__version__}")

    # 获取同步服务注册器
    from ef_core.services.sync_service_registry import SyncServiceRegistry
    registry = SyncServiceRegistry()

    # 导入备份服务
    from .backup_service import DatabaseBackupService
    backup_service = DatabaseBackupService()

    # 注册备份服务
    # 时间：UTC 17:00 和 05:00（北京时间 01:00 和 13:00）
    registry.register(
        service_key="database_backup_daily",
        handler=backup_service.backup_database,
        name="数据库自动备份",
        description="每天北京时间1点和13点自动备份PostgreSQL数据库到backups目录",
        plugin="ef.system.database_backup",
        service_type="cron",
        schedule_config="0 17,5 * * *",  # UTC时间
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

    print("✓ Registered database backup sync service handler")
    print(f"  - Service: database_backup_daily")
    print(f"  - Schedule: 0 17,5 * * * (UTC) = 01:00,13:00 (Beijing)")


async def teardown() -> None:
    """插件清理函数"""
    print("Database backup plugin shutting down...")
