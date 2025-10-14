/**
 * 选品助手利润计算工具
 * 根据利润计算器算法，计算商品的成本上限
 */

import { SCENARIOS, ScenarioConfig } from '../finance/constants';

/**
 * 商品佣金率数据接口
 */
export interface ProductCommissionRates {
  rfbs_low?: number;   // rFBS(<=1500₽)佣金率 (百分比，如12表示12%)
  rfbs_mid?: number;   // rFBS(1501-5000₽)佣金率
  rfbs_high?: number;  // rFBS(>5000₽)佣金率
}

/**
 * 根据商品价格选择对应的rFBS佣金率档位
 * OZON佣金分档（基于RUB）：
 * - 售价 <= 1500₽: 使用 rfbs_low
 * - 售价 1501~5000₽: 使用 rfbs_mid
 * - 售价 > 5000₽: 使用 rfbs_high
 *
 * @param priceRMB 商品价格（RMB元）
 * @param commissionRates 商品的三档佣金率数据
 * @param exchangeRate 汇率（CNY→RUB），用于将RUB档位阈值转换为RMB
 * @returns 选中的佣金率（小数形式，如0.12表示12%），如果没有数据则返回null
 */
export function selectCommissionRate(
  priceRMB: number,
  commissionRates: ProductCommissionRates | undefined,
  exchangeRate: number | undefined
): number | null {
  // 如果没有提供佣金率数据或汇率，返回null
  if (!commissionRates || !exchangeRate || exchangeRate <= 0) {
    return null;
  }

  // 将OZON的RUB档位阈值转换为RMB阈值
  const threshold1_RMB = 1500 / exchangeRate;  // 1500₽ → RMB
  const threshold2_RMB = 5000 / exchangeRate;  // 5000₽ → RMB

  // 根据商品的RMB价格选择对应的佣金率档位
  if (priceRMB <= threshold1_RMB) {
    // 低档：<= 1500₽
    return commissionRates.rfbs_low !== undefined ? commissionRates.rfbs_low / 100 : null;
  } else if (priceRMB <= threshold2_RMB) {
    // 中档：1501~5000₽
    return commissionRates.rfbs_mid !== undefined ? commissionRates.rfbs_mid / 100 : null;
  } else {
    // 高档：> 5000₽
    return commissionRates.rfbs_high !== undefined ? commissionRates.rfbs_high / 100 : null;
  }
}

/**
 * 根据商品的重量和价格匹配对应的场景
 * @param weightG 商品重量（克）
 * @param priceRMB 商品价格（人民币）
 * @param exchangeRate 汇率（CNY→RUB），用于将场景的RUB价格范围转换为RMB
 * @returns 匹配的场景配置，如果无法匹配则返回null
 */
export function matchScenario(
  weightG: number,
  priceRMB: number,
  exchangeRate?: number
): ScenarioConfig | null {
  // 遍历所有场景，找到第一个满足条件的
  for (const scenario of SCENARIOS) {
    const { conditions } = scenario;

    // 检查重量是否满足
    const weightMatch =
      (conditions.minWeight === undefined || weightG >= conditions.minWeight) &&
      (conditions.maxWeight === undefined || weightG <= conditions.maxWeight);

    // 检查价格是否满足
    // 场景条件中的价格是 RUB，需要转换为 RMB 后再匹配
    let minPriceRMB = conditions.minPrice;
    let maxPriceRMB = conditions.maxPrice;

    if (exchangeRate && exchangeRate > 0) {
      // 将场景的 RUB 价格范围转换为 RMB：RUB ÷ 汇率 = RMB
      minPriceRMB = conditions.minPrice !== undefined ? conditions.minPrice / exchangeRate : undefined;
      maxPriceRMB = conditions.maxPrice !== undefined ? conditions.maxPrice / exchangeRate : undefined;
    }

    const priceMatch =
      (minPriceRMB === undefined || priceRMB >= minPriceRMB) &&
      (maxPriceRMB === undefined || priceRMB <= maxPriceRMB);

    // 如果同时满足重量和价格条件，返回该场景
    if (weightMatch && priceMatch) {
      return scenario;
    }
  }

  return null;
}

/**
 * 计算商品的成本上限
 *
 * 公式推导（来自利润计算器）：
 * 利润 = 售价 - 成本 - 运费 - 平台扣点 - 打包费
 * 目标利润 = 售价 × 目标利润率
 * 平台扣点 = 售价 × 平台扣点率
 *
 * 反推成本：
 * 成本 = 售价 × (1 - 目标利润率 - 平台扣点率) - 运费 - 打包费
 *
 * @param priceRMB 商品售价（人民币）
 * @param weightG 商品重量（克）
 * @param targetProfitRate 目标利润率（小数形式，如 0.20 表示 20%）
 * @param packingFee 打包费（人民币）
 * @param exchangeRate 汇率（CNY→RUB），用于正确匹配场景和选择佣金率档位
 * @param commissionRates 商品的rFBS佣金率数据（可选，优先使用商品实际佣金率）
 * @returns 成本上限（人民币），如果无法计算则返回null
 */
export function calculateMaxCost(
  priceRMB: number,
  weightG: number,
  targetProfitRate: number,
  packingFee: number,
  exchangeRate?: number,
  commissionRates?: ProductCommissionRates
): number | null {
  // 参数验证
  if (priceRMB <= 0 || weightG <= 0 || targetProfitRate < 0 || packingFee < 0) {
    return null;
  }

  // 匹配场景（传入汇率以正确转换场景的RUB价格范围为RMB）
  const scenario = matchScenario(weightG, priceRMB, exchangeRate);
  if (!scenario) {
    return null;
  }

  // 选择平台扣点率：
  // 1. 优先使用商品实际的rFBS佣金率（根据价格档位自动选择）
  // 2. 如果商品没有佣金率数据，使用场景配置的默认平台扣点率
  let platformRate = scenario.defaultPlatformRate;

  if (exchangeRate && exchangeRate > 0) {
    const selectedRate = selectCommissionRate(priceRMB, commissionRates, exchangeRate);
    if (selectedRate !== null) {
      platformRate = selectedRate;
    }
  }

  // 计算运费：运费(RMB) = 基础运费 + 费率 × 重量(克)
  const shipping = scenario.shipping.base + scenario.shipping.rate * weightG;

  // 计算成本上限（RMB）
  // maxCost = price × (1 - targetProfitRate - platformRate) - shipping - packingFee
  const maxCost = priceRMB * (1 - targetProfitRate - platformRate) - shipping - packingFee;

  return maxCost;
}

/**
 * 格式化成本上限显示
 * @param maxCost 成本上限（人民币）
 * @returns 格式化后的字符串
 */
export function formatMaxCost(maxCost: number | null): string {
  if (maxCost === null || maxCost === undefined) {
    return '--';
  }

  if (maxCost < 0) {
    return '无法盈利';
  }

  return maxCost.toFixed(2);
}
