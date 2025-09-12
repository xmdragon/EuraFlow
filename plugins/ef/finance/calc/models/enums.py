"""
枚举类型定义
"""

from enum import Enum
from typing import Literal


class Platform(str, Enum):
    """平台枚举"""

    OZON = "ozon"
    WILDBERRIES = "wb"
    YANDEX = "yandex"


class ServiceType(str, Enum):
    """服务类型枚举"""

    EXPRESS = "express"
    STANDARD = "standard"
    ECONOMY = "economy"
    SUPER_EXPRESS = "super_express"


class FulfillmentModel(str, Enum):
    """履约模式枚举"""

    FBO = "fbo"  # Fulfillment by Operator
    FBS = "fbs"  # Fulfillment by Seller


class RoundingMode(str, Enum):
    """舍入模式枚举"""

    CEIL = "ceil"  # 向上取整
    FLOOR = "floor"  # 向下取整
    HALF_UP = "half_up"  # 四舍五入


class CarrierService(str, Enum):
    """承运商服务枚举"""

    UNI_OZON = "uni_ozon"
    UNI_WB = "uni_wb"
    UNI_YANDEX = "uni_yandex"


class ScenarioType(str, Enum):
    """场景类型枚举"""

    SUPER_LIGHT_SMALL = "super_light_small"  # 超级轻小件
    LIGHT_SMALL = "light_small"  # 轻小件
    STANDARD = "standard"  # 标准件
    LARGE = "large"  # 大件
    HIGH_VALUE_LIGHT = "high_value_light"  # 高客单轻件
    HIGH_VALUE_LARGE = "high_value_large"  # 高客单大件


# 类型别名
Origin = Literal["cn_mainland", "hk"]
