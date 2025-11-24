/**
 * OZON 商品标题生成与翻译服务
 *
 * 职责：
 * 1. 按 OZON 官方命名规范生成商品标题
 * 2. 提供标题翻译功能（中文 <-> 俄文）
 * 3. 检查类目是否支持自动生成标题
 */

import type { FormInstance } from 'antd';
import type { CategoryAttribute, DictionaryValue } from '@/services/ozon';
import type { ProductVariant, VariantDimension } from '@/hooks/useVariantManager';
import * as translationApi from '@/services/translationApi';
import { notifyWarning } from '@/utils/notification';
import { loggers } from '@/utils/logger';

/**
 * OZON 平台自动生成标题的类目列表
 * 这些类目不需要手动填写标题
 */
export const OZON_AUTO_TITLE_CATEGORIES = [
  '汽车用品', '医药保健', '家用电器', '电子游戏', '服饰用品和配饰',
  '居家生活', '印刷书籍', '美容与健康', '家具', '音乐',
  '鞋子', '服装', '维修与施工', '运动与休闲', '珠宝饰品', '电子产品'
];

/**
 * 类目选项接口（用于类目树）
 */
interface CategoryOption {
  value: number;
  label: string;
  children?: CategoryOption[];
  isLeaf?: boolean;
  disabled?: boolean;
}

/**
 * 字典值缓存类型
 */
type DictionaryValuesCache = Record<number, DictionaryValue[]>;

/**
 * 从类目树中递归查找类目名称
 */
export function getCategoryNameById(
  categoryId: number,
  tree: CategoryOption[]
): string | null {
  for (const node of tree) {
    if (node.value === categoryId) {
      return node.label;
    }
    if (node.children) {
      const result = getCategoryNameById(categoryId, node.children);
      if (result) return result;
    }
  }
  return null;
}

/**
 * 从字典值缓存中获取文本值
 */
function getDictionaryValueText(
  valueId: number | string,
  dictionaryId: number | undefined,
  cache: DictionaryValuesCache
): string | null {
  if (!dictionaryId || !cache[dictionaryId]) {
    return String(valueId);
  }

  const dictValue = cache[dictionaryId].find(v => v.value_id === valueId);
  return dictValue ? String(dictValue.value) : String(valueId);
}

/**
 * 检查类目是否需要 OZON 自动生成标题
 */
export function isAutoTitleCategory(categoryName: string): boolean {
  return OZON_AUTO_TITLE_CATEGORIES.includes(categoryName);
}

/**
 * 生成 OZON 商品标题参数
 */
export interface GenerateTitleParams {
  form: FormInstance;
  selectedCategory: number | null;
  categoryTree: CategoryOption[];
  categoryAttributes: CategoryAttribute[];
  dictionaryValuesCache: DictionaryValuesCache;
  variantDimensions: VariantDimension[];
  variants: ProductVariant[];
}

/**
 * 生成商品标题（根据 OZON 官方命名规范）
 *
 * 格式：类型 + 品牌 + 型号（系列 + 说明）+ 制造商货号 + ，（逗号）+ 属性
 *
 * @returns 生成的标题，如果无法生成则返回 null
 */
export function generateProductTitle(params: GenerateTitleParams): string | null {
  const {
    form,
    selectedCategory,
    categoryTree,
    categoryAttributes,
    dictionaryValuesCache,
    variantDimensions,
    variants
  } = params;

  // 1. 获取当前选择的类目名称
  const categoryName = selectedCategory
    ? getCategoryNameById(selectedCategory, categoryTree)
    : null;

  // 2. 检查是否为 OZON 自动生成标题的类目
  if (categoryName && isAutoTitleCategory(categoryName)) {
    notifyWarning(
      '无需手动填写标题',
      `"${categoryName}"类目的商品标题由 OZON 平台自动生成`
    );
    return null;
  }

  // ============ 主要部分（用空格连接）============
  const mainParts: string[] = [];

  // 1. 类型（使用类目名称）
  if (categoryName) {
    mainParts.push(categoryName.toLowerCase());
  }

  // 2. 品牌（从 attributes 中查找品牌属性）
  const brandAttr = categoryAttributes.find(attr =>
    attr.name?.toLowerCase().includes('品牌') ||
    attr.name?.toLowerCase().includes('brand') ||
    attr.name?.toLowerCase().includes('бренд')
  );
  if (brandAttr) {
    const brandFieldName = `attr_${brandAttr.attribute_id}`;
    const brandValue = form.getFieldValue(brandFieldName);
    if (brandValue) {
      const brandText = getDictionaryValueText(
        brandValue,
        brandAttr.dictionary_id,
        dictionaryValuesCache
      );
      if (brandText) {
        mainParts.push(brandText.toLowerCase());
      }
    }
  }

  // 3. 型号/系列（从 attributes 中查找型号、系列、模型等属性）
  const modelAttr = categoryAttributes.find(attr =>
    attr.name?.toLowerCase().includes('型号') ||
    attr.name?.toLowerCase().includes('系列') ||
    attr.name?.toLowerCase().includes('模型') ||
    attr.name?.toLowerCase().includes('model') ||
    attr.name?.toLowerCase().includes('модель')
  );
  if (modelAttr) {
    const modelFieldName = `attr_${modelAttr.attribute_id}`;
    const modelValue = form.getFieldValue(modelFieldName);
    if (modelValue) {
      const modelText = getDictionaryValueText(
        modelValue,
        modelAttr.dictionary_id,
        dictionaryValuesCache
      );
      if (modelText) {
        mainParts.push(modelText.toLowerCase());
      }
    }
  }

  // 4. 制造商货号（从 attributes 中查找制造商货号、货号、SKU等属性）
  const skuAttr = categoryAttributes.find(attr =>
    attr.name?.toLowerCase().includes('制造商货号') ||
    attr.name?.toLowerCase().includes('货号') ||
    attr.name?.toLowerCase().includes('sku') ||
    attr.name?.toLowerCase().includes('артикул')
  );
  if (skuAttr) {
    const skuFieldName = `attr_${skuAttr.attribute_id}`;
    const skuValue = form.getFieldValue(skuFieldName);
    if (skuValue) {
      const skuText = getDictionaryValueText(
        skuValue,
        skuAttr.dictionary_id,
        dictionaryValuesCache
      );
      if (skuText) {
        mainParts.push(skuText.toLowerCase());
      }
    }
  }

  // ============ 属性部分（用逗号连接）============
  const attrParts: string[] = [];

  // 1. 颜色（从变体维度或属性中查找）
  const colorDim = variantDimensions.find(d =>
    d.name?.toLowerCase().includes('颜色') ||
    d.name?.toLowerCase().includes('цвет') ||
    d.name?.toLowerCase().includes('color')
  );
  if (colorDim) {
    // 如果有多个变体，取第一个变体的颜色值
    if (variants.length > 0) {
      const firstVariant = variants[0];
      const colorValue = firstVariant.dimension_values[colorDim.attribute_id];
      if (colorValue && (typeof colorValue === 'string' || typeof colorValue === 'number')) {
        const colorText = getDictionaryValueText(
          colorValue,
          colorDim.dictionary_id,
          dictionaryValuesCache
        );
        if (colorText) {
          // 颜色用小写，不加"颜色"这个词
          attrParts.push(colorText.toLowerCase());
        }
      }
    }
  } else {
    // 如果没有作为变体维度，从普通属性中查找
    const colorAttr = categoryAttributes.find(attr =>
      attr.name?.toLowerCase().includes('颜色') ||
      attr.name?.toLowerCase().includes('цвет') ||
      attr.name?.toLowerCase().includes('color')
    );
    if (colorAttr) {
      const colorFieldName = `attr_${colorAttr.attribute_id}`;
      const colorValue = form.getFieldValue(colorFieldName);
      if (colorValue) {
        const colorText = getDictionaryValueText(
          colorValue,
          colorAttr.dictionary_id,
          dictionaryValuesCache
        );
        if (colorText) {
          attrParts.push(colorText.toLowerCase());
        }
      }
    }
  }

  // 2. 重量（从表单获取）
  const weight = form.getFieldValue('weight');
  if (weight) {
    attrParts.push(`${weight}г`);
  }

  // 3. 体积/包装尺寸（从表单获取）
  const depth = form.getFieldValue('depth');
  const width = form.getFieldValue('width');
  const height = form.getFieldValue('height');
  if (depth && width && height) {
    attrParts.push(`${depth}x${width}x${height}мм`);
  }

  // 4. 包装中的件数（从 attributes 中查找）
  const quantityAttr = categoryAttributes.find(attr =>
    attr.name?.toLowerCase().includes('包装中的件数') ||
    attr.name?.toLowerCase().includes('件数') ||
    attr.name?.toLowerCase().includes('数量') ||
    attr.name?.toLowerCase().includes('количество в упаковке')
  );
  if (quantityAttr) {
    const quantityFieldName = `attr_${quantityAttr.attribute_id}`;
    const quantityValue = form.getFieldValue(quantityFieldName);
    if (quantityValue) {
      const quantityText = getDictionaryValueText(
        quantityValue,
        quantityAttr.dictionary_id,
        dictionaryValuesCache
      );
      if (quantityText) {
        attrParts.push(`${quantityText}шт`);
      }
    }
  }

  // ============ 组合最终标题 ============
  let generatedTitle = '';

  // 主要部分用空格连接
  if (mainParts.length > 0) {
    generatedTitle = mainParts.join(' ');
  }

  // 如果有属性，用逗号+空格连接
  if (attrParts.length > 0) {
    if (generatedTitle) {
      generatedTitle += ', ' + attrParts.join(', ');
    } else {
      generatedTitle = attrParts.join(', ');
    }
  }

  // 如果生成的标题为空，返回 null
  if (!generatedTitle) {
    notifyWarning(
      '无法生成标题',
      '请先选择类目并填写品牌、型号等关键信息'
    );
    return null;
  }

  return generatedTitle;
}

/**
 * 翻译标题参数
 */
export interface TranslateTitleParams {
  text: string;
  sourceLang?: string;
  targetLang?: string;
}

/**
 * 翻译标题（中文 -> 俄文）
 *
 * @returns 翻译后的文本
 * @throws 翻译失败时抛出异常
 */
export async function translateTitle(params: TranslateTitleParams): Promise<string> {
  const { text, sourceLang = 'zh', targetLang = 'ru' } = params;

  try {
    const translatedText = await translationApi.translateText(text, sourceLang, targetLang);
    return translatedText;
  } catch (error) {
    const err = error as {
      message?: string;
      response?: { data?: { detail?: { detail?: string } } };
    };
    loggers.product.error('标题翻译失败', { error: err.message });
    throw new Error(err.response?.data?.detail?.detail || '翻译服务暂时不可用');
  }
}
