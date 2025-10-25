"""Ozon 插件数据模型"""

from .ozon_shops import OzonShop
from .products import OzonProduct
from .orders import OzonOrder, OzonPosting, OzonOrderItem, OzonShipmentPackage, OzonRefund, OzonDomesticTracking
from .warehouses import OzonWarehouse
from .watermark import WatermarkConfig, CloudinaryConfig, WatermarkTask
from .product_selection import ProductSelectionItem, ImportHistory
from .chat import OzonChat, OzonChatMessage
from .kuajing84 import Kuajing84SyncLog
from .kuajing84_global_config import Kuajing84GlobalConfig
from .listing import (
    OzonCategory,
    OzonCategoryAttribute,
    OzonAttributeDictionaryValue,
    OzonMediaImportLog,
    OzonProductImportLog,
    OzonPriceUpdateLog,
    OzonStockUpdateLog,
)
from .finance import OzonFinanceTransaction, OzonFinanceSyncWatermark
from .promotion import OzonPromotionAction, OzonPromotionProduct

__all__ = [
    "OzonShop",
    "OzonProduct",
    "OzonOrder",
    "OzonPosting",
    "OzonOrderItem",
    "OzonShipmentPackage",
    "OzonRefund",
    "OzonDomesticTracking",
    "OzonWarehouse",
    "WatermarkConfig",
    "CloudinaryConfig",
    "WatermarkTask",
    "ProductSelectionItem",
    "ImportHistory",
    "OzonChat",
    "OzonChatMessage",
    "Kuajing84SyncLog",
    "Kuajing84GlobalConfig",
    # Listing models
    "OzonCategory",
    "OzonCategoryAttribute",
    "OzonAttributeDictionaryValue",
    "OzonMediaImportLog",
    "OzonProductImportLog",
    "OzonPriceUpdateLog",
    "OzonStockUpdateLog",
    # Finance models
    "OzonFinanceTransaction",
    "OzonFinanceSyncWatermark",
    # Promotion models
    "OzonPromotionAction",
    "OzonPromotionProduct",
]