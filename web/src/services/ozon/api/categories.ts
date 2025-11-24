/**
 * OZON 类目 API
 */

import { apiClient } from '../client';
import type { BatchSyncCategoryAttributesOptions, SyncSingleCategoryAttributesOptions } from '../types/category';

/**
 * 获取类目树（三级联动）
 */
export const getCategoryTree = async (shopId: number) => {
  const response = await apiClient.get("/ozon/listings/categories/tree", {
    params: { shop_id: shopId },
  });
  return response.data;
};

/**
 * 搜索类目
 */
export const searchCategories = async (
  shopId: number,
  query: string,
  onlyLeaf: boolean = true,
  limit: number = 20,
) => {
  const response = await apiClient.get("/ozon/listings/categories/search", {
    params: { shop_id: shopId, query, only_leaf: onlyLeaf, limit },
  });
  return response.data;
};

/**
 * 获取类目属性
 */
export const getCategoryAttributes = async (
  shopId: number,
  categoryId: number,
  requiredOnly: boolean = false,
) => {
  const response = await apiClient.get(
    `/ozon/listings/categories/${categoryId}/attributes`,
    {
      params: { shop_id: shopId, required_only: requiredOnly },
    },
  );
  return response.data;
};

/**
 * 搜索属性字典值（直接调用OZON API）
 */
export const searchAttributeValues = async (
  shopId: number,
  categoryId: number,
  attributeId: number,
  query?: string,
  limit: number = 100,
) => {
  const response = await apiClient.get(
    `/ozon/listings/categories/${categoryId}/attributes/${attributeId}/values/search`,
    {
      params: { shop_id: shopId, query, limit },
    },
  );
  return response.data;
};

/**
 * @deprecated 使用 searchAttributeValues 代替
 */
export const searchDictionaryValues = searchAttributeValues;

/**
 * 同步类目树（同步模式，会阻塞）
 */
export const syncCategoryTree = async (
  shopId: number,
  forceRefresh: boolean = false,
  rootCategoryId?: number,
) => {
  const response = await apiClient.post("/ozon/listings/categories/sync", {
    shop_id: shopId,
    force_refresh: forceRefresh,
    root_category_id: rootCategoryId,
  });
  return response.data;
};

/**
 * 异步同步类目树（异步任务模式，推荐使用）
 */
export const syncCategoryTreeAsync = async (
  shopId: number,
  forceRefresh: boolean = true,
) => {
  const response = await apiClient.post("/ozon/listings/categories/sync-async", {
    shop_id: shopId,
    force_refresh: forceRefresh,
  });
  return response.data;
};

/**
 * 查询类目同步任务状态
 */
export const getCategorySyncTaskStatus = async (taskId: string) => {
  const response = await apiClient.get(
    `/ozon/listings/categories/sync-async/status/${taskId}`,
  );
  return response.data;
};

/**
 * 批量同步类目特征（中文）- 异步任务模式
 */
export const batchSyncCategoryAttributes = async (
  shopId: number,
  options: BatchSyncCategoryAttributesOptions = {},
) => {
  const response = await apiClient.post(
    "/ozon/listings/categories/batch-sync-attributes",
    {
      shop_id: shopId,
      category_ids: options.categoryIds,
      sync_all_leaf: options.syncAllLeaf || false,
      sync_dictionary_values: options.syncDictionaryValues !== false,
      language: options.language || "ZH_HANS",
      max_concurrent: options.maxConcurrent || 5,
    },
  );
  return response.data;
};

/**
 * 查询批量同步任务状态
 */
export const getBatchSyncTaskStatus = async (taskId: string) => {
  const response = await apiClient.get(
    `/ozon/listings/categories/batch-sync-attributes/status/${taskId}`,
  );
  return response.data;
};

/**
 * 同步单个类目的特征
 */
export const syncSingleCategoryAttributes = async (
  categoryId: number,
  shopId: number,
  options: SyncSingleCategoryAttributesOptions = {},
) => {
  const response = await apiClient.post(
    `/ozon/listings/categories/${categoryId}/sync-attributes`,
    null,
    {
      params: {
        shop_id: shopId,
        language: options.language || "ZH_HANS",
        force_refresh: options.forceRefresh || false,
        sync_dictionary_values: options.syncDictionaryValues !== false,
      },
    },
  );
  return response.data;
};
