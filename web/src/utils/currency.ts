/**
 * 货币格式化工具函数
 */

/**
 * 格式化货币金额，统一显示为2位小数
 * @param value - 金额值（支持 string、number 或 null/undefined）
 * @param prefix - 货币符号前缀，默认为 '¥'
 * @returns 格式化后的金额字符串
 */
export const formatCurrency = (
  value: string | number | null | undefined,
  prefix: string = '¥'
): string => {
  if (value === null || value === undefined || value === '') {
    return `${prefix}0.00`;
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(num)) {
    return `${prefix}0.00`;
  }

  // 确保精确到2位小数
  return `${prefix}${num.toFixed(2)}`;
};

/**
 * 格式化俄罗斯卢布
 * @param value - 金额值
 * @returns 格式化后的卢布金额字符串
 */
export const formatRuble = (value: string | number | null | undefined): string => {
  return formatCurrency(value, '₽');
};

/**
 * 格式化人民币
 * @param value - 金额值
 * @returns 格式化后的人民币金额字符串
 */
export const formatRMB = (value: string | number | null | undefined): string => {
  return formatCurrency(value, '¥');
};

/**
 * 格式化百分比，统一显示为2位小数
 * @param value - 百分比值
 * @param suffix - 后缀，默认为 '%'
 * @returns 格式化后的百分比字符串
 */
export const formatPercent = (
  value: number | null | undefined,
  suffix: string = '%'
): string => {
  if (value === null || value === undefined || isNaN(value)) {
    return `0.00${suffix}`;
  }

  return `${value.toFixed(2)}${suffix}`;
};

/**
 * 计算毛利率
 * @param price - 售价
 * @param cost - 成本
 * @returns 毛利率（已格式化为百分比字符串）
 */
export const calculateMargin = (
  price: number | string,
  cost: number | string
): string => {
  const priceNum = typeof price === 'string' ? parseFloat(price) : price;
  const costNum = typeof cost === 'string' ? parseFloat(cost) : cost;

  if (isNaN(priceNum) || isNaN(costNum) || priceNum <= 0) {
    return '0.00%';
  }

  const margin = ((priceNum - costNum) / priceNum) * 100;
  return formatPercent(margin);
};