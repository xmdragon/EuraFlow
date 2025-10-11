"""Ozon 插件数据模型"""

from .ozon_shops import OzonShop
from .products import OzonProduct
from .orders import OzonOrder, OzonPosting, OzonOrderItem, OzonShipmentPackage, OzonRefund
from .watermark import WatermarkConfig, CloudinaryConfig, WatermarkTask
from .product_selection import ProductSelectionItem, ImportHistory
from .chat import OzonChat, OzonChatMessage
from .kuajing84 import Kuajing84SyncLog

__all__ = [
    "OzonShop",
    "OzonProduct",
    "OzonOrder",
    "OzonPosting",
    "OzonOrderItem",
    "OzonShipmentPackage",
    "OzonRefund",
    "WatermarkConfig",
    "CloudinaryConfig",
    "WatermarkTask",
    "ProductSelectionItem",
    "ImportHistory",
    "OzonChat",
    "OzonChatMessage",
    "Kuajing84SyncLog"
]