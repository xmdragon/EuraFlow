"""
EuraFlow 财务计算插件
提供利润计算和运费计算功能
"""

from typing import Any
import logging
logger = logging.getLogger(__name__)

__version__ = "1.0.0"


async def _get_task_schedule(db_session, service_key: str, default_cron: str) -> tuple[str | None, bool]:
    """从数据库获取任务调度配置"""
    try:
        from plugins.ef.system.sync_service.models.sync_service import SyncService
        from sqlalchemy import select

        result = await db_session.execute(
            select(SyncService).where(SyncService.service_key == service_key)
        )
        service = result.scalar_one_or_none()

        if not service:
            logger.info(f"Task {service_key} not found in sync_services, using default: {default_cron}")
            return default_cron, True

        if not service.is_enabled:
            logger.info(f"Task {service_key} is disabled in database, skipping registration")
            return None, False

        # 转换interval类型为cron表达式
        if service.service_type == "interval":
            interval_seconds = int(service.schedule_config)
            interval_minutes = interval_seconds // 60
            if interval_minutes < 60:
                cron = f"*/{interval_minutes} * * * *"
            else:
                interval_hours = interval_minutes // 60
                cron = f"0 */{interval_hours} * * *"
            logger.info(f"Task {service_key}: converted interval {interval_seconds}s to cron '{cron}'")
            return cron, True
        else:
            logger.info(f"Task {service_key}: using cron from database '{service.schedule_config}'")
            return service.schedule_config, True

    except Exception as e:
        logger.warning(f"Failed to load schedule for {service_key} from database: {e}, using default")
        return default_cron, True


async def setup(hooks: Any) -> None:
    """
    插件初始化函数

    Args:
        hooks: 插件Hook API接口
    """
    logger.info(f"Finance Calc Plugin v{__version__} initialized")

    # 注册定时任务：定期更新费率缓存
    # 注意：不再在初始化时读取数据库配置，使用固定的默认 cron
    await hooks.register_cron(
        name="ef.finance.rates.refresh",
        cron="18 * * * *",
        task=refresh_rates_cache,
        display_name="汇率刷新",
        description="定期刷新货币汇率缓存"
    )


async def refresh_rates_cache(**kwargs) -> None:
    """刷新费率缓存"""
    # TODO: 实现费率缓存刷新逻辑
    pass
