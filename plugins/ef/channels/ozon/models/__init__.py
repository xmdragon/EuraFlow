"""Ozon 插件数据模型"""

from .ozon_shops import OzonShop
from .products import OzonProduct
from .orders import OzonPosting, OzonShipmentPackage, OzonRefund, OzonDomesticTracking
from .warehouses import OzonWarehouse
from .watermark import WatermarkConfig, CloudinaryConfig, WatermarkTask, AliyunOssConfig
from .product_selection import ProductSelectionItem, ImportHistory
from .chat import OzonChat, OzonChatMessage
from .listing import (
    OzonCategory,
    OzonCategoryAttribute,
    OzonAttributeDictionaryValue,
    OzonMediaImportLog,
    OzonProductImportLog,
    OzonPriceUpdateLog,
    OzonStockUpdateLog,
)
from .finance import OzonFinanceTransaction, OzonFinanceSyncWatermark, OzonInvoicePayment
from .promotion import OzonPromotionAction, OzonPromotionProduct
from .global_settings import OzonGlobalSetting
from .category_commissions import OzonCategoryCommission
from .translation import AliyunTranslationConfig
from .chatgpt_translation import ChatGPTTranslationConfig
from .collection_record import OzonProductCollectionRecord
from .draft_template import OzonProductTemplate
from .cancel_return import OzonCancellation, OzonReturn
from .stats import OzonDailyStats
from .collection_source import OzonCollectionSource

__all__ = [
    "OzonShop",
    "OzonProduct",
    "OzonPosting",
    "OzonShipmentPackage",
    "OzonRefund",
    "OzonDomesticTracking",
    "OzonWarehouse",
    "WatermarkConfig",
    "CloudinaryConfig",
    "AliyunOssConfig",
    "WatermarkTask",
    "ProductSelectionItem",
    "ImportHistory",
    "OzonChat",
    "OzonChatMessage",
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
    "OzonInvoicePayment",
    # Promotion models
    "OzonPromotionAction",
    "OzonPromotionProduct",
    # Global settings
    "OzonGlobalSetting",
    # Category commissions
    "OzonCategoryCommission",
    # Translation configs
    "AliyunTranslationConfig",
    "ChatGPTTranslationConfig",
    # Collection records
    "OzonProductCollectionRecord",
    # Draft & Template
    "OzonProductTemplate",
    # Cancel & Return
    "OzonCancellation",
    "OzonReturn",
    # Statistics
    "OzonDailyStats",
    # Collection sources (auto collection)
    "OzonCollectionSource",
]