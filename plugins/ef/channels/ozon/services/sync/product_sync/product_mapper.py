"""
商品数据映射器

负责将 API 数据映射为数据库模型，包括：
- 基础字段映射
- 图片信息提取
- 属性信息提取
- 尺寸信息提取
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from decimal import Decimal
import logging

from ..utils import safe_int_conversion, safe_decimal_conversion
from ....utils.datetime_utils import parse_datetime

logger = logging.getLogger(__name__)


@dataclass
class ProductUpdateData:
    """商品更新数据"""
    # 基础字段
    ozon_product_id: Optional[int] = None
    offer_id: str = ""
    ozon_sku: Optional[int] = None
    title: str = ""
    description: Optional[str] = None
    barcode: str = ""
    category_id: Optional[int] = None
    brand: Optional[str] = None

    # 价格
    price: Optional[Decimal] = None
    old_price: Optional[Decimal] = None
    currency_code: Optional[str] = None

    # 库存
    stock: int = 0
    reserved: int = 0
    available: int = 0
    warehouse_stocks: List[Dict] = field(default_factory=list)

    # OZON 原生状态
    ozon_archived: bool = False
    ozon_has_fbo_stocks: bool = False
    ozon_has_fbs_stocks: bool = False
    ozon_is_discounted: bool = False
    ozon_created_at: Optional[Any] = None
    ozon_visibility_details: Optional[Dict] = None

    # 本地状态
    status: str = "active"
    ozon_status: str = ""
    status_reason: Optional[str] = None
    visibility: bool = True
    is_archived: bool = False

    # 图片
    images: Optional[Dict] = None

    # 尺寸
    weight: Optional[Decimal] = None
    width: Optional[Decimal] = None
    height: Optional[Decimal] = None
    depth: Optional[Decimal] = None

    # 属性（v4 API）
    barcodes: Optional[List] = None
    ozon_attributes: Optional[List] = None
    complex_attributes: Optional[List] = None
    description_category_id: Optional[int] = None
    type_id: Optional[int] = None
    color_image: Optional[str] = None
    primary_image: Optional[str] = None
    dimension_unit: Optional[str] = None
    weight_unit: Optional[str] = None
    model_info: Optional[Dict] = None
    pdf_list: Optional[List] = None
    attributes_with_defaults: Optional[List] = None


class ProductMapper:
    """商品数据映射器"""

    def map_to_product_data(
        self,
        item: Dict[str, Any],
        product_details: Optional[Dict[str, Any]],
        price_info: Optional[Dict[str, Any]],
        stock_info: Optional[Dict[str, Any]],
        attr_info: Optional[Dict[str, Any]],
    ) -> ProductUpdateData:
        """
        将 API 数据映射为商品更新数据

        Args:
            item: 商品列表项
            product_details: 商品详情（v3 API）
            price_info: 价格信息
            stock_info: 库存信息
            attr_info: 属性信息（v4 API）

        Returns:
            ProductUpdateData 对象
        """
        data = ProductUpdateData()

        # 基础字段
        data.offer_id = item.get("offer_id", "")
        data.ozon_product_id = item.get("product_id")
        data.title = item.get("name", "") or (product_details.get("name") if product_details else "")
        data.barcode = item.get("barcode", "") or (product_details.get("barcode") if product_details else "")
        data.category_id = item.get("category_id") or (product_details.get("category_id") if product_details else None)

        # 从详情获取更多字段
        if product_details:
            data.brand = product_details.get("brand")
            data.description = product_details.get("description")

            # OZON SKU
            sku_value = (
                product_details.get("sku") or
                product_details.get("fbs_sku") or
                product_details.get("fbo_sku")
            )
            data.ozon_sku = safe_int_conversion(sku_value)

            # 创建时间
            if product_details.get("created_at"):
                try:
                    data.ozon_created_at = parse_datetime(product_details["created_at"])
                except (ValueError, TypeError) as e:
                    logger.warning(f"Failed to parse created_at for product {data.offer_id}: {e}")

        # OZON 原生状态
        data.ozon_archived = item.get("archived", False)
        data.ozon_has_fbo_stocks = item.get("has_fbo_stocks", False)
        data.ozon_has_fbs_stocks = item.get("has_fbs_stocks", False)
        data.ozon_is_discounted = item.get("is_discounted", False)

        # 价格
        self._map_price(data, item, product_details, price_info)

        # 库存
        self._map_stock(data, item, stock_info)

        # 图片
        data.images = self.extract_images(product_details)

        # 尺寸
        self._map_dimensions(data, product_details, attr_info)

        # 属性
        self._map_attributes(data, attr_info)

        # 可见性详情
        if product_details:
            data.ozon_visibility_details = product_details.get("visibility_details", {})
            visibility_details = data.ozon_visibility_details or {}
            has_price = visibility_details.get("has_price", True)
            has_stock = visibility_details.get("has_stock", True)
            data.visibility = has_price and has_stock

            data.is_archived = (
                product_details.get("is_archived", False) or
                product_details.get("is_autoarchived", False)
            )
            if data.is_archived:
                data.ozon_archived = True

        return data

    def _map_price(
        self,
        data: ProductUpdateData,
        item: Dict[str, Any],
        product_details: Optional[Dict[str, Any]],
        price_info: Optional[Dict[str, Any]],
    ) -> None:
        """映射价格信息"""
        price = None
        old_price = None
        currency_code = None

        # 第一优先级：使用价格 API 的数据
        if price_info:
            price = price_info.get("price")
            old_price = price_info.get("old_price")

        # 第二优先级：从 v3 API 获取
        if not price and product_details:
            price = product_details.get("price")
            old_price = product_details.get("old_price")

        # 获取货币代码（始终从详情中获取）
        if product_details:
            currency_code = product_details.get("currency_code")

        # 第三优先级：使用列表中的价格
        if not price and "price" in item:
            price = item["price"]
        if not old_price and "old_price" in item:
            old_price = item["old_price"]

        data.price = safe_decimal_conversion(price)
        data.old_price = safe_decimal_conversion(old_price)
        data.currency_code = currency_code

    def _map_stock(
        self,
        data: ProductUpdateData,
        item: Dict[str, Any],
        stock_info: Optional[Dict[str, Any]],
    ) -> None:
        """映射库存信息"""
        if stock_info:
            data.stock = stock_info["total"]
            data.reserved = stock_info["reserved"]
            data.available = stock_info["present"]
            data.warehouse_stocks = stock_info.get("warehouse_stocks", [])
        else:
            # 降级到原有逻辑
            stocks = item.get("stocks", {})
            data.stock = stocks.get("present", 0) + stocks.get("reserved", 0)
            data.reserved = stocks.get("reserved", 0)
            data.available = stocks.get("present", 0)
            data.warehouse_stocks = []

    def _map_dimensions(
        self,
        data: ProductUpdateData,
        product_details: Optional[Dict[str, Any]],
        attr_info: Optional[Dict[str, Any]],
    ) -> None:
        """映射尺寸信息"""
        # 从 v4 attributes API 优先获取
        if attr_info:
            if attr_info.get("weight") is not None:
                data.weight = safe_decimal_conversion(attr_info.get("weight"))
            if attr_info.get("width") is not None:
                data.width = safe_decimal_conversion(attr_info.get("width"))
            if attr_info.get("height") is not None:
                data.height = safe_decimal_conversion(attr_info.get("height"))
            if attr_info.get("depth") is not None:
                data.depth = safe_decimal_conversion(attr_info.get("depth"))
            return

        # 降级到 product_details
        if product_details:
            dimensions = product_details.get("dimensions", {})
            if dimensions:
                data.weight = dimensions.get("weight")
                data.width = dimensions.get("width")
                data.height = dimensions.get("height")
                data.depth = dimensions.get("depth")

    def _map_attributes(
        self,
        data: ProductUpdateData,
        attr_info: Optional[Dict[str, Any]],
    ) -> None:
        """映射属性信息"""
        if not attr_info:
            return

        data.barcodes = attr_info.get("barcodes")
        data.ozon_attributes = attr_info.get("attributes")
        data.complex_attributes = attr_info.get("complex_attributes")
        data.description_category_id = attr_info.get("description_category_id")
        data.type_id = attr_info.get("type_id")
        data.color_image = attr_info.get("color_image")
        data.primary_image = attr_info.get("primary_image")
        data.dimension_unit = attr_info.get("dimension_unit")
        data.weight_unit = attr_info.get("weight_unit")
        data.model_info = attr_info.get("model_info")
        data.pdf_list = attr_info.get("pdf_list")
        data.attributes_with_defaults = attr_info.get("attributes_with_defaults")

    def extract_images(self, product_details: Optional[Dict[str, Any]]) -> Optional[Dict]:
        """
        提取图片信息

        Args:
            product_details: 商品详情

        Returns:
            图片信息字典 {primary, additional, count}
        """
        if not product_details:
            return None

        # 优先使用 primary_image 字段
        if product_details.get("primary_image") and isinstance(product_details["primary_image"], list):
            primary_images = product_details["primary_image"]
            all_images = product_details.get("images", [])

            if primary_images and len(primary_images) > 0:
                return {
                    "primary": primary_images[0],
                    "additional": all_images[1:] if len(all_images) > 1 else [],
                    "count": len(all_images) if all_images else 1,
                }

        # 如果没有 primary_image，使用 images 字段
        if product_details.get("images") and isinstance(product_details["images"], list):
            images_list = product_details["images"]
            if images_list and len(images_list) > 0:
                return {
                    "primary": images_list[0],
                    "additional": images_list[1:] if len(images_list) > 1 else [],
                    "count": len(images_list),
                }

        return None

    def apply_to_product(
        self,
        product: Any,
        data: ProductUpdateData,
        is_new: bool = False
    ) -> None:
        """
        将映射数据应用到商品对象

        Args:
            product: OzonProduct 对象
            data: 映射后的数据
            is_new: 是否为新商品
        """
        # 基础字段
        product.title = data.title
        product.ozon_product_id = data.ozon_product_id
        product.ozon_sku = data.ozon_sku
        product.barcode = data.barcode
        product.category_id = data.category_id
        product.brand = data.brand
        product.description = data.description

        # OZON 原生状态
        product.ozon_archived = data.ozon_archived
        product.ozon_has_fbo_stocks = data.ozon_has_fbo_stocks
        product.ozon_has_fbs_stocks = data.ozon_has_fbs_stocks
        product.ozon_is_discounted = data.ozon_is_discounted

        if is_new and data.ozon_created_at:
            product.ozon_created_at = data.ozon_created_at

        # 价格
        if data.price is not None:
            product.price = data.price
        if data.old_price is not None:
            product.old_price = data.old_price
        if data.currency_code:
            product.currency_code = data.currency_code

        # 库存
        product.stock = data.stock
        product.reserved = data.reserved
        product.available = data.available
        product.warehouse_stocks = data.warehouse_stocks

        # 图片和尺寸
        product.images = data.images
        product.weight = data.weight
        product.width = data.width
        product.height = data.height
        product.depth = data.depth

        # 可见性
        product.visibility = data.visibility
        product.is_archived = data.is_archived
        product.ozon_visibility_details = data.ozon_visibility_details

        # 属性
        product.barcodes = data.barcodes
        product.ozon_attributes = data.ozon_attributes
        product.complex_attributes = data.complex_attributes
        product.description_category_id = data.description_category_id
        product.type_id = data.type_id
        product.color_image = data.color_image
        product.primary_image = data.primary_image
        product.dimension_unit = data.dimension_unit
        product.weight_unit = data.weight_unit
        product.model_info = data.model_info
        product.pdf_list = data.pdf_list
        product.attributes_with_defaults = data.attributes_with_defaults
