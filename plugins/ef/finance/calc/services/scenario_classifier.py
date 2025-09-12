"""
场景分类器 - 根据商品属性判断运费场景
"""

from decimal import Decimal
from typing import Dict, Any, Optional

from ..models.enums import ScenarioType
from ..models.shipping import Dimensions


class ScenarioClassifier:
    """场景分类器"""

    def __init__(self, scenario_rules: Optional[Dict[str, Any]] = None):
        """
        初始化场景分类器

        Args:
            scenario_rules: 场景规则配置
        """
        if scenario_rules is None:
            # 默认规则
            scenario_rules = {
                "weight_thresholds": {"super_light": 500, "light": 2000, "standard": 5000, "large": 25000},
                "value_thresholds": {"low": 1500, "medium": 7000, "high": 15000},
                "dimension_rules": {
                    "super_small": {"max_three_sides": 90, "max_side": 60},
                    "small": {"max_three_sides": 150, "max_side": 60},
                    "medium": {"max_three_sides": 250, "max_side": 150},
                    "large": {"max_three_sides": 310, "max_side": 150},
                },
            }

        self.weight_thresholds = scenario_rules.get("weight_thresholds", {})
        self.value_thresholds = scenario_rules.get("value_thresholds", {})
        self.dimension_rules = scenario_rules.get("dimension_rules", {})

    def classify(self, weight_g: int, dimensions: Dimensions, value_rub: Decimal) -> ScenarioType:
        """
        分类场景

        Args:
            weight_g: 重量（克）
            dimensions: 尺寸
            value_rub: 商品价值（卢布）

        Returns:
            场景类型
        """
        # 获取尺寸属性
        three_sides = dimensions.three_sides_sum
        max_side = dimensions.max_side

        # 高价值商品判断（>7000卢布）
        if value_rub > self.value_thresholds.get("medium", 7000):
            if weight_g <= self.weight_thresholds.get("standard", 5000):
                return ScenarioType.HIGH_VALUE_LIGHT
            else:
                return ScenarioType.HIGH_VALUE_LARGE

        # 超级轻小件：三边≤90cm，最长边≤60cm，≤500g，<1500卢布
        if (
            three_sides <= self.dimension_rules["super_small"]["max_three_sides"]
            and max_side <= self.dimension_rules["super_small"]["max_side"]
            and weight_g <= self.weight_thresholds["super_light"]
            and value_rub < self.value_thresholds["low"]
        ):
            return ScenarioType.SUPER_LIGHT_SMALL

        # 轻小件：三边≤150cm，最长边≤60cm，1g-2kg，1500-7000卢布
        if (
            three_sides <= self.dimension_rules["small"]["max_three_sides"]
            and max_side <= self.dimension_rules["small"]["max_side"]
            and 1 <= weight_g <= self.weight_thresholds["light"]
            and self.value_thresholds["low"] <= value_rub <= self.value_thresholds["medium"]
        ):
            return ScenarioType.LIGHT_SMALL

        # 大件：三边≤250cm，最长边≤150cm，2.1kg-25kg
        if (
            three_sides <= self.dimension_rules["medium"]["max_three_sides"]
            and max_side <= self.dimension_rules["medium"]["max_side"]
            and self.weight_thresholds["light"] < weight_g <= self.weight_thresholds["large"]
        ):
            return ScenarioType.LARGE

        # 超大件：三边≤310cm，最长边≤150cm
        if (
            three_sides <= self.dimension_rules["large"]["max_three_sides"]
            and max_side <= self.dimension_rules["large"]["max_side"]
        ):
            return ScenarioType.LARGE

        # 默认标准件
        return ScenarioType.STANDARD

    def get_scenario_description(self, scenario: ScenarioType) -> str:
        """
        获取场景描述

        Args:
            scenario: 场景类型

        Returns:
            场景描述文本
        """
        descriptions = {
            ScenarioType.SUPER_LIGHT_SMALL: "超级轻小件（≤500g，三边≤90cm，<1500卢布）",
            ScenarioType.LIGHT_SMALL: "轻小件（1g-2kg，三边≤150cm，1500-7000卢布）",
            ScenarioType.STANDARD: "标准件",
            ScenarioType.LARGE: "大件（2.1kg-25kg，三边≤250cm）",
            ScenarioType.HIGH_VALUE_LIGHT: "高客单轻件（≤5kg，>7000卢布）",
            ScenarioType.HIGH_VALUE_LARGE: "高客单大件（>5kg，>7000卢布）",
        }

        return descriptions.get(scenario, "未知场景")

    def check_size_limits(
        self, dimensions: Dimensions, weight_g: int, size_limits: Dict[str, Any]
    ) -> tuple[bool, Optional[str]]:
        """
        检查尺寸限制

        Args:
            dimensions: 尺寸
            weight_g: 重量（克）
            size_limits: 限制配置

        Returns:
            (是否通过, 拒绝原因)
        """
        # 检查最长边
        max_length = size_limits.get("max_length_cm")
        if max_length and dimensions.max_side > max_length:
            return False, f"最长边超过限制：{dimensions.max_side}cm > {max_length}cm"

        # 检查三边之和
        max_three_sides = size_limits.get("max_three_sides_cm")
        if max_three_sides and dimensions.three_sides_sum > max_three_sides:
            return False, f"三边之和超过限制：{dimensions.three_sides_sum}cm > {max_three_sides}cm"

        # 检查重量
        max_weight_kg = size_limits.get("max_weight_kg")
        if max_weight_kg and weight_g > max_weight_kg * 1000:
            return False, f"重量超过限制：{weight_g/1000}kg > {max_weight_kg}kg"

        # 检查最小重量
        min_weight_kg = size_limits.get("min_weight_kg")
        if min_weight_kg and weight_g < min_weight_kg * 1000:
            return False, f"重量低于最小限制：{weight_g/1000}kg < {min_weight_kg}kg"

        return True, None

    def recommend_packaging(self, dimensions: Dimensions, weight_g: int, scenario: ScenarioType) -> Dict[str, Any]:
        """
        推荐包装建议

        Args:
            dimensions: 尺寸
            weight_g: 重量
            scenario: 场景类型

        Returns:
            包装建议
        """
        recommendations = {"scenario": scenario.value, "packaging_tips": []}

        # 根据场景给出建议
        if scenario == ScenarioType.SUPER_LIGHT_SMALL:
            recommendations["packaging_tips"].append("使用轻薄包装材料，避免增加体积")
            recommendations["packaging_tips"].append("考虑使用气泡信封")

        elif scenario == ScenarioType.HIGH_VALUE_LIGHT:
            recommendations["packaging_tips"].append("加强包装保护")
            recommendations["packaging_tips"].append("建议购买运输保险")
            recommendations["packaging_tips"].append("使用防震材料")

        elif scenario == ScenarioType.LARGE:
            recommendations["packaging_tips"].append("优化包装减少体积")
            recommendations["packaging_tips"].append("使用坚固的外箱")
            recommendations["packaging_tips"].append("注意重量分布均匀")

        # 体积优化建议
        volume_weight = (dimensions.volume_cm3 / 12000) * 1000  # 转换为克
        if volume_weight > weight_g * 1.5:
            recommendations["optimization"] = {
                "issue": "体积重量远大于实际重量",
                "volume_weight_g": float(volume_weight),
                "actual_weight_g": weight_g,
                "suggestion": "优化包装尺寸可显著降低运费",
            }

        return recommendations
