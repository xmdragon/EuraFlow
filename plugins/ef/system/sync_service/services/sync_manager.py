"""
同步服务管理器

负责服务的CRUD管理、调度配置验证、日志清理等
"""
import logging
from datetime import datetime
from typing import Optional, Dict, Any, Tuple
from croniter import croniter
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.tasks.scheduler import get_scheduler
from .handler_registry import get_registry


logger = logging.getLogger(__name__)


class SyncServiceManager:
    """同步服务管理器"""

    def __init__(self, db: AsyncSession):
        """
        初始化管理器

        Args:
            db: 数据库会话
        """
        self.db = db
        self.scheduler = get_scheduler()
        self.registry = get_registry()

    @staticmethod
    def validate_cron_expression(expression: str) -> bool:
        """
        验证Cron表达式合法性

        Args:
            expression: Cron表达式

        Returns:
            是否合法
        """
        try:
            croniter(expression)
            return True
        except (ValueError, KeyError):
            return False

    @staticmethod
    def validate_interval_seconds(seconds_str: str) -> bool:
        """
        验证间隔秒数合法性

        Args:
            seconds_str: 秒数字符串

        Returns:
            是否合法（正整数）
        """
        try:
            seconds = int(seconds_str)
            return seconds > 0
        except (ValueError, TypeError):
            return False

    def validate_schedule_config(
        self,
        service_type: str,
        schedule_config: str
    ) -> Tuple[bool, Optional[str]]:
        """
        验证调度配置

        Args:
            service_type: 调度类型 (cron | interval)
            schedule_config: 调度配置

        Returns:
            (是否合法, 错误信息)
        """
        if service_type == "cron":
            if not self.validate_cron_expression(schedule_config):
                return False, "Invalid cron expression"
        elif service_type == "interval":
            if not self.validate_interval_seconds(schedule_config):
                return False, "Invalid interval seconds (must be positive integer)"
        else:
            return False, f"Unknown service_type: {service_type}"

        return True, None

    async def create_service(
        self,
        service_key: str,
        service_name: str,
        service_description: str,
        service_type: str,
        schedule_config: str,
        is_enabled: bool = True,
        config_json: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        创建服务

        Args:
            service_key: 服务唯一标识
            service_name: 服务显示名称
            service_description: 服务功能说明
            service_type: 调度类型
            schedule_config: 调度配置
            is_enabled: 是否启用
            config_json: 服务特定配置

        Returns:
            (是否成功, 错误信息)
        """
        # 1. 验证service_key是否已注册Handler
        if not self.registry.exists(service_key):
            return False, f"No handler registered for service: {service_key}"

        # 2. 验证调度配置
        valid, error = self.validate_schedule_config(service_type, schedule_config)
        if not valid:
            return False, error

        # 3. 检查service_key是否重复（数据库层面）
        from ..models.sync_service import SyncService
        result = await self.db.execute(
            select(SyncService).where(SyncService.service_key == service_key)
        )
        if result.scalar_one_or_none():
            return False, f"Service key already exists: {service_key}"

        # 4. 创建服务记录
        service = SyncService(
            service_key=service_key,
            service_name=service_name,
            service_description=service_description,
            service_type=service_type,
            schedule_config=schedule_config,
            is_enabled=is_enabled,
            config_json=config_json or {}
        )
        self.db.add(service)
        await self.db.commit()

        # 5. 如果启用，添加到调度器
        if is_enabled:
            await self.scheduler.add_service(
                service_key=service_key,
                service_type=service_type,
                schedule_config=schedule_config,
                config_json=config_json or {}
            )
            logger.info(f"Service added to scheduler: {service_key}")

        return True, None

    async def update_service(
        self,
        service_id: int,
        service_name: Optional[str] = None,
        service_description: Optional[str] = None,
        service_type: Optional[str] = None,
        schedule_config: Optional[str] = None,
        is_enabled: Optional[bool] = None,
        config_json: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        更新服务配置

        Args:
            service_id: 服务ID
            service_name: 服务显示名称
            service_description: 服务功能说明
            service_type: 调度类型
            schedule_config: 调度配置
            is_enabled: 是否启用
            config_json: 服务特定配置

        Returns:
            (是否成功, 错误信息)
        """
        from ..models.sync_service import SyncService

        # 1. 查找服务
        result = await self.db.execute(
            select(SyncService).where(SyncService.id == service_id)
        )
        service = result.scalar_one_or_none()

        if not service:
            return False, f"Service not found: {service_id}"

        # 2. 验证调度配置（如果有更新）
        final_type = service_type if service_type is not None else service.service_type
        final_config = schedule_config if schedule_config is not None else service.schedule_config

        if service_type is not None or schedule_config is not None:
            valid, error = self.validate_schedule_config(final_type, final_config)
            if not valid:
                return False, error

        # 3. 更新字段
        if service_name is not None:
            service.service_name = service_name
        if service_description is not None:
            service.service_description = service_description
        if service_type is not None:
            service.service_type = service_type
        if schedule_config is not None:
            service.schedule_config = schedule_config
        if is_enabled is not None:
            service.is_enabled = is_enabled
        if config_json is not None:
            service.config_json = config_json

        await self.db.commit()

        # 4. 更新调度器
        try:
            # 先移除旧任务
            await self.scheduler.remove_service(service.service_key)

            # 如果启用，添加新任务
            if service.is_enabled:
                await self.scheduler.add_service(
                    service_key=service.service_key,
                    service_type=service.service_type,
                    schedule_config=service.schedule_config,
                    config_json=service.config_json or {}
                )
                logger.info(f"Service updated in scheduler: {service.service_key}")
        except Exception as e:
            logger.error(f"Failed to update service in scheduler: {e}")
            return False, f"Failed to update scheduler: {str(e)}"

        return True, None

    async def clear_logs(
        self,
        service_key: str,
        before_date: Optional[datetime] = None
    ) -> int:
        """
        清空服务日志

        Args:
            service_key: 服务唯一标识
            before_date: 清空此日期前的日志（None表示全部清空）

        Returns:
            删除的日志数量
        """
        from ..models.sync_service_log import SyncServiceLog

        query = delete(SyncServiceLog).where(
            SyncServiceLog.service_key == service_key
        )

        if before_date:
            query = query.where(SyncServiceLog.started_at < before_date)

        result = await self.db.execute(query)
        await self.db.commit()

        deleted_count = result.rowcount
        logger.info(
            f"Cleared {deleted_count} logs for service {service_key}"
            + (f" before {before_date}" if before_date else " (all)")
        )

        return deleted_count
