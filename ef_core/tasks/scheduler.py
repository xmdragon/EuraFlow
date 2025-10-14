"""
任务调度器 - 基于APScheduler
统一管理所有后台同步任务
"""
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional, Dict, Callable, Any
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.jobstores.base import JobLookupError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.sync_service import SyncService

logger = logging.getLogger(__name__)


class TaskScheduler:
    """任务调度器 - 管理所有后台同步任务"""

    def __init__(self):
        """初始化调度器"""
        self.scheduler = AsyncIOScheduler(
            timezone='UTC',
            job_defaults={
                'coalesce': True,  # 合并多个pending的相同任务
                'max_instances': 1,  # 同一任务不并发执行
                'misfire_grace_time': 300  # 允许延迟5分钟
            }
        )
        self.registered_handlers: Dict[str, Callable] = {}
        self._running_jobs: set = set()  # 正在运行的任务

    def register_handler(self, service_key: str, handler: Callable):
        """
        注册服务处理函数

        Args:
            service_key: 服务唯一标识
            handler: 异步处理函数
        """
        self.registered_handlers[service_key] = handler
        logger.info(f"Registered handler for service: {service_key}")

    async def start(self):
        """启动调度器并加载所有已启用的服务"""
        logger.info("Starting task scheduler...")

        # 启动调度器
        self.scheduler.start()

        # 从数据库加载已启用的服务
        await self.load_services_from_database()

        logger.info("Task scheduler started successfully")

    async def shutdown(self):
        """关闭调度器"""
        logger.info("Shutting down task scheduler...")

        # 等待正在执行的任务完成（最多等待30秒）
        if self._running_jobs:
            logger.info(f"Waiting for {len(self._running_jobs)} running jobs to complete...")
            try:
                await asyncio.wait_for(
                    asyncio.gather(*[self._wait_for_job(job_id) for job_id in list(self._running_jobs)]),
                    timeout=30
                )
            except asyncio.TimeoutError:
                logger.warning("Timeout waiting for jobs to complete, shutting down anyway")

        # 关闭调度器
        self.scheduler.shutdown(wait=True)

        logger.info("Task scheduler shut down successfully")

    async def _wait_for_job(self, job_id: str):
        """等待任务完成"""
        while job_id in self._running_jobs:
            await asyncio.sleep(0.5)

    async def load_services_from_database(self):
        """从数据库加载所有已启用的服务"""
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            # 查询所有已启用的服务
            result = await session.execute(
                select(SyncService).where(SyncService.is_enabled == True)
            )
            services = result.scalars().all()

            logger.info(f"Loading {len(services)} enabled services from database")

            for service in services:
                try:
                    await self.add_service(
                        service_key=service.service_key,
                        service_type=service.service_type,
                        schedule_config=service.schedule_config,
                        config_json=service.config_json or {}
                    )
                except Exception as e:
                    logger.error(f"Failed to add service {service.service_key}: {e}")

    async def add_service(
        self,
        service_key: str,
        service_type: str,
        schedule_config: str,
        config_json: Dict[str, Any] = None
    ):
        """
        添加服务到调度器

        Args:
            service_key: 服务唯一标识
            service_type: 调度类型 (cron | interval)
            schedule_config: 调度配置（cron表达式或间隔秒数）
            config_json: 服务特定配置
        """
        # 检查是否已注册处理函数
        if service_key not in self.registered_handlers:
            logger.warning(f"No handler registered for service: {service_key}, skipping")
            return

        handler = self.registered_handlers[service_key]

        # 创建任务包装器（记录日志、更新统计）
        async def job_wrapper():
            if service_key in self._running_jobs:
                logger.warning(f"Service {service_key} is already running, skipping this execution")
                return

            self._running_jobs.add(service_key)
            run_id = f"{service_key}_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
            started_at = datetime.now(timezone.utc)

            logger.info(f"[{run_id}] Starting service execution: {service_key}")

            try:
                # 执行服务处理函数
                result = await handler(config_json or {})

                # 记录成功日志
                await self._log_execution(
                    service_key=service_key,
                    run_id=run_id,
                    started_at=started_at,
                    status="success",
                    result=result
                )

                logger.info(f"[{run_id}] Service executed successfully: {service_key}")

            except Exception as e:
                # 记录失败日志
                await self._log_execution(
                    service_key=service_key,
                    run_id=run_id,
                    started_at=started_at,
                    status="failed",
                    error=str(e)
                )

                logger.error(f"[{run_id}] Service execution failed: {service_key}, error: {e}", exc_info=True)

            finally:
                self._running_jobs.discard(service_key)

        # 构建触发器
        if service_type == "cron":
            # Cron表达式
            trigger = CronTrigger.from_crontab(schedule_config, timezone='UTC')
        elif service_type == "interval":
            # 间隔秒数
            seconds = int(schedule_config)
            trigger = IntervalTrigger(seconds=seconds, timezone='UTC')
        else:
            raise ValueError(f"Unknown service_type: {service_type}")

        # 添加到调度器
        self.scheduler.add_job(
            job_wrapper,
            trigger=trigger,
            id=service_key,
            name=service_key,
            replace_existing=True
        )

        logger.info(f"Service added to scheduler: {service_key}, type={service_type}, config={schedule_config}")

    async def remove_service(self, service_key: str):
        """
        从调度器移除服务

        Args:
            service_key: 服务唯一标识
        """
        try:
            self.scheduler.remove_job(service_key)
            logger.info(f"Service removed from scheduler: {service_key}")
        except JobLookupError:
            logger.warning(f"Service not found in scheduler: {service_key}")

    async def pause_service(self, service_key: str):
        """
        暂停服务

        Args:
            service_key: 服务唯一标识
        """
        try:
            self.scheduler.pause_job(service_key)
            logger.info(f"Service paused: {service_key}")
        except JobLookupError:
            logger.warning(f"Service not found in scheduler: {service_key}")

    async def resume_service(self, service_key: str):
        """
        恢复服务

        Args:
            service_key: 服务唯一标识
        """
        try:
            self.scheduler.resume_job(service_key)
            logger.info(f"Service resumed: {service_key}")
        except JobLookupError:
            logger.warning(f"Service not found in scheduler: {service_key}")

    async def trigger_service_now(self, service_key: str, config_json: Dict[str, Any] = None):
        """
        立即触发服务执行（不等待调度时间）

        Args:
            service_key: 服务唯一标识
            config_json: 服务特定配置
        """
        if service_key not in self.registered_handlers:
            raise ValueError(f"No handler registered for service: {service_key}")

        handler = self.registered_handlers[service_key]

        # 异步执行（不阻塞）
        asyncio.create_task(self._execute_manual_trigger(service_key, handler, config_json))

        logger.info(f"Service manually triggered: {service_key}")

    async def _execute_manual_trigger(
        self,
        service_key: str,
        handler: Callable,
        config_json: Dict[str, Any]
    ):
        """执行手动触发的任务"""
        run_id = f"{service_key}_manual_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
        started_at = datetime.now(timezone.utc)

        try:
            result = await handler(config_json or {})

            await self._log_execution(
                service_key=service_key,
                run_id=run_id,
                started_at=started_at,
                status="success",
                result=result
            )

        except Exception as e:
            await self._log_execution(
                service_key=service_key,
                run_id=run_id,
                started_at=started_at,
                status="failed",
                error=str(e)
            )

            logger.error(f"Manual trigger failed: {service_key}, error: {e}", exc_info=True)

    async def _log_execution(
        self,
        service_key: str,
        run_id: str,
        started_at: datetime,
        status: str,
        result: Optional[Dict] = None,
        error: Optional[str] = None
    ):
        """更新服务统计（不创建汇总日志，服务自己会创建详细日志）"""
        from plugins.ef.channels.ozon.models.sync_service import SyncServiceLog

        finished_at = datetime.now(timezone.utc)
        execution_time_ms = int((finished_at - started_at).total_seconds() * 1000)

        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            # 注意：不再创建汇总日志记录，因为各个服务会自己创建详细的日志
            # 这样可以避免汇总日志和详细日志混合显示的问题
            # 例如 kuajing84_material_cost 服务会为每个 posting 创建独立的日志记录

            # 更新服务统计
            service_result = await session.execute(
                select(SyncService).where(SyncService.service_key == service_key)
            )
            service = service_result.scalar_one_or_none()

            if service:
                service.last_run_at = finished_at
                service.last_run_status = status
                service.last_run_message = result.get("message", "") if result else (error[:500] if error else "")
                service.run_count += 1

                if status == "success":
                    service.success_count += 1
                elif status == "failed":
                    service.error_count += 1

            await session.commit()


# 全局单例
_scheduler_instance: Optional[TaskScheduler] = None


def get_scheduler() -> TaskScheduler:
    """获取调度器实例"""
    global _scheduler_instance
    if _scheduler_instance is None:
        _scheduler_instance = TaskScheduler()
    return _scheduler_instance
