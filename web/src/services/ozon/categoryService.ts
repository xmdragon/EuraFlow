/**
 * OZON 类目管理服务
 *
 * 职责：
 * 1. 加载类目树数据
 * 2. 加载类目属性
 * 3. 加载字典值（属性值搜索）
 * 4. 类目路径查询与转换
 */

import * as ozonApi from '@/services/ozon';
import type { CategoryAttribute, DictionaryValue } from '@/services/ozon';
import { notifyError, notifyWarning } from '@/utils/notification';
import { loggers } from '@/utils/logger';

/**
 * 类目选项接口（用于类目树）
 */
export interface CategoryOption {
  value: number;
  label: string;
  children?: CategoryOption[];
  isLeaf?: boolean;
  disabled?: boolean;
}

/**
 * 类目属性加载结果
 */
export interface CategoryAttributesResult {
  success: boolean;
  data: CategoryAttribute[];
  type_id?: number;
}

/**
 * 从 public 目录加载类目树
 *
 * @returns 类目树数据
 * @throws 加载失败时抛出异常
 */
export async function loadCategoryTree(): Promise<CategoryOption[]> {
  try {
    const timestamp = Date.now();
    const response = await fetch(`/data/categoryTree.json?t=${timestamp}`);

    if (!response.ok) {
      throw new Error('加载类目树失败');
    }

    const json = await response.json();
    return json.data || [];
  } catch (error) {
    loggers.ozon.error('加载类目树失败', { error });
    notifyError('加载失败', '无法加载类目树数据，请刷新页面重试');
    throw error;
  }
}

/**
 * 从类目树中递归查找类目名称
 *
 * @param categoryId 类目 ID
 * @param tree 类目树
 * @returns 类目名称，未找到返回 null
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
 * 根据类目 ID 获取完整路径（用于 Cascader）
 *
 * @param categoryId 类目 ID
 * @param tree 类目树
 * @param path 当前路径（递归用）
 * @returns 类目路径数组，未找到返回 null
 */
export function getCategoryPath(
  categoryId: number,
  tree: CategoryOption[],
  path: number[] = []
): number[] | null {
  for (const node of tree) {
    const currentPath = [...path, node.value];
    if (node.value === categoryId) {
      return currentPath;
    }
    if (node.children) {
      const found = getCategoryPath(categoryId, node.children, currentPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 加载类目属性参数
 */
export interface LoadCategoryAttributesParams {
  shopId: number;
  categoryId: number;
}

/**
 * 加载类目属性
 *
 * @param params 加载参数
 * @returns 类目属性数据和 type_id
 * @throws 加载失败时抛出异常
 */
export async function loadCategoryAttributes(
  params: LoadCategoryAttributesParams
): Promise<CategoryAttributesResult> {
  const { shopId, categoryId } = params;

  try {
    const result = await ozonApi.getCategoryAttributes(shopId, categoryId);

    if (result.success && result.data) {
      // 记录 type_id（如果后端返回了的话）
      if (result.type_id !== undefined) {
        loggers.ozon.info('类目 type_id 已获取', {
          categoryId,
          type_id: result.type_id
        });
      }

      return {
        success: true,
        data: result.data,
        type_id: result.type_id
      };
    } else {
      notifyWarning('提示', '该类目暂无属性数据');
      return {
        success: false,
        data: [],
        type_id: undefined
      };
    }
  } catch (error) {
    loggers.ozon.error('加载类目属性失败', { error, categoryId });
    notifyError('加载失败', '加载类目属性失败');
    throw error;
  }
}

/**
 * 提取特殊字段的说明
 *
 * @param attributes 类目属性列表
 * @returns 特殊字段说明映射 (attribute_id -> description)
 */
export function extractSpecialFieldDescriptions(
  attributes: CategoryAttribute[]
): Record<string, string> {
  const specialDescriptions: Record<string, string> = {};

  attributes.forEach((attr) => {
    // 特殊字段 ID：4180, 4191, 8790
    if (attr.attribute_id === 4180 || attr.attribute_id === 4191 || attr.attribute_id === 8790) {
      specialDescriptions[attr.attribute_id.toString()] = attr.description || '';
    }
  });

  return specialDescriptions;
}

/**
 * 筛选 is_aspect=true 的属性（变体维度属性）
 *
 * @param attributes 类目属性列表
 * @returns 变体维度属性列表
 */
export function extractAspectAttributes(
  attributes: CategoryAttribute[]
): CategoryAttribute[] {
  return attributes.filter((attr) => attr.is_aspect);
}

/**
 * 加载字典值（搜索属性值）
 *
 * @param shopId 店铺 ID
 * @param categoryId 类目 ID
 * @param attributeId 属性 ID
 * @param query 搜索关键词（可选）
 * @param limit 返回数量限制（默认 100）
 * @returns 字典值列表
 */
export async function loadDictionaryValues(
  shopId: number,
  categoryId: number,
  attributeId: number,
  query?: string,
  limit: number = 100
): Promise<DictionaryValue[]> {
  try {
    const result = await ozonApi.searchAttributeValues(
      shopId,
      categoryId,
      attributeId,
      query,
      limit
    );
    return result.data || [];
  } catch (error) {
    loggers.ozon.error('加载字典值失败', {
      error,
      shopId,
      categoryId,
      attributeId,
      query
    });
    return [];
  }
}

/**
 * 批量加载多个属性的字典值
 *
 * @param shopId 店铺 ID
 * @param categoryId 类目 ID
 * @param attributeIds 属性 ID 列表
 * @returns 字典值缓存映射 (dictionary_id -> DictionaryValue[])
 */
export async function batchLoadDictionaryValues(
  shopId: number,
  categoryId: number,
  attributeIds: number[]
): Promise<Record<number, DictionaryValue[]>> {
  const cache: Record<number, DictionaryValue[]> = {};

  // 并行加载所有字典值
  const promises = attributeIds.map(async (attributeId) => {
    const values = await loadDictionaryValues(shopId, categoryId, attributeId);
    return { attributeId, values };
  });

  const results = await Promise.all(promises);

  // 构建缓存
  results.forEach(({ attributeId, values }) => {
    cache[attributeId] = values;
  });

  return cache;
}
