"""
Ozon 插件定时任务
"""

from .promotion_sync_task import (
    sync_all_promotions,
    promotion_health_check
)

__all__ = [
    "sync_all_promotions",
    "promotion_health_check",
]
