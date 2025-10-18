import type { ProductData } from '../../shared/types';

/**
 * 页面数据解析器接口
 *
 * 每个第三方工具（上品帮、毛子ERP等）对应一个解析器实现
 */
export interface PageDataParser {
  /**
   * 工具标识符
   */
  readonly toolName: 'shangpinbang' | 'maozi-erp';

  /**
   * 工具显示名称
   */
  readonly displayName: string;

  /**
   * 检测工具是否已在页面注入数据
   *
   * @returns true 如果工具已注入，false 否则
   */
  isInjected(): boolean;

  /**
   * 从商品卡片元素提取数据
   *
   * @param cardElement 商品卡片DOM元素
   * @returns 提取的部分商品数据（可能不包含所有42个字段）
   */
  parseProductCard(cardElement: HTMLElement): Promise<Partial<ProductData>>;

  /**
   * 等待工具完成数据注入（可选）
   *
   * 某些工具需要时间来注入数据到页面，此方法用于等待注入完成
   *
   * @returns Promise<void>
   */
  waitForInjection?(): Promise<void>;
}

/**
 * 辅助函数：检查值是否为空
 */
export function isNullish(value: any): boolean {
  return value === null ||
         value === undefined ||
         value === '' ||
         value === '--' ||
         value === 'nan' ||
         value === 'NaN';
}

/**
 * 辅助函数：清理数字值
 */
export function cleanNumber(value: any): number | undefined {
  if (isNullish(value)) return undefined;

  const str = String(value).trim().replace(/[,\s]/g, '');
  const num = parseFloat(str);

  return isNaN(num) ? undefined : num;
}

/**
 * 辅助函数：清理百分比值
 */
export function cleanPercent(value: any): number | undefined {
  if (isNullish(value)) return undefined;

  const str = String(value).trim().replace(/%/g, '');
  const num = parseFloat(str);

  return isNaN(num) ? undefined : num;
}

/**
 * 辅助函数：标准化品牌名
 */
export function normalizeBrand(brand: string | undefined): string | undefined {
  if (!brand || brand === 'без бренда') {
    return 'NO_BRAND';
  }

  // 转换为大写，移除首尾空格和多余空格
  return brand.toUpperCase().trim().replace(/\s+/g, ' ');
}
