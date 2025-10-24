/**
 * 数字格式化工具函数
 */

/**
 * 智能格式化数字，整数不显示小数点，小数显示合适的位数
 * @param value - 数字值
 * @param maxDecimalPlaces - 最大小数位数，默认2位
 * @returns 格式化后的字符串
 */
export const formatNumber = (
  value: number | string | null | undefined,
  maxDecimalPlaces: number = 2
): string => {
  if (value === null || value === undefined || value === '') {
    return '0';
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(num)) {
    return '0';
  }

  // 检查是否为整数
  if (Number.isInteger(num)) {
    return num.toString();
  }

  // 转换为指定小数位数，并移除末尾的零
  const formatted = num.toFixed(maxDecimalPlaces);
  return parseFloat(formatted).toString();
};

/**
 * 智能格式化货币，整数不显示小数点
 * @param value - 金额值
 * @param prefix - 货币符号前缀，默认为 '¥'
 * @param maxDecimalPlaces - 最大小数位数，默认2位
 * @returns 格式化后的货币字符串
 */
export const formatCurrencySmart = (
  value: string | number | null | undefined,
  prefix: string = '¥',
  maxDecimalPlaces: number = 2
): string => {
  const formatted = formatNumber(value, maxDecimalPlaces);
  return `${prefix}${formatted}`;
};

/**
 * 智能格式化百分比，整数不显示小数点
 * @param value - 百分比值（0-100）
 * @param maxDecimalPlaces - 最大小数位数，默认2位
 * @returns 格式化后的百分比字符串
 */
export const formatPercentSmart = (
  value: number | string | null | undefined,
  maxDecimalPlaces: number = 2
): string => {
  const formatted = formatNumber(value, maxDecimalPlaces);
  return `${formatted}%`;
};

/**
 * InputNumber 组件的 formatter，智能格式化数字
 * @param maxDecimalPlaces - 最大小数位数
 * @returns formatter 函数
 */
export const getNumberFormatter = (maxDecimalPlaces: number = 2) => {
  return (value: number | string | undefined): string => {
    if (!value) return '';
    return formatNumber(value, maxDecimalPlaces);
  };
};

/**
 * InputNumber 组件的 parser，解析用户输入
 * @returns parser 函数
 */
export const getNumberParser = () => {
  return (value: string | undefined): number => {
    if (!value) return 0;
    // 移除所有非数字字符（保留小数点和负号）
    const cleaned = value.replace(/[^\d.-]/g, '');
    return parseFloat(cleaned) || 0;
  };
};
