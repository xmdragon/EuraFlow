"""
同步服务管理器

统一管理定时任务的配置同步和日志记录
"""
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.sync_service import SyncService
from ..models.sync_service_log import SyncServiceLog

logger = logging.getLogger(__name__)


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class SyncServiceManager:
    """同步服务管理器 - 统一管理任务配置和日志"""

    @classmethod
    async def sync_from_registry(
        cls,
        db: AsyncSession,
        registered_tasks: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        从 TaskRegistry 同步到数据库

        策略：
        1. 遍历 registry 中的所有任务
        2. 如果数据库中不存在该 celery_task_name，则创建
        3. 如果存在但配置不同，更新（仅更新 source=code 的记录）
        4. 标记数据库中存在但 registry 中不存在的任务为 is_deleted=True

        Args:
            db: 数据库会话
            registered_tasks: TaskRegistry 中注册的任务字典

        Returns:
            同步结果统计
        """
        created = 0
        updated = 0
        deleted = 0

        # 获取所有现有服务
        result = await db.execute(select(SyncService))
        existing_services = {s.celery_task_name: s for s in result.scalars().all() if s.celery_task_name}

        # 获取所有现有 service_key
        all_services = await db.execute(select(SyncService))
        existing_keys = {s.service_key: s for s in all_services.scalars().all()}

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
                        logger.info(f"Updated sync service: {task_name}")
            elif service_key in existing_keys:
                # service_key 存在但没有 celery_task_name，更新它
                service = existing_keys[service_key]
                service.celery_task_name = task_name
                service.plugin_name = plugin
                service.source = "code"
                service.is_deleted = False
                if service.schedule_config != cron:
                    service.schedule_config = cron
                updated += 1
                logger.info(f"Linked existing service {service_key} to {task_name}")
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
                logger.info(f"Created sync service: {task_name}")

        # 标记已删除的任务
        for task_name, service in existing_services.items():
            if task_name not in registered_task_names and service.source == "code" and not service.is_deleted:
                service.is_deleted = True
                deleted += 1
                logger.info(f"Marked sync service as deleted: {task_name}")

        await db.commit()

        return {
            "created": created,
            "updated": updated,
            "deleted": deleted,
            "total_registered": len(registered_tasks)
        }

    @classmethod
    async def record_task_start(
        cls,
        db: AsyncSession,
        celery_task_name: str,
        task_id: str
    ) -> Optional[int]:
        """
        记录任务开始

        Args:
            db: 数据库会话
            celery_task_name: Celery 任务名
            task_id: 任务运行 ID

        Returns:
            log_id，用于后续更新；如果服务不存在返回 None
        """
        # 查找服务
        result = await db.execute(
            select(SyncService).where(SyncService.celery_task_name == celery_task_name)
        )
        service = result.scalar_one_or_none()

        if not service:
            logger.debug(f"Service not found for task: {celery_task_name}")
            return None

        # 更新服务状态
        service.last_run_at = utcnow()
        service.last_run_status = "running"

        # 创建日志记录
        log = SyncServiceLog(
            service_key=service.service_key,
            run_id=task_id,
            started_at=utcnow(),
            status="running",
        )
        db.add(log)
        await db.commit()
        await db.refresh(log)

        logger.debug(f"Task started: {celery_task_name}, log_id={log.id}")
        return log.id

    @classmethod
    async def record_task_end(
        cls,
        db: AsyncSession,
        log_id: int,
        success: bool,
        execution_time_ms: int,
        records_processed: int = 0,
        records_updated: int = 0,
        error_message: Optional[str] = None,
        extra_data: Optional[Dict] = None
    ) -> None:
        """
        记录任务结束

        Args:
            db: 数据库会话
            log_id: 日志记录 ID
            success: 是否成功
            execution_time_ms: 执行时间（毫秒）
            records_processed: 处理记录数
            records_updated: 更新记录数
            error_message: 错误信息
            extra_data: 额外数据
        """
        # 更新日志记录
        result = await db.execute(
            select(SyncServiceLog).where(SyncServiceLog.id == log_id)
        )
        log = result.scalar_one_or_none()

        if not log:
            logger.warning(f"Log not found: {log_id}")
            return

        log.finished_at = utcnow()
        log.status = "success" if success else "failed"
        log.execution_time_ms = execution_time_ms
        log.records_processed = records_processed
        log.records_updated = records_updated
        if error_message:
            log.error_message = error_message
        if extra_data:
            log.extra_data = extra_data

        # 更新服务统计
        service_result = await db.execute(
            select(SyncService).where(SyncService.service_key == log.service_key)
        )
        service = service_result.scalar_one_or_none()

        if service:
            service.run_count += 1
            if success:
                service.success_count += 1
                service.last_run_status = "success"
                service.last_run_message = f"处理 {records_processed} 条记录，更新 {records_updated} 条"
            else:
                service.error_count += 1
                service.last_run_status = "failed"
                service.last_run_message = error_message[:500] if error_message else "执行失败"

        await db.commit()
        logger.debug(f"Task ended: log_id={log_id}, success={success}")

    @classmethod
    async def get_service_by_task_name(
        cls,
        db: AsyncSession,
        celery_task_name: str
    ) -> Optional[SyncService]:
        """
        根据 Celery 任务名获取服务配置

        Args:
            db: 数据库会话
            celery_task_name: Celery 任务名

        Returns:
            服务配置，不存在返回 None
        """
        result = await db.execute(
            select(SyncService).where(
                SyncService.celery_task_name == celery_task_name,
                SyncService.is_deleted == False
            )
        )
        return result.scalar_one_or_none()

    @classmethod
    async def is_task_enabled(
        cls,
        db: AsyncSession,
        celery_task_name: str
    ) -> bool:
        """
        检查任务是否启用

        Args:
            db: 数据库会话
            celery_task_name: Celery 任务名

        Returns:
            是否启用，服务不存在时返回 True（默认启用）
        """
        service = await cls.get_service_by_task_name(db, celery_task_name)
        if service is None:
            return True  # 未注册的任务默认启用
        return service.is_enabled
