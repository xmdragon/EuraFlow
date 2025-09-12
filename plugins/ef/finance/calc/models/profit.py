"""
利润计算相关数据模型
"""

from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Dict, List, Any
from uuid import uuid4
from pydantic import BaseModel, Field

from .enums import Platform, FulfillmentModel, ScenarioType
from .shipping import Dimensions, ShippingResult


class ProfitRequest(BaseModel):
    """利润计算请求"""

    # 基础信息
    sku: str
    platform: Platform

    # 成本与价格
    cost: Decimal = Field(..., decimal_places=2, ge=0)
    selling_price: Decimal = Field(..., decimal_places=2, gt=0)

    # 物理属性
    weight_g: int = Field(..., gt=0, le=25000)
    dimensions: Dimensions

    # 扩展信息
    fulfillment_model: FulfillmentModel = FulfillmentModel.FBO
    category_code: Optional[str] = None
    platform_fee_rate: Optional[Decimal] = Field(None, decimal_places=4, ge=0, le=1)

    # 运费选项
    compare_shipping: bool = True  # 是否比较多种运费方案
    preferred_service: Optional[str] = None  # 首选服务类型

    def model_dump_json(self, **kwargs: Any) -> str:
        """序列化时确保Decimal正确处理"""
        kwargs.setdefault("default", str)
        return super().model_dump_json(**kwargs)  # type: ignore[no-any-return]


class ProfitOptimization(BaseModel):
    """利润优化建议"""

    suggested_price: Decimal = Field(..., decimal_places=2)
    expected_profit: Decimal = Field(..., decimal_places=2)
    expected_profit_rate: Decimal = Field(..., decimal_places=4)
    price_adjustment: Decimal = Field(..., decimal_places=2)
    optimization_reason: str

    def model_dump_json(self, **kwargs: Any) -> str:
        """序列化时确保Decimal正确处理"""
        kwargs.setdefault("default", str)
        return super().model_dump_json(**kwargs)  # type: ignore[no-any-return]


class MarginAnalysis(BaseModel):
    """毛利分析"""

    gross_margin: Decimal = Field(..., decimal_places=2)
    gross_margin_rate: Decimal = Field(..., decimal_places=4)
    cost_breakdown: Dict[str, Decimal]
    margin_level: str  # "excellent", "good", "acceptable", "poor"

    def model_dump_json(self, **kwargs: Any) -> str:
        """序列化时确保Decimal正确处理"""
        kwargs.setdefault("default", str)
        return super().model_dump_json(**kwargs)  # type: ignore[no-any-return]


class ProfitResult(BaseModel):
    """利润计算结果"""

    # 请求信息
    request_id: str = Field(default_factory=lambda: str(uuid4()))
    sku: str
    platform: Platform

    # 输入值
    cost: Decimal = Field(..., decimal_places=2)
    selling_price: Decimal = Field(..., decimal_places=2)

    # 平台费
    platform_fee: Decimal = Field(..., decimal_places=2)
    platform_fee_rate: Decimal = Field(..., decimal_places=4)

    # 运费方案
    shipping_options: Dict[str, ShippingResult] = Field(default_factory=dict)
    recommended_shipping: Optional[str] = None
    selected_shipping_cost: Decimal = Field(..., decimal_places=2)

    # 利润计算
    profit_amount: Decimal = Field(..., decimal_places=2)
    profit_rate: Decimal = Field(..., decimal_places=4)

    # 场景与分析
    scenario: ScenarioType
    margin_analysis: MarginAnalysis

    # 优化建议
    optimizations: List[ProfitOptimization] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)

    @property
    def profit_rate_percent(self) -> str:
        """利润率百分比显示"""
        return f"{(self.profit_rate * 100):.2f}%"

    @property
    def is_profitable(self) -> bool:
        """是否盈利"""
        return self.profit_amount > 0

    @property
    def break_even_price(self) -> Decimal:
        """保本价格"""
        total_cost = self.cost + self.selected_shipping_cost
        # 考虑平台费率，计算保本售价
        # 售价 * (1 - 费率) = 总成本
        # 售价 = 总成本 / (1 - 费率)
        if self.platform_fee_rate < 1:
            return (total_cost / (1 - self.platform_fee_rate)).quantize(Decimal("0.01"), ROUND_HALF_UP)
        return total_cost

    def add_warning(self, warning: str) -> None:
        """添加警告信息"""
        if warning not in self.warnings:
            self.warnings.append(warning)

    def add_optimization(self, optimization: ProfitOptimization) -> None:
        """添加优化建议"""
        self.optimizations.append(optimization)

    def quantize_amounts(self) -> None:
        """量化所有金额到2位小数"""
        self.cost = self.cost.quantize(Decimal("0.01"), ROUND_HALF_UP)
        self.selling_price = self.selling_price.quantize(Decimal("0.01"), ROUND_HALF_UP)
        self.platform_fee = self.platform_fee.quantize(Decimal("0.01"), ROUND_HALF_UP)
        self.selected_shipping_cost = self.selected_shipping_cost.quantize(Decimal("0.01"), ROUND_HALF_UP)
        self.profit_amount = self.profit_amount.quantize(Decimal("0.01"), ROUND_HALF_UP)

    def model_dump_json(self, **kwargs: Any) -> str:
        """序列化时确保Decimal正确处理"""
        kwargs.setdefault("default", str)
        return super().model_dump_json(**kwargs)  # type: ignore[no-any-return]
