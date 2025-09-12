"""
利润计算器 - 计算商品利润和优化建议
"""

from decimal import Decimal, ROUND_HALF_UP, ROUND_UP
from typing import Optional
from uuid import uuid4

from ef_core.utils.logging import get_logger

from ..models.enums import ServiceType, Platform, CarrierService
from ..models.profit import ProfitRequest, ProfitResult, ProfitOptimization, MarginAnalysis
from ..models.shipping import ShippingRequest, ShippingFlags
from .shipping_calculator import ShippingCalculator
from .rate_manager import RateManager
from .scenario_classifier import ScenarioClassifier

logger = get_logger(__name__)


class ProfitCalculator:
    """利润计算器"""

    # 利润率阈值
    PROFIT_RATE_THRESHOLDS = {
        "excellent": Decimal("0.30"),  # 30%以上
        "good": Decimal("0.20"),  # 20-30%
        "acceptable": Decimal("0.10"),  # 10-20%
        "poor": Decimal("0.05"),  # 5-10%
    }

    def __init__(
        self,
        shipping_calculator: Optional[ShippingCalculator] = None,
        rate_manager: Optional[RateManager] = None,
        scenario_classifier: Optional[ScenarioClassifier] = None,
    ):
        """
        初始化利润计算器

        Args:
            shipping_calculator: 运费计算器
            rate_manager: 费率管理器
            scenario_classifier: 场景分类器
        """
        self.shipping_calculator = shipping_calculator or ShippingCalculator()
        self.rate_manager = rate_manager or RateManager()
        self.scenario_classifier = scenario_classifier or ScenarioClassifier()

    def calculate(self, request: ProfitRequest) -> ProfitResult:
        """
        计算利润

        Args:
            request: 利润计算请求

        Returns:
            利润计算结果
        """
        try:
            # 1. 获取平台费率
            if request.platform_fee_rate is None:
                fee_data = self.rate_manager.get_platform_fee(
                    request.platform, request.category_code or "default", request.fulfillment_model
                )
                platform_fee_rate = Decimal(str(fee_data["fee_rate"]))
            else:
                platform_fee_rate = request.platform_fee_rate

            # 2. 计算平台费
            platform_fee = (request.selling_price * platform_fee_rate).quantize(Decimal("0.01"), ROUND_HALF_UP)

            # 3. 计算运费方案
            shipping_options = {}
            recommended_shipping = None
            selected_shipping_cost = Decimal("0")

            if request.compare_shipping:
                # 构造运费请求
                shipping_req = self._create_shipping_request(request)

                # 计算多种运费方案
                service_types = [ServiceType.EXPRESS, ServiceType.STANDARD, ServiceType.ECONOMY]

                shipping_results = self.shipping_calculator.calculate_multiple(shipping_req, service_types)

                # 保存运费方案
                for result in shipping_results:
                    if not result.rejected:
                        shipping_options[result.service_type.value] = result

                # 推荐最优方案
                if shipping_options:
                    recommended = self.shipping_calculator.recommend_service(list(shipping_options.values()))
                    if recommended:
                        recommended_shipping = recommended.service_type.value
                        selected_shipping_cost = recommended.total_cost

            # 如果用户指定了首选服务
            if request.preferred_service and request.preferred_service in shipping_options:
                recommended_shipping = request.preferred_service
                selected_shipping_cost = shipping_options[request.preferred_service].total_cost

            # 4. 计算利润
            profit_amount = (request.selling_price - request.cost - selected_shipping_cost - platform_fee).quantize(
                Decimal("0.01"), ROUND_HALF_UP
            )

            # 5. 计算利润率
            if request.selling_price > 0:
                profit_rate = (profit_amount / request.selling_price).quantize(Decimal("0.0001"), ROUND_HALF_UP)
            else:
                profit_rate = Decimal("0")

            # 6. 场景分类
            scenario = self.scenario_classifier.classify(request.weight_g, request.dimensions, request.selling_price)

            # 7. 毛利分析
            margin_analysis = self._analyze_margin(
                request.cost, request.selling_price, platform_fee, selected_shipping_cost, profit_amount, profit_rate
            )

            # 8. 构造结果
            result = ProfitResult(
                request_id=str(uuid4()),
                sku=request.sku,
                platform=request.platform,
                cost=request.cost,
                selling_price=request.selling_price,
                platform_fee=platform_fee,
                platform_fee_rate=platform_fee_rate,
                shipping_options=shipping_options,
                recommended_shipping=recommended_shipping,
                selected_shipping_cost=selected_shipping_cost,
                profit_amount=profit_amount,
                profit_rate=profit_rate,
                scenario=scenario,
                margin_analysis=margin_analysis,
            )

            # 9. 添加优化建议
            self._add_optimizations(result, request)

            # 10. 添加警告
            self._add_warnings(result)

            # 量化金额
            result.quantize_amounts()

            return result

        except Exception as e:
            logger.error(f"Profit calculation error: {e}", exc_info=True)
            raise

    def _create_shipping_request(self, profit_request: ProfitRequest) -> ShippingRequest:
        """
        从利润请求创建运费请求

        Args:
            profit_request: 利润请求

        Returns:
            运费请求
        """
        # 根据平台确定承运商
        carrier_map = {
            Platform.OZON: CarrierService.UNI_OZON,
            Platform.WILDBERRIES: CarrierService.UNI_WB,
            Platform.YANDEX: CarrierService.UNI_YANDEX,
        }

        carrier_service = carrier_map.get(profit_request.platform, CarrierService.UNI_YANDEX)

        return ShippingRequest(
            platform=profit_request.platform,
            carrier_service=carrier_service,
            service_type=ServiceType.STANDARD,  # 默认标准服务
            weight_g=profit_request.weight_g,
            dimensions=profit_request.dimensions,
            declared_value=profit_request.selling_price,
            selling_price=profit_request.selling_price,
            fulfillment_model=profit_request.fulfillment_model,
            category_code=profit_request.category_code,
            flags=ShippingFlags(),  # 默认无特殊标记
        )

    def _analyze_margin(
        self,
        cost: Decimal,
        selling_price: Decimal,
        platform_fee: Decimal,
        shipping_cost: Decimal,
        profit_amount: Decimal,
        profit_rate: Decimal,
    ) -> MarginAnalysis:
        """
        分析毛利

        Args:
            cost: 成本
            selling_price: 售价
            platform_fee: 平台费
            shipping_cost: 运费
            profit_amount: 利润额
            profit_rate: 利润率

        Returns:
            毛利分析
        """
        # 毛利 = 售价 - 成本
        gross_margin = selling_price - cost
        gross_margin_rate = (gross_margin / selling_price) if selling_price > 0 else Decimal("0")

        # 成本构成
        cost_breakdown = {"product_cost": cost, "platform_fee": platform_fee, "shipping_cost": shipping_cost}

        # 判断毛利水平
        if profit_rate >= self.PROFIT_RATE_THRESHOLDS["excellent"]:
            margin_level = "excellent"
        elif profit_rate >= self.PROFIT_RATE_THRESHOLDS["good"]:
            margin_level = "good"
        elif profit_rate >= self.PROFIT_RATE_THRESHOLDS["acceptable"]:
            margin_level = "acceptable"
        elif profit_rate >= self.PROFIT_RATE_THRESHOLDS["poor"]:
            margin_level = "poor"
        else:
            margin_level = "loss"

        return MarginAnalysis(
            gross_margin=gross_margin,
            gross_margin_rate=gross_margin_rate,
            cost_breakdown=cost_breakdown,
            margin_level=margin_level,
        )

    def _add_optimizations(self, result: ProfitResult, request: ProfitRequest):
        """
        添加优化建议

        Args:
            result: 利润结果
            request: 利润请求
        """
        # 如果利润率低于10%，建议提价
        if result.profit_rate < Decimal("0.10"):
            # 计算达到10%利润率的建议售价
            target_profit_rate = Decimal("0.10")
            # 售价 = (成本 + 运费) / (1 - 平台费率 - 目标利润率)
            total_cost = request.cost + result.selected_shipping_cost
            suggested_price = (total_cost / (1 - result.platform_fee_rate - target_profit_rate)).quantize(
                Decimal("1"), ROUND_UP
            )  # 向上取整到整数

            # 计算预期利润
            expected_platform_fee = suggested_price * result.platform_fee_rate
            expected_profit = suggested_price - request.cost - result.selected_shipping_cost - expected_platform_fee
            expected_profit_rate = expected_profit / suggested_price if suggested_price > 0 else Decimal("0")

            optimization = ProfitOptimization(
                suggested_price=suggested_price,
                expected_profit=expected_profit,
                expected_profit_rate=expected_profit_rate,
                price_adjustment=suggested_price - request.selling_price,
                optimization_reason=f"建议提价以达到{int(target_profit_rate * 100)}%目标利润率",
            )

            result.add_optimization(optimization)

        # 如果有更便宜的运费方案
        if result.shipping_options:
            cheapest_option = min(result.shipping_options.values(), key=lambda x: x.total_cost)

            if cheapest_option.service_type.value != result.recommended_shipping:
                potential_saving = result.selected_shipping_cost - cheapest_option.total_cost
                if potential_saving > Decimal("10"):  # 如果能节省超过10卢布
                    new_profit = result.profit_amount + potential_saving
                    new_profit_rate = new_profit / request.selling_price if request.selling_price > 0 else Decimal("0")

                    optimization = ProfitOptimization(
                        suggested_price=request.selling_price,
                        expected_profit=new_profit,
                        expected_profit_rate=new_profit_rate,
                        price_adjustment=Decimal("0"),
                        optimization_reason=f"使用{cheapest_option.service_type.value}服务可节省运费{potential_saving:.2f}卢布",
                    )

                    result.add_optimization(optimization)

    def _add_warnings(self, result: ProfitResult):
        """
        添加警告信息

        Args:
            result: 利润结果
        """
        # 亏损警告
        if result.profit_amount < 0:
            result.add_warning(f"当前定价亏损{abs(result.profit_amount):.2f}卢布")

        # 低利润率警告
        elif result.profit_rate < Decimal("0.05"):
            result.add_warning(f"利润率过低({result.profit_rate_percent})，建议调整定价")

        # 无运费方案警告
        if not result.shipping_options:
            result.add_warning("无可用运费方案，请检查商品规格")

        # 平台费过高警告
        if result.platform_fee_rate > Decimal("0.20"):
            result.add_warning(f"平台费率较高({result.platform_fee_rate * 100:.1f}%)，注意成本控制")

    def calculate_break_even_price(self, cost: Decimal, shipping_cost: Decimal, platform_fee_rate: Decimal) -> Decimal:
        """
        计算保本价格

        Args:
            cost: 成本
            shipping_cost: 运费
            platform_fee_rate: 平台费率

        Returns:
            保本价格
        """
        # 保本价格 = (成本 + 运费) / (1 - 平台费率)
        if platform_fee_rate >= 1:
            return Decimal("999999")  # 费率100%或以上无法计算

        total_cost = cost + shipping_cost
        break_even = (total_cost / (1 - platform_fee_rate)).quantize(Decimal("0.01"), ROUND_UP)

        return break_even

    def calculate_target_price(
        self, cost: Decimal, shipping_cost: Decimal, platform_fee_rate: Decimal, target_profit_rate: Decimal
    ) -> Decimal:
        """
        计算目标价格（达到指定利润率）

        Args:
            cost: 成本
            shipping_cost: 运费
            platform_fee_rate: 平台费率
            target_profit_rate: 目标利润率

        Returns:
            目标价格
        """
        # 目标价格 = (成本 + 运费) / (1 - 平台费率 - 目标利润率)
        denominator = 1 - platform_fee_rate - target_profit_rate

        if denominator <= 0:
            return Decimal("999999")  # 无法达到目标利润率

        total_cost = cost + shipping_cost
        target_price = (total_cost / denominator).quantize(Decimal("1"), ROUND_UP)

        return target_price
