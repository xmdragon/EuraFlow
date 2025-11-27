"""
安全类型转换工具函数

提供安全的类型转换，失败时返回 None 而不是抛出异常。
"""

from decimal import Decimal
from typing import Any, Optional
import logging

logger = logging.getLogger(__name__)


def safe_int_conversion(value: Any) -> Optional[int]:
    """
    安全地将值转换为整数，失败时返回 None

    支持的输入类型：
    - None -> None
    - int -> int
    - float -> int（截断）
    - str -> int（仅纯数字字符串）

    Args:
        value: 要转换的值

    Returns:
        转换后的整数，或 None（如果转换失败）
    """
    if value is None:
        return None

    try:
        # 处理字符串和数字类型
        str_value = str(value).strip()
        if str_value.isdigit():
            return int(str_value)
        return None
    except (ValueError, TypeError, AttributeError):
        return None


def safe_decimal_conversion(value: Any) -> Optional[Decimal]:
    """
    安全地将值转换为 Decimal，失败时返回 None

    支持的输入类型：
    - None -> None
    - Decimal -> Decimal
    - int -> Decimal
    - float -> Decimal
    - str -> Decimal（包含数字的字符串）

    Args:
        value: 要转换的值

    Returns:
        转换后的 Decimal，或 None（如果转换失败）
    """
    if value is None:
        return None

    try:
        # 处理空字符串
        str_value = str(value).strip()
        if not str_value or str_value == "":
            return None

        # 转换为 Decimal
        return Decimal(str_value)
    except (ValueError, TypeError, AttributeError, Exception) as e:
        logger.warning(f"Failed to convert value to Decimal: {value}, error: {e}")
        return None
