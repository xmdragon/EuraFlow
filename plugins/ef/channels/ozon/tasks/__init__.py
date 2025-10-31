"""
Ozon 插件定时任务
"""

from .promotion_sync_task import (
    sync_all_promotions,
    promotion_health_check
)

from .label_download_task import (
    download_label_pdf_task
)

from .batch_sync_task import (
    batch_sync_category_attributes_task
)

from .scheduled_sync_task import (
    scheduled_category_sync,
    scheduled_attributes_sync
)

from .batch_stock_update_task import (
    batch_update_stocks_task
)

from .batch_price_update_task import (
    batch_update_prices_task
)

__all__ = [
    "sync_all_promotions",
    "promotion_health_check",
    "download_label_pdf_task",
    "batch_sync_category_attributes_task",
    "scheduled_category_sync",
    "scheduled_attributes_sync",
    "batch_update_stocks_task",
    "batch_update_prices_task",
]
