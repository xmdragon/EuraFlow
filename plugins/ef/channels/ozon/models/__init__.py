"""Ozon 插件数据模型"""

from .ozon_shops import OzonShop
from .ozon_products import OzonProduct
from .ozon_orders import OzonOrder
from .watermark import WatermarkConfig, CloudinaryConfig, WatermarkTask
from .product_selection import ProductSelectionItem, ImportHistory

__all__ = [
    "OzonShop",
    "OzonProduct",
    "OzonOrder",
    "WatermarkConfig",
    "CloudinaryConfig",
    "WatermarkTask",
    "ProductSelectionItem",
    "ImportHistory"
]