"""
物流费率 API 路由
提供定价器功能所需的物流商列表和建议售价计算
"""
from decimal import Decimal
from typing import List, Optional
import logging
import re

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible

from plugins.ef.channels.ozon.models.shipping_rates import OzonShippingRate

router = APIRouter(prefix="/shipping-rates", tags=["Shipping Rates"])
logger = logging.getLogger(__name__)


# === DTO ===

class LogisticsProviderResponse(BaseModel):
    """物流商列表响应"""
    providers: List[str]


class ShippingRateInfo(BaseModel):
    """物流费率信息"""
    service_level: str = Field(..., description="服务等级: Express/Standard/Economy")
    rate_formula: str = Field(..., description="费率公式: ¥3 + ¥0.035/1g")
    base_fee: float = Field(..., description="基础费用（元）")
    per_gram_rate: float = Field(..., description="每克费率（元/克）")
    shipping_cost: float = Field(..., description="物流费用（元）")
    transit_days: Optional[str] = Field(None, description="时效")


class SuggestedPriceResult(BaseModel):
    """建议售价计算结果"""
    service_level: str
    shipping_cost: float = Field(..., description="物流费用（元）")
    suggested_price_rub: float = Field(..., description="建议售价（卢布）")
    suggested_price_rmb: float = Field(..., description="建议售价（元）")
    commission_rate: float = Field(..., description="实际使用的佣金率（%）")
    price_tier: str = Field(..., description="价格档位: tier1/tier2/tier3")
    transit_days: Optional[str] = None
    # 物流限制信息
    battery_allowed: bool = Field(False, description="是否允许带电")
    liquid_allowed: bool = Field(False, description="是否允许液体")
    size_limit: Optional[str] = Field(None, description="尺寸限制")
    weight_range: Optional[str] = Field(None, description="重量范围")
    value_limit_rub: Optional[str] = Field(None, description="货值限制(卢布)")
    value_limit_cny: Optional[str] = Field(None, description="货值限制(人民币)")


class PricingCalculatorRequest(BaseModel):
    """定价器请求"""
    cost: float = Field(..., ge=0, description="商品成本（元）")
    profit_rate: float = Field(..., ge=0, le=100, description="预期利润率（%）")
    weight: int = Field(..., ge=1, description="重量（克）")
    length: float = Field(..., ge=0, description="长（厘米）")
    width: float = Field(..., ge=0, description="宽（厘米）")
    height: float = Field(..., ge=0, description="高（厘米）")
    logistics_provider: str = Field(..., description="物流商代码")
    commission_tier1: Optional[float] = Field(None, ge=0, le=100, description="佣金率-≤1500₽（%），不传则使用默认14%")
    commission_tier2: Optional[float] = Field(None, ge=0, le=100, description="佣金率-1501~5000₽（%），不传则使用默认17%")
    commission_tier3: Optional[float] = Field(None, ge=0, le=100, description="佣金率->5000₽（%），不传则使用默认20%")
    exchange_rate: Optional[float] = Field(None, gt=0, description="汇率（CNY→RUB），不传则使用默认13.5")


class PricingCalculatorResponse(BaseModel):
    """定价器响应"""
    size_group: str = Field(..., description="匹配的尺寸分组")
    results: List[SuggestedPriceResult] = Field(..., description="各服务等级的建议售价")
    warnings: List[str] = Field(default_factory=list, description="警告信息")


# === 辅助函数 ===

def parse_rate_formula(rate: str) -> tuple[float, float]:
    """
    解析费率公式字符串
    例如: "¥3 + ¥0,035/1g" -> (3.0, 0.035)
    """
    if not rate:
        return (0.0, 0.0)

    # 标准化：将逗号替换为点
    rate = rate.replace(',', '.')

    # 匹配模式: ¥数字 + ¥数字/1g
    pattern = r'¥?([\d.]+)\s*\+\s*¥?([\d.]+)/1g'
    match = re.search(pattern, rate)

    if match:
        base = float(match.group(1))
        per_gram = float(match.group(2))
        return (base, per_gram)

    # 尝试只匹配基础费用
    base_pattern = r'¥?([\d.]+)'
    base_match = re.search(base_pattern, rate)
    if base_match:
        return (float(base_match.group(1)), 0.0)

    return (0.0, 0.0)


def match_size_group(weight: int, length: float, width: float, height: float) -> str:
    """
    根据重量和尺寸匹配尺寸分组

    规则（基于 OZON 官方）：
    - Extra Small: 1-500g, 三边和≤90cm, 长边≤60cm
    - Budget: 501-30000g, 三边和≤150cm, 长边≤60cm
    - Small: 1-2000g, 三边和≤150cm, 长边≤60cm
    - Big: 2001-30000g, 三边和≤250cm, 长边≤150cm
    - Premium Small: 1-5000g, 三边和≤250cm, 长边≤150cm
    - Premium Big: 5001-30000g, 三边和≤310cm, 长边≤150cm
    """
    dimensions = sorted([length, width, height], reverse=True)
    max_side = dimensions[0]
    sum_sides = sum(dimensions)

    # 按照优先级匹配
    # Extra Small: 最严格的条件
    if weight <= 500 and sum_sides <= 90 and max_side <= 60:
        return "Extra Small"

    # Budget: 重量501-30000g，尺寸较小
    if 501 <= weight <= 30000 and sum_sides <= 150 and max_side <= 60:
        return "Budget"

    # Small: 轻小件
    if weight <= 2000 and sum_sides <= 150 and max_side <= 60:
        return "Small"

    # Big: 大件
    if 2001 <= weight <= 30000 and sum_sides <= 250 and max_side <= 150:
        return "Big"

    # Premium Small: 高客单轻小件
    if weight <= 5000 and sum_sides <= 250 and max_side <= 150:
        return "Premium Small"

    # Premium Big: 高客单大件
    if 5001 <= weight <= 30000 and sum_sides <= 310 and max_side <= 150:
        return "Premium Big"

    # 默认返回 Budget（最宽松的常规组）
    return "Budget"


def calculate_suggested_price(
    cost: float,
    shipping_cost: float,
    profit_rate: float,
    commission_tier1: float,
    commission_tier2: float,
    commission_tier3: float,
    exchange_rate: float,
) -> tuple[float, float, str]:
    """
    计算建议售价（带迭代处理循环依赖）

    公式: P = (C + L) × R / (1 - F - M)

    其中:
    - P = 建议售价（卢布）
    - C = 商品成本（元）
    - L = 物流费用（元）
    - R = 汇率（CNY→RUB）
    - F = 平台扣点率（小数）
    - M = 预期利润率（小数）

    返回: (建议售价卢布, 实际佣金率, 价格档位)
    """
    profit_rate_decimal = profit_rate / 100

    # 档位阈值（卢布）
    TIER1_MAX = 1500
    TIER2_MAX = 5000

    # 迭代计算：先用 tier1 计算，检查是否落在对应档位
    for tier, commission_rate, tier_name in [
        (1, commission_tier1, "tier1"),
        (2, commission_tier2, "tier2"),
        (3, commission_tier3, "tier3"),
    ]:
        commission_decimal = commission_rate / 100
        denominator = 1 - commission_decimal - profit_rate_decimal

        if denominator <= 0:
            # 无法盈利，返回无穷大
            continue

        price_rub = (cost + shipping_cost) * exchange_rate / denominator

        # 检查是否落在当前档位
        if tier == 1 and price_rub <= TIER1_MAX:
            return (price_rub, commission_rate, tier_name)
        elif tier == 2 and TIER1_MAX < price_rub <= TIER2_MAX:
            return (price_rub, commission_rate, tier_name)
        elif tier == 3 and price_rub > TIER2_MAX:
            return (price_rub, commission_rate, tier_name)

    # 如果所有档位都不满足，使用 tier3 的结果
    commission_decimal = commission_tier3 / 100
    denominator = 1 - commission_decimal - profit_rate_decimal

    if denominator <= 0:
        return (float('inf'), commission_tier3, "tier3")

    price_rub = (cost + shipping_cost) * exchange_rate / denominator
    return (price_rub, commission_tier3, "tier3")


# === API 端点 ===

class ShippingRateListItem(BaseModel):
    """物流费率列表项"""
    id: int
    size_group: str = Field(..., description="尺寸分组")
    service_level: str = Field(..., description="服务等级")
    logistics_provider: str = Field(..., description="物流商代码")
    delivery_method: str = Field(..., description="配送方式（用于下拉显示）")
    ozon_rating: Optional[int] = Field(None, description="OZON评级")
    transit_days: Optional[str] = Field(None, description="时效")
    rate: str = Field(..., description="费率公式")
    battery_allowed: bool = Field(False, description="是否允许带电")
    liquid_allowed: bool = Field(False, description="是否允许液体")
    size_limit: Optional[str] = Field(None, description="尺寸限制")
    weight_min_g: Optional[int] = Field(None, description="最小重量(g)")
    weight_max_g: Optional[int] = Field(None, description="最大重量(g)")


class ShippingRateListResponse(BaseModel):
    """物流费率列表响应"""
    items: List[ShippingRateListItem]
    total: int


@router.get(
    "/list",
    response_model=ShippingRateListResponse,
    summary="获取物流费率列表"
)
async def get_shipping_rates_list(
    size_group: Optional[str] = Query(None, description="尺寸分组筛选"),
    service_level: Optional[str] = Query(None, description="服务等级筛选"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    获取物流费率完整列表（用于定价器下拉选择）
    """
    query = select(OzonShippingRate)

    if size_group:
        query = query.where(OzonShippingRate.size_group == size_group)
    if service_level:
        query = query.where(OzonShippingRate.service_level == service_level)

    query = query.order_by(
        OzonShippingRate.size_group,
        OzonShippingRate.service_level,
        OzonShippingRate.ozon_rating
    )

    result = await db.execute(query)
    rates = result.scalars().all()

    items = [
        ShippingRateListItem(
            id=r.id,
            size_group=r.size_group,
            service_level=r.service_level,
            logistics_provider=r.logistics_provider,
            delivery_method=r.delivery_method,
            ozon_rating=r.ozon_rating,
            transit_days=r.transit_days,
            rate=r.rate,
            battery_allowed=r.battery_allowed or False,
            liquid_allowed=r.liquid_allowed or False,
            size_limit=r.size_limit,
            weight_min_g=r.weight_min_g,
            weight_max_g=r.weight_max_g,
        )
        for r in rates
    ]

    return ShippingRateListResponse(items=items, total=len(items))


@router.get(
    "/providers",
    response_model=LogisticsProviderResponse,
    summary="获取物流商列表"
)
async def get_logistics_providers(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    获取所有物流商代码列表（用于下拉选择）
    """
    query = select(distinct(OzonShippingRate.logistics_provider)).order_by(
        OzonShippingRate.logistics_provider
    )
    result = await db.execute(query)
    providers = result.scalars().all()

    return LogisticsProviderResponse(providers=list(providers))


@router.get(
    "/size-groups",
    response_model=List[str],
    summary="获取尺寸分组列表"
)
async def get_size_groups(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    获取所有尺寸分组列表
    """
    query = select(distinct(OzonShippingRate.size_group)).order_by(
        OzonShippingRate.size_group
    )
    result = await db.execute(query)
    groups = result.scalars().all()

    return list(groups)


@router.post(
    "/calculate-price",
    response_model=PricingCalculatorResponse,
    summary="计算建议售价"
)
async def calculate_price(
    request: PricingCalculatorRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    定价器：根据成本、利润率、重量、尺寸和物流商计算建议售价

    计算公式: P = (C + L) × R / (1 - F - M)

    - P = 建议售价（卢布）
    - C = 商品成本（元）
    - L = 物流费用（元）
    - R = 汇率（CNY→RUB）
    - F = 平台佣金率（根据价格档位选择）
    - M = 预期利润率
    """
    warnings = []

    # 默认值
    exchange_rate = request.exchange_rate or 13.5
    commission_tier1 = request.commission_tier1 if request.commission_tier1 is not None else 14.0
    commission_tier2 = request.commission_tier2 if request.commission_tier2 is not None else 17.0
    commission_tier3 = request.commission_tier3 if request.commission_tier3 is not None else 20.0

    # 匹配尺寸分组
    size_group = match_size_group(
        request.weight,
        request.length,
        request.width,
        request.height
    )

    # 查询该物流商在匹配尺寸分组下的所有费率
    query = select(OzonShippingRate).where(
        OzonShippingRate.logistics_provider == request.logistics_provider,
        OzonShippingRate.size_group == size_group
    ).order_by(OzonShippingRate.service_level)

    result = await db.execute(query)
    rates = result.scalars().all()

    if not rates:
        # 尝试查找其他分组
        warnings.append(f"物流商 {request.logistics_provider} 在 {size_group} 分组下无费率数据，尝试其他分组")

        query = select(OzonShippingRate).where(
            OzonShippingRate.logistics_provider == request.logistics_provider
        ).order_by(OzonShippingRate.size_group, OzonShippingRate.service_level)

        result = await db.execute(query)
        rates = result.scalars().all()

        if rates:
            # 使用第一个可用的分组
            size_group = rates[0].size_group
            rates = [r for r in rates if r.size_group == size_group]
            warnings.append(f"使用备选分组: {size_group}")

    # 计算各服务等级的建议售价
    results = []
    seen_levels = set()

    for rate in rates:
        # 去重（同一服务等级可能有多条记录）
        if rate.service_level in seen_levels:
            continue
        seen_levels.add(rate.service_level)

        # 解析费率
        base_fee, per_gram_rate = parse_rate_formula(rate.rate)

        # 计算物流费用
        shipping_cost = base_fee + per_gram_rate * request.weight

        # 计算建议售价
        price_rub, actual_commission, price_tier = calculate_suggested_price(
            cost=request.cost,
            shipping_cost=shipping_cost,
            profit_rate=request.profit_rate,
            commission_tier1=commission_tier1,
            commission_tier2=commission_tier2,
            commission_tier3=commission_tier3,
            exchange_rate=exchange_rate,
        )

        # 转换为人民币
        price_rmb = price_rub / exchange_rate if price_rub != float('inf') else float('inf')

        # 构建重量范围显示
        weight_range = None
        if rate.weight_min_g is not None or rate.weight_max_g is not None:
            min_g = rate.weight_min_g or 0
            max_g = rate.weight_max_g or 30000
            weight_range = f"{min_g}g - {max_g}g"

        results.append(SuggestedPriceResult(
            service_level=rate.service_level,
            shipping_cost=round(shipping_cost, 2),
            suggested_price_rub=round(price_rub, 2) if price_rub != float('inf') else -1,
            suggested_price_rmb=round(price_rmb, 2) if price_rmb != float('inf') else -1,
            commission_rate=actual_commission,
            price_tier=price_tier,
            transit_days=rate.transit_days,
            battery_allowed=rate.battery_allowed or False,
            liquid_allowed=rate.liquid_allowed or False,
            size_limit=rate.size_limit,
            weight_range=weight_range,
            value_limit_rub=rate.value_limit_rub,
            value_limit_cny=rate.value_limit_cny,
        ))

    # 按服务等级排序：Express > Standard > Economy
    level_order = {"Express": 0, "Standard": 1, "Economy": 2}
    results.sort(key=lambda x: level_order.get(x.service_level, 99))

    return PricingCalculatorResponse(
        size_group=size_group,
        results=results,
        warnings=warnings,
    )
