/**
 * 价格单位转换工具
 *
 * 后端API统一使用"人民币分"作为价格单位
 * 前端UI统一使用"人民币元"进行展示
 */

/**
 * 将分转换为元
 * @param cents 价格（分）
 * @returns 价格（元），保留2位小数
 */
export function centsToYuan(cents: number): number {
  return cents / 100;
}

/**
 * 将元转换为分
 * @param yuan 价格（元）
 * @returns 价格（分），四舍五入为整数
 */
export function yuanToCents(yuan: number): number {
  return Math.round(yuan * 100);
}

/**
 * 格式化价格为人民币字符串
 * @param yuan 价格（元）
 * @returns 格式化的价格字符串，如 "¥15.99"
 */
export function formatYuan(yuan: number): string {
  return `¥${yuan.toFixed(2)}`;
}

/**
 * 解析价格字符串为数字（元）
 * @param priceStr 价格字符串，如 "¥15.99" 或 "15.99"
 * @returns 价格（元）
 */
export function parseYuan(priceStr: string): number {
  // 移除非数字字符（保留小数点和负号）
  const cleaned = priceStr.replace(/[^\d.-]/g, '');
  return parseFloat(cleaned) || 0;
}
