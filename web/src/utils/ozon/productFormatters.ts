/**
 * OZON 选品助手 - 格式化工具函数
 *
 * 提供商品数据的统一格式化方法
 */

import { formatNumber as formatNumberUtil } from '@/utils/formatNumber';

/**
 * 格式化价格（已经是元为单位，无需转换）
 * @param price 价格（元）
 * @returns 格式化后的价格字符串
 */
export const formatPrice = (price: number | null | undefined): string => {
  if (price === null || price === undefined) return '0';
  return formatNumberUtil(price);
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
 * 格式化货币（固定显示 ₽，不转换货币）
 * @param rubAmount RUB金额（元）
 * @param _cnyToRubRate 汇率参数（保留兼容，不使用）
 * @returns 格式化后的RUB金额字符串
 */
export const formatCurrency = (
  rubAmount: number | null | undefined,
  _cnyToRubRate: number | null
): string => {
  if (!rubAmount) return '-';

  if (rubAmount >= 10000) {
    return `${formatNumberUtil(rubAmount / 10000)}万₽`;
  }
  return `${formatNumberUtil(rubAmount)}₽`;
};

/**
 * 格式化销售额（固定显示 ₽，不转换货币）
 * @param rubAmount RUB金额（元）
 * @param _cnyToRubRate 汇率参数（保留兼容，不使用）
 * @returns 格式化后的RUB金额字符串
 */
export const formatSalesRevenue = (
  rubAmount: number | null | undefined,
  _cnyToRubRate: number | null
): string => {
  if (!rubAmount) return '-';

  if (rubAmount >= 10000) {
    return `${formatNumberUtil(rubAmount / 10000)}万₽`;
  }
  return `${formatNumberUtil(rubAmount)}₽`;
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
