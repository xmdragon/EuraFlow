/**
 * OZON 商品提交服务
 *
 * 职责：
 * 1. 包装尺寸同步到类目属性
 * 2. 表单数据转换为 OZON API 格式
 * 3. 属性与变体的格式转换
 * 4. 商品提交参数组装
 */

import type { FormInstance } from 'antd';
import type { CategoryAttribute } from '@/services/ozon';
import type { ProductVariant as VariantType } from '@/hooks/useVariantManager';
import { loggers } from '@/utils/logger';

/**
 * 变体接口（兼容 useVariantManager 返回的类型）
 */
export type ProductVariant = VariantType;

/**
 * 属性字段名称映射（支持多语言）
 */
const ATTRIBUTE_MAPPING = {
  weight: ['含包装重量，克', 'Вес товара с упаковкой', 'Weight with packaging', '重量', '含包装重量'],
  width: ['宽度，厘米', 'Ширина, см', 'Width, cm', '宽度'],
  depth: ['深度，厘米', 'Глубина, см', 'Depth, cm', '深度', '长度'],
  height: ['高度，厘米', 'Высота, см', 'Height, cm', '高度'],
  dimensions: ['尺寸，毫米', 'Размеры, мм', 'Dimensions, mm', '尺寸'],
};

/**
 * 同步包装尺寸到类目属性参数
 */
export interface SyncDimensionsParams {
  form: FormInstance;
  categoryAttributes: CategoryAttribute[];
  changedFields: string[];
}

/**
 * 同步包装尺寸到类目特征
 *
 * 当用户修改包装尺寸（长/宽/高/重量）时，自动填充对应的类目属性
 *
 * 单位转换：
 * - 重量：克（不转换）
 * - 长/宽/高：毫米 → 厘米
 * - 尺寸组合：保持毫米
 */
export function syncDimensionsToAttributes(params: SyncDimensionsParams): void {
  const { form, categoryAttributes, changedFields } = params;

  if (categoryAttributes.length === 0) return;

  // 获取当前表单值
  const values = form.getFieldsValue();
  const { width, height, depth, weight } = values;

  // 构建待更新的字段
  const fieldsToUpdate: Record<string, number | string> = {};

  // 1. 同步重量（克）
  if (changedFields.includes('weight') && weight) {
    const weightAttr = categoryAttributes.find((attr) =>
      ATTRIBUTE_MAPPING.weight.some((name) => attr.name?.includes(name))
    );
    if (weightAttr) {
      const fieldName = `attr_${weightAttr.attribute_id}`;
      fieldsToUpdate[fieldName] = Math.round(weight); // 直接使用克
      loggers.ozon.debug(`[同步尺寸] 重量: ${weight}克 → ${fieldName}`);
    }
  }

  // 2. 同步宽度（毫米 → 厘米）
  if (changedFields.includes('width') && width) {
    const widthAttr = categoryAttributes.find((attr) =>
      ATTRIBUTE_MAPPING.width.some((name) => attr.name?.includes(name))
    );
    if (widthAttr) {
      const fieldName = `attr_${widthAttr.attribute_id}`;
      fieldsToUpdate[fieldName] = Math.round(width / 10); // 毫米转厘米
      loggers.ozon.debug(`[同步尺寸] 宽度: ${width}mm → ${width / 10}cm → ${fieldName}`);
    }
  }

  // 3. 同步深度/长度（毫米 → 厘米）
  if (changedFields.includes('depth') && depth) {
    const depthAttr = categoryAttributes.find((attr) =>
      ATTRIBUTE_MAPPING.depth.some((name) => attr.name?.includes(name))
    );
    if (depthAttr) {
      const fieldName = `attr_${depthAttr.attribute_id}`;
      fieldsToUpdate[fieldName] = Math.round(depth / 10); // 毫米转厘米
      loggers.ozon.debug(`[同步尺寸] 深度: ${depth}mm → ${depth / 10}cm → ${fieldName}`);
    }
  }

  // 4. 同步高度（毫米 → 厘米）
  if (changedFields.includes('height') && height) {
    const heightAttr = categoryAttributes.find((attr) =>
      ATTRIBUTE_MAPPING.height.some((name) => attr.name?.includes(name))
    );
    if (heightAttr) {
      const fieldName = `attr_${heightAttr.attribute_id}`;
      fieldsToUpdate[fieldName] = Math.round(height / 10); // 毫米转厘米
      loggers.ozon.debug(`[同步尺寸] 高度: ${height}mm → ${height / 10}cm → ${fieldName}`);
    }
  }

  // 5. 同步尺寸组合（长x宽x高，毫米）
  if (
    (changedFields.includes('depth') ||
      changedFields.includes('width') ||
      changedFields.includes('height')) &&
    depth &&
    width &&
    height
  ) {
    const dimensionsAttr = categoryAttributes.find((attr) =>
      ATTRIBUTE_MAPPING.dimensions.some((name) => attr.name?.includes(name))
    );
    if (dimensionsAttr) {
      const fieldName = `attr_${dimensionsAttr.attribute_id}`;
      // 注意：这里是字符串格式，用x连接，不是计算
      fieldsToUpdate[fieldName] = `${depth}x${width}x${height}`;
      loggers.ozon.debug(`[同步尺寸] 尺寸: ${depth}x${width}x${height}mm → ${fieldName}`);
    }
  }

  // 批量更新字段
  if (Object.keys(fieldsToUpdate).length > 0) {
    form.setFieldsValue(fieldsToUpdate);
    loggers.ozon.info(`[同步尺寸] 已同步 ${Object.keys(fieldsToUpdate).length} 个类目属性`);
  }
}

/**
 * OZON API 属性格式
 */
export interface OzonAttribute {
  complex_id: number;
  id: number;
  values: Array<{
    dictionary_value_id?: number;
    value: string;
  }>;
}

/**
 * 转换单个属性为 OZON API 格式
 *
 * @param attribute 类目属性定义
 * @param value 表单值（可能是单值或多值数组）
 * @returns OZON API 格式的属性对象
 */
export function formatAttributeForAPI(
  attribute: CategoryAttribute,
  value: unknown
): OzonAttribute {
  const attrValue: OzonAttribute = {
    complex_id: 0,
    id: attribute.attribute_id,
    values: []
  };

  // 处理字典值类型（下拉选择）
  if (attribute.dictionary_id) {
    // 支持多选：值可能是数组（多选）或单个值（单选）
    const values = Array.isArray(value) ? value : [value];
    values.forEach(v => {
      attrValue.values.push({
        dictionary_value_id: Number(v),
        value: String(v)
      });
    });
  } else {
    // 处理普通值（文本、数字、布尔等）
    const values = Array.isArray(value) ? value : [value];
    values.forEach(v => {
      attrValue.values.push({
        value: String(v)
      });
    });
  }

  return attrValue;
}

/**
 * 转换表单属性为 OZON API 格式
 *
 * @param form 表单实例
 * @param categoryAttributes 类目属性列表
 * @returns OZON API 格式的属性数组
 */
export function formatAttributesForAPI(
  form: FormInstance,
  categoryAttributes: CategoryAttribute[]
): OzonAttribute[] {
  const allFormValues = form.getFieldsValue(true);

  return categoryAttributes
    .filter(attr => {
      const fieldName = `attr_${attr.attribute_id}`;
      const value = allFormValues[fieldName];
      // 过滤掉未填写的字段（undefined, null, 空字符串, 空数组）
      if (value === undefined || value === null || value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    })
    .map(attr => {
      const fieldName = `attr_${attr.attribute_id}`;
      const value = allFormValues[fieldName];
      return formatAttributeForAPI(attr, value);
    });
}

/**
 * OZON API 变体格式
 */
export interface OzonVariant {
  offer_id: string;
  title?: string;
  price?: string;
  old_price?: string;
  barcode?: string;
  images?: string[];
  videos?: string[];
  attributes: OzonAttribute[];
}

/**
 * 转换变体为 OZON API 格式
 *
 * @param variant 变体数据
 * @param categoryAttributes 类目属性列表（用于查找字典 ID）
 * @returns OZON API 格式的变体对象
 */
export function formatVariantForAPI(
  variant: ProductVariant,
  categoryAttributes: CategoryAttribute[]
): OzonVariant {
  // 将 dimension_values 转换为 OZON API 的 attributes 格式
  const variantAttributes = Object.entries(variant.dimension_values).map(([attrIdStr, value]) => {
    const attrId = Number(attrIdStr);
    // 从 categoryAttributes 中查找对应的属性定义
    const attrDef = categoryAttributes.find(a => a.attribute_id === attrId);

    const attr: OzonAttribute = {
      complex_id: 0,
      id: attrId,
      values: []
    };

    if (attrDef?.dictionary_id) {
      // 字典值类型（支持多选）
      const values = Array.isArray(value) ? value : [value];
      values.forEach(v => {
        attr.values.push({
          dictionary_value_id: Number(v),
          value: String(v)
        });
      });
    } else {
      // 普通值（支持多选）
      const values = Array.isArray(value) ? value : [value];
      values.forEach(v => {
        attr.values.push({
          value: String(v)
        });
      });
    }

    return attr;
  });

  // 处理 videos：VideoInfo[] → string[]
  let videoUrls: string[] = [];
  if (variant.videos && Array.isArray(variant.videos)) {
    // useVariantManager 的 ProductVariant.videos 类型是 VideoInfo[]
    videoUrls = variant.videos.map((v: { url: string }) => v.url);
  }

  return {
    offer_id: variant.offer_id,
    title: variant.title,
    price: variant.price?.toString(),
    old_price: variant.old_price?.toString(),
    barcode: variant.barcode,
    images: variant.images || [],
    videos: videoUrls,
    attributes: variantAttributes
  };
}

/**
 * 转换变体列表为 OZON API 格式
 *
 * @param variants 变体列表
 * @param categoryAttributes 类目属性列表
 * @returns OZON API 格式的变体数组，如果没有变体则返回 undefined
 */
export function formatVariantsForAPI(
  variants: ProductVariant[],
  categoryAttributes: CategoryAttribute[]
): OzonVariant[] | undefined {
  if (variants.length === 0) return undefined;

  return variants.map(variant => formatVariantForAPI(variant, categoryAttributes));
}

/**
 * 解析 TextArea 多行文本为数组
 *
 * @param text TextArea 的文本值
 * @returns URL 数组，如果为空则返回 undefined
 */
export function parseTextAreaToArray(text: unknown): string[] | undefined {
  if (!text) return undefined;

  const lines = String(text)
    .split('\n')
    .map((url: string) => url.trim())
    .filter((url: string) => url.length > 0);

  return lines.length > 0 ? lines : undefined;
}

/**
 * 获取描述类目 ID（父类目 ID）
 *
 * @param categoryPath 类目路径数组
 * @returns 描述类目 ID（倒数第二个 ID），如果路径不足则返回 undefined
 */
export function getDescriptionCategoryId(categoryPath?: number[]): number | undefined {
  if (!categoryPath || categoryPath.length < 2) return undefined;
  return categoryPath[categoryPath.length - 2];
}

/**
 * 商品提交参数
 */
export interface ProductSubmitParams {
  shop_id: number;
  offer_id: string;
  title: string;
  description: string;
  barcode?: string;
  price?: string;
  old_price?: string;
  category_id?: number;
  type_id?: number;
  description_category_id?: number;
  images: string[];
  videos?: string[];
  attributes: OzonAttribute[];
  variants?: OzonVariant[];
  color_image?: string;
  premium_price?: string;
  images360?: string[];
  pdf_list?: string[];
  promotions?: number[];
  height: number;
  width: number;
  depth: number;
  weight: number;
  dimension_unit: string;
  weight_unit: string;
  vat: string;
}
