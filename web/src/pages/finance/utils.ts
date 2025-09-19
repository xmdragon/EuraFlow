/**
 * 利润计算工具函数
 */

import { ScenarioConfig } from './constants';

export interface CalculationData {
  // 用户输入
  cost?: number; // 成本（RMB）
  price?: number; // 售价（RMB）
  weight?: number; // 重量（克）

  // 可编辑的费用
  platformRate?: number; // 平台扣点率（小数形式，如0.14表示14%）
  shipping?: number; // 运费（RMB）
  packingFee?: number; // 打包费（RMB）

  // 自动计算结果
  platformFee?: number; // 平台扣点金额
  profit?: number; // 利润（RMB）
  profitRate?: number; // 利润率（小数形式）
}

/**
 * 计算默认运费
 */
export function calculateDefaultShipping(
  weight: number | undefined,
  scenario: ScenarioConfig
): number | undefined {
  if (!weight || weight <= 0) {
    return undefined;
  }

  const { base, rate } = scenario.shipping;
  return Number((base + rate * weight).toFixed(2));
}

/**
 * 计算利润和利润率
 */
export function calculateProfit(data: CalculationData): CalculationData {
  const { cost, price, platformRate, shipping, packingFee } = data;

  // 如果缺少必要参数，返回原数据
  if (!price || !cost || platformRate === undefined || !shipping || packingFee === undefined) {
    return {
      ...data,
      platformFee:
        price && platformRate !== undefined ? Number((price * platformRate).toFixed(2)) : undefined,
      profit: undefined,
      profitRate: undefined,
    };
  }

  // 计算平台扣点金额
  const platformFee = Number((price * platformRate).toFixed(2));

  // 计算利润 = 售价 - 成本 - 运费 - 平台扣点 - 打包费
  const profit = Number((price - cost - shipping - platformFee - packingFee).toFixed(2));

  // 计算利润率 = 利润 / 售价
  const profitRate = price > 0 ? Number((profit / price).toFixed(4)) : 0;

  return {
    ...data,
    platformFee,
    profit,
    profitRate,
  };
}

/**
 * 格式化百分比显示
 */
export function formatPercentage(value: number | undefined): string {
  if (value === undefined) {
    return '--';
  }
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * 格式化金额显示
 */
export function formatMoney(value: number | undefined): string {
  if (value === undefined) {
    return '--';
  }
  return value.toFixed(2);
}

/**
 * 验证输入是否符合场景条件
 */
export function validateInput(
  data: CalculationData,
  scenario: ScenarioConfig
): {
  isValid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const { weight, price } = data;
  const { conditions } = scenario;

  // 验证重量
  if (weight !== undefined) {
    if (conditions.minWeight && weight < conditions.minWeight) {
      warnings.push(`重量低于该场景最小值 ${conditions.minWeight}g`);
    }
    if (conditions.maxWeight && weight > conditions.maxWeight) {
      warnings.push(`重量超过该场景最大值 ${conditions.maxWeight}g`);
    }
  }

  // 验证价格
  if (price !== undefined) {
    if (conditions.minPrice && price < conditions.minPrice) {
      warnings.push(`售价低于该场景最小值 ${conditions.minPrice} RMB`);
    }
    if (conditions.maxPrice && price > conditions.maxPrice) {
      warnings.push(`售价超过该场景最大值 ${conditions.maxPrice} RMB`);
    }
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  };
}
