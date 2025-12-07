"""
任务日志记录工具

提供便捷的方法在任务函数中记录执行结果到 sync_service_logs 表
"""
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


def update_task_result(
    task_name: str,
    records_processed: int = 0,
    records_updated: int = 0,
    extra_data: Optional[Dict[str, Any]] = None
) -> None:
    """
    更新当前任务的执行结果

    在任务函数末尾调用，补充 Celery 信号处理器未记录的业务数据。
    此函数会查找当前正在运行的日志记录并更新。

    Args:
        task_name: Celery 任务名（如 ef.ozon.orders.pull）
        records_processed: 处理的记录数
        records_updated: 更新的记录数
        extra_data: 额外的业务数据（如 shops_processed, orders_synced 等）

    Example:
        ```python
        async def pull_orders_task(**kwargs):
            orders_synced = 0
            shops_processed = 0
            # ... 业务逻辑 ...

            # 任务末尾记录结果
            update_task_result(
                task_name="ef.ozon.orders.pull",
                records_processed=orders_synced,
                records_updated=orders_synced,
                extra_data={"shops_processed": shops_processed}
            )
        ```
    """
    try:
        from sqlalchemy import create_engine, select, desc
        from sqlalchemy.orm import sessionmaker
        from ef_core.config import get_settings
        from plugins.ef.system.sync_service.models.sync_service import SyncService
        from plugins.ef.system.sync_service.models.sync_service_log import SyncServiceLog

        settings = get_settings()
        sync_db_url = settings.database_url.replace('+asyncpg', '')
        engine = create_engine(sync_db_url, pool_pre_ping=True, pool_recycle=3600)
        SessionLocal = sessionmaker(bind=engine)

        with SessionLocal() as db:
            # 查找服务
            stmt = select(SyncService).where(SyncService.celery_task_name == task_name)
            service = db.execute(stmt).scalar_one_or_none()

            if not service:
                logger.debug(f"Service not found for task: {task_name}")
                return

            # 查找最近的 running 状态的日志记录
            log_stmt = (
                select(SyncServiceLog)
                .where(
                    SyncServiceLog.service_key == service.service_key,
                    SyncServiceLog.status == "running"
                )
                .order_by(desc(SyncServiceLog.started_at))
                .limit(1)
            )
            log = db.execute(log_stmt).scalar_one_or_none()

            if log:
                # 更新日志记录
                log.records_processed = records_processed
                log.records_updated = records_updated
                if extra_data:
                    # 合并 extra_data
                    existing_extra = log.extra_data or {}
                    existing_extra.update(extra_data)
                    log.extra_data = existing_extra

                db.commit()
                logger.debug(
                    f"Updated task result: {task_name}, "
                    f"processed={records_processed}, updated={records_updated}"
                )
            else:
                logger.debug(f"No running log found for task: {task_name}")

    except Exception as e:
        logger.error(f"Failed to update task result for {task_name}: {e}", exc_info=True)


def record_task_error(
    task_name: str,
    error_message: str,
    records_processed: int = 0,
    extra_data: Optional[Dict[str, Any]] = None
) -> None:
    """
    记录任务执行错误

    当任务在业务逻辑中捕获到错误但不想中断执行时使用。
    此函数会更新日志记录但不会改变任务状态。

    Args:
        task_name: Celery 任务名
        error_message: 错误信息
        records_processed: 已处理的记录数
        extra_data: 额外的业务数据

    Example:
        ```python
        async def sync_task(**kwargs):
            errors = []
            processed = 0
            for item in items:
                try:
                    await process(item)
                    processed += 1
                except Exception as e:
                    errors.append(str(e))

            if errors:
                record_task_error(
                    task_name="ef.xxx.sync",
                    error_message=f"部分失败: {len(errors)} 个错误",
                    records_processed=processed,
                    extra_data={"errors": errors[:5]}  # 只保留前5个错误
                )
        ```
    """
    try:
        from sqlalchemy import create_engine, select, desc
        from sqlalchemy.orm import sessionmaker
        from ef_core.config import get_settings
        from plugins.ef.system.sync_service.models.sync_service import SyncService
        from plugins.ef.system.sync_service.models.sync_service_log import SyncServiceLog

        settings = get_settings()
        sync_db_url = settings.database_url.replace('+asyncpg', '')
        engine = create_engine(sync_db_url, pool_pre_ping=True, pool_recycle=3600)
        SessionLocal = sessionmaker(bind=engine)

        with SessionLocal() as db:
            # 查找服务
            stmt = select(SyncService).where(SyncService.celery_task_name == task_name)
            service = db.execute(stmt).scalar_one_or_none()

            if not service:
                logger.debug(f"Service not found for task: {task_name}")
                return

            # 查找最近的日志记录
            log_stmt = (
                select(SyncServiceLog)
                .where(SyncServiceLog.service_key == service.service_key)
                .order_by(desc(SyncServiceLog.started_at))
                .limit(1)
            )
            log = db.execute(log_stmt).scalar_one_or_none()

            if log:
                log.records_processed = records_processed
                if error_message:
                    log.error_message = error_message[:2000]  # 截断过长的错误信息
                if extra_data:
                    existing_extra = log.extra_data or {}
                    existing_extra.update(extra_data)
                    log.extra_data = existing_extra

                db.commit()
                logger.debug(f"Recorded task error: {task_name}, error={error_message[:100]}")
            else:
                logger.debug(f"No log found for task: {task_name}")

    except Exception as e:
        logger.error(f"Failed to record task error for {task_name}: {e}", exc_info=True)
