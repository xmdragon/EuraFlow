"""
运费计算相关数据模型
"""

from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime
from typing import Optional, Dict, Any, Annotated
from uuid import uuid4
from pydantic import BaseModel, Field, field_validator

from .enums import Platform, ServiceType, FulfillmentModel, Origin, CarrierService, ScenarioType


class Dimensions(BaseModel):
    """包裹尺寸"""

    length_cm: Annotated[Decimal, Field(gt=0)] = Field(...)
    width_cm: Annotated[Decimal, Field(gt=0)] = Field(...)
    height_cm: Annotated[Decimal, Field(gt=0)] = Field(...)

    @property
    def three_sides_sum(self) -> Decimal:
        """三边之和"""
        return self.length_cm + self.width_cm + self.height_cm

    @property
    def max_side(self) -> Decimal:
        """最长边"""
        return max(self.length_cm, self.width_cm, self.height_cm)

    @property
    def volume_cm3(self) -> Decimal:
        """体积（立方厘米）"""
        return self.length_cm * self.width_cm * self.height_cm


class ShippingFlags(BaseModel):
    """运输标记"""

    fragile: bool = False  # 易碎品
    battery: bool = False  # 含电池
    liquid: bool = False  # 液体
    cod: bool = False  # 货到付款
    insurance: bool = False  # 需要保险
    insurance_value: Optional[Annotated[Decimal, Field(ge=0)]] = Field(None)

    @field_validator("insurance_value")
    def validate_insurance_value(cls, v: Optional[Decimal], values: Dict[str, Any]) -> Optional[Decimal]:
        """验证保险金额"""
        if values.get("insurance") and not v:
            raise ValueError("保险金额必须在启用保险时提供")
        return v


class ShippingRequest(BaseModel):
    """运费计算请求"""

    # 基础信息
    platform: Platform
    carrier_service: CarrierService
    service_type: ServiceType

    # 包裹信息
    weight_g: int = Field(..., gt=0, le=25000)  # 最大25kg
    dimensions: Dimensions

    # 商业信息
    declared_value: Annotated[Decimal, Field(ge=0)] = Field(...)
    selling_price: Annotated[Decimal, Field(ge=0)] = Field(...)

    # 扩展信息
    origin: Origin = "cn_mainland"
    fulfillment_model: FulfillmentModel = FulfillmentModel.FBO
    category_code: Optional[str] = None
    flags: ShippingFlags = Field(default_factory=ShippingFlags)

    # 计算选项
    calc_date: Optional[datetime] = None  # 用于历史费率查询

    @property
    def weight_kg(self) -> Decimal:
        """重量（千克）"""
        return Decimal(self.weight_g) / 1000

    def model_dump_json(self, **kwargs: Any) -> str:
        """序列化时确保Decimal正确处理"""
        kwargs.setdefault("default", str)
        return super().model_dump_json(**kwargs)  # type: ignore[no-any-return]


class ShippingResult(BaseModel):
    """运费计算结果"""

    # 请求信息
    request_id: str = Field(default_factory=lambda: str(uuid4()))
    platform: Platform
    carrier_service: CarrierService
    service_type: ServiceType

    # 重量计算
    actual_weight_kg: Decimal = Field(...)
    volume_weight_kg: Decimal = Field(...)
    chargeable_weight_kg: Decimal = Field(...)
    weight_step_kg: Decimal = Field(...)
    rounded_weight_kg: Decimal = Field(...)

    # 费用明细
    base_rate: Decimal = Field(...)
    weight_rate: Decimal = Field(...)
    surcharges: Dict[str, Decimal] = Field(default_factory=dict)  # 附加费
    total_cost: Decimal = Field(...)

    # 时效信息
    delivery_days_min: int = Field(..., ge=1)
    delivery_days_max: int = Field(..., ge=1)

    # 边界标记
    min_charge_applied: bool = False
    oversize_applied: bool = False
    rejected: bool = False
    rejection_reason: Optional[str] = None

    # 追溯信息
    scenario: ScenarioType
    rate_id: str
    rate_version: str
    effective_from: datetime
    calculation_details: Dict[str, Any] = Field(default_factory=dict)

    @property
    def delivery_days_range(self) -> str:
        """时效范围文本"""
        if self.delivery_days_min == self.delivery_days_max:
            return f"{self.delivery_days_min}天"
        return f"{self.delivery_days_min}-{self.delivery_days_max}天"

    @field_validator("delivery_days_max")
    def validate_delivery_days(cls, v: int, values: Dict[str, Any]) -> int:
        """验证时效范围"""
        if "delivery_days_min" in values and v < values["delivery_days_min"]:
            raise ValueError("最大时效不能小于最小时效")
        return v

    def quantize_amounts(self) -> None:
        """量化所有金额到2位小数"""
        self.base_rate = self.base_rate.quantize(Decimal("0.01"), ROUND_HALF_UP)
        self.weight_rate = self.weight_rate.quantize(Decimal("0.01"), ROUND_HALF_UP)
        self.total_cost = self.total_cost.quantize(Decimal("0.01"), ROUND_HALF_UP)

        for key in self.surcharges:
            self.surcharges[key] = self.surcharges[key].quantize(Decimal("0.01"), ROUND_HALF_UP)

    def model_dump_json(self, **kwargs: Any) -> str:
        """序列化时确保Decimal正确处理"""
        kwargs.setdefault("default", str)
        return super().model_dump_json(**kwargs)  # type: ignore[no-any-return]
