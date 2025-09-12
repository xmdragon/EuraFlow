"""
平台费相关数据模型
"""

from decimal import Decimal
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

from .enums import Platform, FulfillmentModel


class PlatformFee(BaseModel):
    """平台费配置"""

    platform: Platform
    category_code: str
    fulfillment_model: FulfillmentModel

    # 费率配置
    fee_rate: Decimal = Field(..., decimal_places=4, ge=0, le=1)  # 0.1400 = 14%
    min_fee: Optional[Decimal] = Field(None, decimal_places=2, ge=0)
    max_fee: Optional[Decimal] = Field(None, decimal_places=2, ge=0)
    fixed_fee: Decimal = Field(default=Decimal("0"), decimal_places=2, ge=0)

    # FBO/FBS差异
    fbo_extra_rate: Decimal = Field(default=Decimal("0"), decimal_places=4, ge=0)
    fbs_extra_rate: Decimal = Field(default=Decimal("0"), decimal_places=4, ge=0)

    # 版本控制
    version: str
    effective_from: datetime
    effective_to: Optional[datetime] = None

    def calculate_fee(self, amount: Decimal) -> Decimal:
        """
        计算平台费

        Args:
            amount: 交易金额

        Returns:
            计算后的平台费
        """
        # 基础费率
        total_rate = self.fee_rate

        # 添加履约模式额外费率
        if self.fulfillment_model == FulfillmentModel.FBO:
            total_rate += self.fbo_extra_rate
        elif self.fulfillment_model == FulfillmentModel.FBS:
            total_rate += self.fbs_extra_rate

        # 计算费用
        fee = amount * total_rate + self.fixed_fee

        # 应用最小/最大限制
        if self.min_fee is not None:
            fee = max(fee, self.min_fee)
        if self.max_fee is not None:
            fee = min(fee, self.max_fee)

        return fee

    def is_effective(self, date: Optional[datetime] = None) -> bool:
        """
        检查费率是否在指定日期有效

        Args:
            date: 要检查的日期，默认为当前时间

        Returns:
            是否有效
        """
        if date is None:
            date = datetime.now()

        if date < self.effective_from:
            return False

        if self.effective_to and date > self.effective_to:
            return False

        return True

    def model_dump_json(self, **kwargs):
        """序列化时确保Decimal正确处理"""
        kwargs.setdefault("default", str)
        return super().model_dump_json(**kwargs)


class PlatformFeeRequest(BaseModel):
    """平台费查询请求"""

    platform: Platform
    category_code: str
    fulfillment_model: FulfillmentModel = FulfillmentModel.FBO
    calc_date: Optional[datetime] = None

    def model_dump_json(self, **kwargs):
        """序列化时确保Decimal正确处理"""
        kwargs.setdefault("default", str)
        return super().model_dump_json(**kwargs)
