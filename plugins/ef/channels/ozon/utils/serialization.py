"""
Ozon 数据序列化工具函数
"""
from decimal import Decimal
from typing import Any, Optional, Union


def format_decimal(value: Optional[Union[Decimal, float, int, str]], precision: int = 2) -> Optional[str]:
    """
    格式化 Decimal 类型为字符串，确保精确的小数位数

    Args:
        value: 要格式化的值
        precision: 小数位数，默认为2

    Returns:
        格式化后的字符串，或 None
    """
    if value is None:
        return None

    if isinstance(value, str):
        try:
            value = Decimal(value)
        except:
            return None
    elif isinstance(value, (int, float)):
        value = Decimal(str(value))

    if not isinstance(value, Decimal):
        return None

    # 使用 quantize 确保精确的小数位数
    from decimal import ROUND_HALF_UP
    quantized = value.quantize(Decimal(10) ** -precision, rounding=ROUND_HALF_UP)

    # 格式化为字符串，确保始终显示指定的小数位数
    return f"{quantized:.{precision}f}"


def format_currency(value: Optional[Union[Decimal, float, int, str]]) -> Optional[str]:
    """
    格式化货币金额，统一为2位小数

    Args:
        value: 要格式化的金额

    Returns:
        格式化后的金额字符串，或 None
    """
    return format_decimal(value, precision=2)


def serialize_product_prices(product_dict: dict) -> dict:
    """
    序列化商品价格字段，确保所有价格都是2位小数

    Args:
        product_dict: 商品字典数据

    Returns:
        处理后的商品字典
    """
    price_fields = ['price', 'old_price', 'premium_price', 'cost', 'min_price']

    for field in price_fields:
        if field in product_dict and product_dict[field] is not None:
            product_dict[field] = format_currency(product_dict[field])

    # 保留货币代码字段（不转换）
    # currency_code 字段应该直接从数据库传递，不需要格式化

    return product_dict


def serialize_order_amounts(order_dict: dict) -> dict:
    """
    序列化订单金额字段，确保所有金额都是2位小数

    Args:
        order_dict: 订单字典数据

    Returns:
        处理后的订单字典
    """
    amount_fields = [
        'total_price', 'products_price', 'delivery_price',
        'commission_amount', 'commission_price',
        'refund_amount', 'commission_refund'
    ]

    for field in amount_fields:
        if field in order_dict and order_dict[field] is not None:
            order_dict[field] = format_currency(order_dict[field])

    # 处理订单商品列表中的价格
    if 'products' in order_dict and isinstance(order_dict['products'], list):
        for product in order_dict['products']:
            if isinstance(product, dict):
                if 'price' in product and product['price'] is not None:
                    product['price'] = format_currency(product['price'])
                if 'discount' in product and product['discount'] is not None:
                    product['discount'] = format_currency(product['discount'])
                if 'total_price' in product and product['total_price'] is not None:
                    product['total_price'] = format_currency(product['total_price'])

    return order_dict