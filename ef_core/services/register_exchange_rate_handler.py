"""
汇率服务Handler注册
"""
import logging

logger = logging.getLogger(__name__)


def register_exchange_rate_handler():
    """注册汇率刷新服务handler到全局注册表"""
    try:
        from plugins.ef.system.sync_service.services.handler_registry import get_registry
        from .exchange_rate_service import ExchangeRateService

        registry = get_registry()
        service = ExchangeRateService()

        registry.register(
            service_key="exchange_rate_refresh",
            handler=service.refresh_rates,
            name="汇率刷新",
            description="定期从exchangerate-api获取CNY->RUB最新汇率并缓存（每30分钟执行一次）",
            plugin="ef.core",
            config_schema={}
        )

        logger.info("✓ Registered exchange_rate_refresh sync service handler")

    except Exception as e:
        logger.warning(f"Failed to register exchange_rate handler: {e}", exc_info=True)


# 模块级别调用 - import时自动执行
register_exchange_rate_handler()
