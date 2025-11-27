"""
Ozon API 客户端 Mixins

将 OzonAPIClient 拆分为多个功能模块，便于维护和测试。
"""

from .base import OzonAPIClientBase
from .catalog import CatalogMixin
from .chat import ChatMixin
from .finance import FinanceMixin
from .media import MediaMixin
from .orders import OrdersMixin
from .products import ProductsMixin
from .warehouse import WarehouseMixin

__all__ = [
    "OzonAPIClientBase",
    "ProductsMixin",
    "OrdersMixin",
    "FinanceMixin",
    "ChatMixin",
    "CatalogMixin",
    "WarehouseMixin",
    "MediaMixin",
]
