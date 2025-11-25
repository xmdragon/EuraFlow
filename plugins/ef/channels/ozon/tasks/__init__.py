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

from .label_prefetch_task import (
    prefetch_labels_task,
    cleanup_labels_task
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

from .batch_finance_sync_task import (
    batch_finance_sync_task
)

from .image_upload_task import (
    upload_xiangji_images_to_storage
)

from .quick_publish_task import (
    quick_publish_chain_task,
    create_product_by_sku_task,
    upload_images_to_storage_task,
    update_ozon_product_images_task,
    update_product_stock_task
)

from .stats_aggregation_task import (
    aggregate_daily_stats
)

__all__ = [
    "sync_all_promotions",
    "promotion_health_check",
    "download_label_pdf_task",
    "prefetch_labels_task",
    "cleanup_labels_task",
    "batch_sync_category_attributes_task",
    "scheduled_category_sync",
    "scheduled_attributes_sync",
    "batch_update_stocks_task",
    "batch_update_prices_task",
    "batch_finance_sync_task",
    "upload_xiangji_images_to_storage",
    "quick_publish_chain_task",
    "create_product_by_sku_task",
    "upload_images_to_storage_task",
    "update_ozon_product_images_task",
    "update_product_stock_task",
    "aggregate_daily_stats",
]
