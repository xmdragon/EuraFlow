"""
订单数据映射器

负责将 API 数据映射为数据库模型，包括：
- 订单金额计算
- 字段映射
"""

from decimal import Decimal
from typing import Dict, Any, Optional, Tuple
import logging

from ....utils.datetime_utils import parse_datetime, utcnow

logger = logging.getLogger(__name__)


class OrderMapper:
    """订单数据映射器"""

    def calculate_amounts(
        self,
        item: Dict[str, Any]
    ) -> Tuple[Optional[Decimal], Decimal, Optional[Decimal], Optional[Decimal], Optional[Dict]]:
        """
        计算订单金额信息

        Args:
            item: OZON API 返回的订单数据

        Returns:
            (total_price, products_price, delivery_price, commission_amount, delivery_address)
        """
        total_price = None
        products_price = Decimal("0")
        delivery_price = None
        commission_amount = None

        # 计算商品总价
        for product in item.get("products", []):
            price = Decimal(str(product.get("price", 0)))
            quantity = product.get("quantity", 1)
            products_price += price * quantity

        # 获取财务数据
        financial_data = item.get("financial_data", {})
        if financial_data:
            # 从财务数据中提取总价
            if financial_data.get("total_price") is not None:
                total_price = Decimal(str(financial_data["total_price"]))

            # 提取运费
            if financial_data.get("delivery_price") is not None:
                delivery_price = Decimal(str(financial_data["delivery_price"]))

            # 从产品财务数据中提取佣金
            products_financial = financial_data.get("products", [])
            if products_financial:
                commission_total = Decimal("0")
                for product_fin in products_financial:
                    if product_fin.get("commission_amount"):
                        commission_total += Decimal(str(product_fin["commission_amount"]))
                if commission_total > 0:
                    commission_amount = commission_total

        # 如果没有财务数据中的总价，使用商品价格
        if total_price is None:
            total_price = products_price

        # 从analytics_data提取地址信息
        delivery_address = None
        analytics_data = item.get("analytics_data", {})
        if analytics_data:
            address_components = {}
            if analytics_data.get("region"):
                address_components["region"] = analytics_data["region"]
            if analytics_data.get("city"):
                address_components["city"] = analytics_data["city"]
            if analytics_data.get("delivery_type"):
                address_components["delivery_type"] = analytics_data["delivery_type"]

            if address_components:
                delivery_address = address_components

        return total_price, products_price, delivery_price, commission_amount, delivery_address

    def map_to_order(
        self,
        item: Dict[str, Any],
        total_price: Optional[Decimal],
        products_price: Decimal,
        delivery_price: Optional[Decimal],
        commission_amount: Optional[Decimal],
        delivery_address: Optional[Dict],
        sync_mode: str
    ) -> Dict[str, Any]:
        """
        映射订单字段到数据库模型

        Args:
            item: OZON API 返回的订单数据
            total_price: 总价
            products_price: 商品总价
            delivery_price: 运费
            commission_amount: 佣金
            delivery_address: 配送地址
            sync_mode: 同步模式

        Returns:
            订单字段字典
        """
        # 基础字段
        order_data = {
            # 订单号映射
            "order_id": str(item.get("order_id", "")),
            "ozon_order_id": str(item.get("order_id", "")),
            "ozon_order_number": item.get("order_number", ""),

            # 订单状态
            "status": item.get("status", ""),
            "ozon_status": item.get("status", ""),

            # 订单类型
            "order_type": item.get("delivery_method", {}).get("tpl_provider", "FBS"),
            "is_express": item.get("is_express", False),
            "is_premium": item.get("is_premium", False),

            # 金额信息
            "total_price": total_price,
            "products_price": products_price,
            "delivery_price": delivery_price,
            "commission_amount": commission_amount,

            # 地址和配送
            "delivery_address": delivery_address,
            "delivery_method": item.get("delivery_method", {}).get("name"),

            # 原始数据
            "raw_payload": item,
        }

        # 从 analytics_data 提取所有可用字段
        analytics_data = item.get("analytics_data", {})
        if analytics_data:
            # 仓库信息
            if analytics_data.get("warehouse_id"):
                order_data["warehouse_id"] = analytics_data["warehouse_id"]
            if analytics_data.get("warehouse"):
                order_data["warehouse_name"] = analytics_data["warehouse"]

            # 物流提供商信息
            if analytics_data.get("tpl_provider_id"):
                order_data["tpl_provider_id"] = analytics_data["tpl_provider_id"]
            if analytics_data.get("tpl_provider"):
                order_data["tpl_provider_name"] = analytics_data["tpl_provider"]

            # 是否法人订单
            if analytics_data.get("is_legal") is not None:
                order_data["is_legal"] = analytics_data["is_legal"]

            # 支付方式
            if analytics_data.get("payment_type_group_name"):
                order_data["payment_type"] = analytics_data["payment_type_group_name"]

            # 配送日期范围
            if analytics_data.get("delivery_date_begin"):
                order_data["delivery_date_begin"] = parse_datetime(analytics_data["delivery_date_begin"])
                order_data["delivery_date"] = parse_datetime(analytics_data["delivery_date_begin"])
            if analytics_data.get("delivery_date_end"):
                order_data["delivery_date_end"] = parse_datetime(analytics_data["delivery_date_end"])

            # 客户期望配送日期范围
            if analytics_data.get("client_delivery_date_begin"):
                order_data["client_delivery_date_begin"] = parse_datetime(analytics_data["client_delivery_date_begin"])
            if analytics_data.get("client_delivery_date_end"):
                order_data["client_delivery_date_end"] = parse_datetime(analytics_data["client_delivery_date_end"])

            # is_premium 字段
            if analytics_data.get("is_premium") is not None:
                order_data["is_premium"] = analytics_data["is_premium"]

        # 其他时间字段
        order_data.update({
            "ordered_at": parse_datetime(item.get("in_process_at")) or utcnow(),
            "confirmed_at": parse_datetime(item.get("in_process_at")),
            "shipped_at": parse_datetime(item.get("shipment_date")),
            "delivered_at": parse_datetime(item.get("delivered_at")),
            "cancelled_at": parse_datetime(item.get("cancelled_at")),
        })

        return order_data
