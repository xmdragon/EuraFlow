"""Ozon 插件数据模型"""

from .ozon_shops import OzonShop
from .ozon_products import OzonProduct
from .orders import OzonOrder, OzonPosting, OzonOrderItem, OzonShipmentPackage, OzonRefund
from .watermark import WatermarkConfig, CloudinaryConfig, WatermarkTask
from .product_selection import ProductSelectionItem, ImportHistory
from .chat import OzonChat, OzonChatMessage

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
    "OzonChatMessage"
]