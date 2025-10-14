/**
 * 选品助手利润计算工具
 * 根据利润计算器算法，计算商品的成本上限
 */

import { SCENARIOS, ScenarioConfig } from '../finance/constants';

/**
 * 根据商品的重量和价格匹配对应的场景
 * @param weightG 商品重量（克）
 * @param priceRUB 商品价格（卢布）
 * @returns 匹配的场景配置，如果无法匹配则返回null
 */
export function matchScenario(weightG: number, priceRUB: number): ScenarioConfig | null {
  // 遍历所有场景，找到第一个满足条件的
  for (const scenario of SCENARIOS) {
    const { conditions } = scenario;

    // 检查重量是否满足
    const weightMatch =
      (conditions.minWeight === undefined || weightG >= conditions.minWeight) &&
      (conditions.maxWeight === undefined || weightG <= conditions.maxWeight);

    // 检查价格是否满足
    const priceMatch =
      (conditions.minPrice === undefined || priceRUB >= conditions.minPrice) &&
      (conditions.maxPrice === undefined || priceRUB <= conditions.maxPrice);

    // 如果同时满足重量和价格条件，返回该场景
    if (weightMatch && priceMatch) {
      return scenario;
    }
  }

  return null;
}

/**
 * 计算商品的成本上限
 * 公式：成本上限 = 售价 × (1 - 目标利润率 - 平台扣点率) - 运费 - 打包费
 *
 * @param priceRUB 商品售价（卢布）
 * @param weightG 商品重量（克）
 * @param targetProfitRate 目标利润率（小数形式，如 0.20 表示 20%）
 * @param packingFee 打包费（卢布）
 * @returns 成本上限（卢布），如果无法计算则返回null
 */
export function calculateMaxCost(
  priceRUB: number,
  weightG: number,
  targetProfitRate: number,
  packingFee: number
): number | null {
  // 参数验证
  if (priceRUB <= 0 || weightG <= 0 || targetProfitRate < 0 || packingFee < 0) {
    return null;
  }

  // 匹配场景
  const scenario = matchScenario(weightG, priceRUB);
  if (!scenario) {
    return null;
  }

  // 获取平台扣点率
  const platformRate = scenario.defaultPlatformRate;

  // 计算运费：运费 = 基础运费 + 费率 × 重量
  const shipping = scenario.shipping.base + scenario.shipping.rate * weightG;

  // 计算成本上限
  // maxCost = price × (1 - targetProfitRate - platformRate) - shipping - packingFee
  const maxCost = priceRUB * (1 - targetProfitRate - platformRate) - shipping - packingFee;

  return maxCost;
}

/**
 * 格式化成本上限显示
 * @param maxCost 成本上限（卢布）
 * @returns 格式化后的字符串
 */
export function formatMaxCost(maxCost: number | null): string {
  if (maxCost === null || maxCost === undefined) {
    return '--';
  }

  if (maxCost < 0) {
    return '无法达到目标利润率';
  }

  return maxCost.toFixed(2);
}
