/**
 * OZON 选品助手 - 格式化工具函数
 *
 * 提供商品数据的统一格式化方法
 */

import { formatNumber as formatNumberUtil } from '@/utils/formatNumber';

/**
 * 格式化价格（OZON采集的是分，需要除以100转换为元）
 * @param priceInFen 价格（分）
 * @returns 格式化后的价格字符串
 */
export const formatPrice = (priceInFen: number | null | undefined): string => {
  if (priceInFen === null || priceInFen === undefined) return '0';
  return formatNumberUtil(priceInFen / 100);
};

/**
 * 格式化百分比显示（不显示%符号）
 * @param value 百分比值
 * @returns 格式化后的百分比字符串
 */
export const formatPercentage = (value: number | null | undefined): string => {
  if (value === null || value === undefined || value === 0) return '-';
  return `${value}`;
};

/**
 * 格式化数量显示
 * @param value 数量值
 * @returns 格式化后的数量字符串
 */
export const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  return value.toString();
};

/**
 * 格式化重量显示
 * @param value 重量值（克）
 * @returns 格式化后的重量字符串（克或千克）
 */
export const formatWeight = (value: number | null | undefined): string => {
  if (value === null || value === undefined || value === 0) return '-';
  if (value >= 1000) {
    return `${formatNumberUtil(value / 1000)}kg`;
  }
  return `${value}g`;
};

/**
 * 格式化货币（RUB → CNY）
 * @param rubAmount RUB金额
 * @param rate 汇率（CNY/RUB）
 * @returns 格式化后的CNY金额字符串
 */
export const formatCurrency = (
  rubAmount: number | null | undefined,
  rate: number | null
): string => {
  if (!rubAmount || !rate) return '-';
  const cny = rubAmount / rate;
  if (cny >= 10000) {
    return `${formatNumberUtil(cny / 10000)}万¥`;
  }
  return `${formatNumberUtil(cny)}¥`;
};

/**
 * 格式化百分比（带%符号，智能去除无意义的小数）
 * @param value 百分比值
 * @returns 格式化后的百分比字符串
 */
export const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  return `${formatNumberUtil(value)}%`;
};

/**
 * 格式化普通数字（带千分位）
 * @param value 数字值
 * @returns 格式化后的数字字符串
 */
export const formatNum = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  return value.toLocaleString();
};

/**
 * 格式化日期显示
 * @param dateStr 日期字符串
 * @returns 格式化后的日期字符串（YYYY-MM-DD）
 */
export const formatDate = (dateStr: string): string => {
  if (!dateStr) return '-';
  return new Date(dateStr)
    .toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .replace(/\//g, '-');
};
