"""
EuraFlow 财务计算插件
提供利润计算和运费计算功能
"""

from typing import Any
import logging
logger = logging.getLogger(__name__)

__version__ = "1.0.0"


async def setup(hooks: Any) -> None:
    """
    插件初始化函数

    Args:
        hooks: 插件Hook API接口
    """
    # 插件启动时的初始化逻辑
    logger.info(f"Finance Calc Plugin v{__version__} initialized")

    # 注册定时任务：定期更新费率缓存
    await hooks.register_cron(
        name="ef.finance.rates.refresh", cron="0 */6 * * *", task=refresh_rates_cache  # 每6小时刷新
    )


async def refresh_rates_cache(**kwargs) -> None:
    """刷新费率缓存"""
    # TODO: 实现费率缓存刷新逻辑
    pass
