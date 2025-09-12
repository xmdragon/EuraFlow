"""
运费计算器 - 计算各种承运商的运费
"""

from decimal import Decimal, ROUND_UP, ROUND_HALF_UP
from datetime import datetime
from typing import Dict, List, Optional
from uuid import uuid4

from ef_core.utils.logging import get_logger

from ..models.enums import ServiceType, ScenarioType
from ..models.shipping import ShippingRequest, ShippingResult
from .rate_manager import RateManager
from .scenario_classifier import ScenarioClassifier

logger = get_logger(__name__)


class ShippingCalculator:
    """运费计算器"""

    def __init__(
        self, rate_manager: Optional[RateManager] = None, scenario_classifier: Optional[ScenarioClassifier] = None
    ):
        """
        初始化运费计算器

        Args:
            rate_manager: 费率管理器
            scenario_classifier: 场景分类器
        """
        self.rate_manager = rate_manager or RateManager()
        self.scenario_classifier = scenario_classifier or ScenarioClassifier()

    def calculate(self, request: ShippingRequest) -> ShippingResult:
        """
        计算运费

        Args:
            request: 运费计算请求

        Returns:
            运费计算结果
        """
        try:
            # 1. 获取费率配置
            rates = self.rate_manager.get_shipping_rate(
                request.carrier_service.value, request.service_type, request.calc_date
            )

            # 2. 计算体积重量
            volumetric_divisor = Decimal(str(rates["meta"].get("volumetric_divisor", 12000)))
            volume_weight_kg = (
                request.dimensions.length_cm * request.dimensions.width_cm * request.dimensions.height_cm
            ) / volumetric_divisor

            # 3. 确定计费重量
            actual_weight_kg = Decimal(request.weight_g) / 1000
            chargeable_weight_kg = max(actual_weight_kg, volume_weight_kg)

            # 4. 获取服务配置
            service_key = request.service_type.value.upper()
            service_rates = rates["services"].get(service_key)

            if not service_rates:
                raise ValueError(f"Service {service_key} not found in rates")

            # 5. 检查尺寸限制
            size_limits = service_rates.get("size_limits", {})
            is_valid, rejection_reason = self.scenario_classifier.check_size_limits(
                request.dimensions, request.weight_g, size_limits
            )

            if not is_valid:
                return self._create_rejected_result(
                    request, rejection_reason, actual_weight_kg, volume_weight_kg, chargeable_weight_kg, rates
                )

            # 6. 应用重量步进
            weight_step = Decimal(str(service_rates.get("weight_step_kg", 1.0)))
            rounding_mode = service_rates.get("rounding", "ceil")

            if rounding_mode == "ceil":
                rounded_weight = self._ceil_to_step(chargeable_weight_kg, weight_step)
            else:
                rounded_weight = chargeable_weight_kg

            # 7. 计算基础费用
            tiers = service_rates.get("tiers", [])
            base_cost, tier_info = self._calculate_tiered_cost(
                rounded_weight, tiers, service_rates.get("min_charge", 0)
            )

            # 8. 计算附加费
            surcharges = self._calculate_surcharges(request, service_rates.get("surcharges", {}), base_cost)

            # 9. 计算总费用
            total_cost = base_cost + sum(surcharges.values())

            # 10. 场景分类
            scenario = self.scenario_classifier.classify(request.weight_g, request.dimensions, request.selling_price)

            # 11. 构造结果
            result = ShippingResult(
                request_id=str(uuid4()),
                platform=request.platform,
                carrier_service=request.carrier_service,
                service_type=request.service_type,
                actual_weight_kg=actual_weight_kg.quantize(Decimal("0.001")),
                volume_weight_kg=volume_weight_kg.quantize(Decimal("0.001")),
                chargeable_weight_kg=chargeable_weight_kg.quantize(Decimal("0.001")),
                weight_step_kg=weight_step,
                rounded_weight_kg=rounded_weight,
                base_rate=Decimal(str(tier_info.get("base", 0))),
                weight_rate=Decimal(str(tier_info.get("per_kg", 0))),
                surcharges=surcharges,
                total_cost=total_cost.quantize(Decimal("0.01"), ROUND_HALF_UP),
                delivery_days_min=service_rates["delivery_days"]["min"],
                delivery_days_max=service_rates["delivery_days"]["max"],
                min_charge_applied=tier_info.get("min_charge_applied", False),
                oversize_applied=False,
                rejected=False,
                rejection_reason=None,
                scenario=scenario,
                rate_id=f"{request.carrier_service.value}_{request.service_type.value}",
                rate_version=rates["meta"]["version"],
                effective_from=datetime.strptime(rates["meta"]["effective_from"], "%Y-%m-%d"),
                calculation_details={
                    "volumetric_divisor": float(volumetric_divisor),
                    "tier_used": tier_info,
                    "rounding_mode": rounding_mode,
                    "scenario_desc": self.scenario_classifier.get_scenario_description(scenario),
                },
            )

            # 量化金额
            result.quantize_amounts()

            return result

        except Exception as e:
            logger.error(f"Shipping calculation error: {e}", exc_info=True)
            raise

    def calculate_multiple(
        self, request: ShippingRequest, service_types: Optional[List[ServiceType]] = None
    ) -> List[ShippingResult]:
        """
        计算多种服务类型的运费

        Args:
            request: 基础请求
            service_types: 要计算的服务类型列表

        Returns:
            运费结果列表
        """
        if service_types is None:
            service_types = [ServiceType.EXPRESS, ServiceType.STANDARD, ServiceType.ECONOMY]

        results = []
        for service_type in service_types:
            try:
                req = request.model_copy()
                req.service_type = service_type
                result = self.calculate(req)
                results.append(result)
            except Exception as e:
                logger.warning(f"Failed to calculate {service_type}: {e}")
                continue

        return results

    def recommend_service(
        self, results: List[ShippingResult], max_days: Optional[int] = None, budget: Optional[Decimal] = None
    ) -> Optional[ShippingResult]:
        """
        推荐最优服务

        Args:
            results: 运费结果列表
            max_days: 最大可接受天数
            budget: 预算限制

        Returns:
            推荐的服务
        """
        # 过滤掉被拒绝的
        valid_results = [r for r in results if not r.rejected]

        if not valid_results:
            return None

        # 应用时效过滤
        if max_days:
            valid_results = [r for r in valid_results if r.delivery_days_max <= max_days]

        # 应用预算过滤
        if budget:
            valid_results = [r for r in valid_results if r.total_cost <= budget]

        if not valid_results:
            return None

        # 按成本排序，选择最便宜的
        valid_results.sort(key=lambda x: (x.total_cost, x.delivery_days_min))

        return valid_results[0]

    def _ceil_to_step(self, weight: Decimal, step: Decimal) -> Decimal:
        """
        向上取整到步进

        Args:
            weight: 重量
            step: 步进单位

        Returns:
            步进后的重量
        """
        if step == 0:
            return weight

        return (weight / step).quantize(Decimal("1"), ROUND_UP) * step

    def _calculate_tiered_cost(self, weight_kg: Decimal, tiers: List[Dict], min_charge: float) -> tuple[Decimal, Dict]:
        """
        计算阶梯费用

        Args:
            weight_kg: 计费重量
            tiers: 阶梯配置
            min_charge: 最低收费

        Returns:
            (总费用, 阶梯信息)
        """
        if not tiers:
            return Decimal("0"), {}

        # 查找适用的阶梯
        tier_info = {}
        cost = Decimal("0")

        for tier in tiers:
            min_kg = Decimal(str(tier.get("min_kg", 0)))
            max_kg = Decimal(str(tier.get("max_kg", 999999)))

            if min_kg <= weight_kg <= max_kg:
                base = Decimal(str(tier.get("base", 0)))
                per_kg = Decimal(str(tier.get("per_kg", 0)))

                # 计算费用
                if per_kg > 0:
                    # 基础费 + 每公斤费用
                    cost = base + (weight_kg * per_kg)
                else:
                    # 固定费用
                    cost = base

                tier_info = {
                    "tier_range": f"{min_kg}-{max_kg}kg",
                    "base": float(base),
                    "per_kg": float(per_kg),
                    "weight_used": float(weight_kg),
                }
                break

        # 应用最低收费
        min_charge_dec = Decimal(str(min_charge))
        if cost < min_charge_dec:
            cost = min_charge_dec
            tier_info["min_charge_applied"] = True

        return cost, tier_info

    def _calculate_surcharges(
        self, request: ShippingRequest, surcharge_rules: Dict, base_cost: Decimal
    ) -> Dict[str, Decimal]:
        """
        计算附加费

        Args:
            request: 运费请求
            surcharge_rules: 附加费规则
            base_cost: 基础费用

        Returns:
            附加费字典
        """
        surcharges = {}

        # 电池附加费
        if request.flags.battery and "battery" in surcharge_rules:
            rule = surcharge_rules["battery"]
            rate = Decimal(str(rule.get("rate", 0)))
            min_charge = Decimal(str(rule.get("min", 0)))

            if rate > 0:
                charge = max(base_cost * rate, min_charge)
                surcharges["battery"] = charge.quantize(Decimal("0.01"), ROUND_HALF_UP)

        # 保险费
        if request.flags.insurance and request.flags.insurance_value:
            if "insurance" in surcharge_rules:
                rule = surcharge_rules["insurance"]
                rate = Decimal(str(rule.get("rate", 0.01)))
                min_charge = Decimal(str(rule.get("min", 20)))
                max_charge = rule.get("max")

                charge = max(request.flags.insurance_value * rate, min_charge)

                if max_charge:
                    charge = min(charge, Decimal(str(max_charge)))

                surcharges["insurance"] = charge.quantize(Decimal("0.01"), ROUND_HALF_UP)

        # 易碎品附加费
        if request.flags.fragile and "fragile" in surcharge_rules:
            rule = surcharge_rules["fragile"]
            surcharges["fragile"] = Decimal(str(rule.get("fee", 50))).quantize(Decimal("0.01"), ROUND_HALF_UP)

        # 液体附加费
        if request.flags.liquid and "liquid" in surcharge_rules:
            rule = surcharge_rules["liquid"]
            surcharges["liquid"] = Decimal(str(rule.get("fee", 100))).quantize(Decimal("0.01"), ROUND_HALF_UP)

        return surcharges

    def _create_rejected_result(
        self,
        request: ShippingRequest,
        rejection_reason: str,
        actual_weight_kg: Decimal,
        volume_weight_kg: Decimal,
        chargeable_weight_kg: Decimal,
        rates: Dict,
    ) -> ShippingResult:
        """
        创建拒绝结果

        Args:
            request: 请求
            rejection_reason: 拒绝原因
            actual_weight_kg: 实际重量
            volume_weight_kg: 体积重量
            chargeable_weight_kg: 计费重量
            rates: 费率配置

        Returns:
            拒绝的运费结果
        """
        return ShippingResult(
            request_id=str(uuid4()),
            platform=request.platform,
            carrier_service=request.carrier_service,
            service_type=request.service_type,
            actual_weight_kg=actual_weight_kg.quantize(Decimal("0.001")),
            volume_weight_kg=volume_weight_kg.quantize(Decimal("0.001")),
            chargeable_weight_kg=chargeable_weight_kg.quantize(Decimal("0.001")),
            weight_step_kg=Decimal("0"),
            rounded_weight_kg=Decimal("0"),
            base_rate=Decimal("0"),
            weight_rate=Decimal("0"),
            surcharges={},
            total_cost=Decimal("0"),
            delivery_days_min=0,
            delivery_days_max=0,
            rejected=True,
            rejection_reason=rejection_reason,
            scenario=ScenarioType.STANDARD,
            rate_id=f"{request.carrier_service.value}_{request.service_type.value}",
            rate_version=rates["meta"]["version"],
            effective_from=datetime.strptime(rates["meta"]["effective_from"], "%Y-%m-%d"),
        )
