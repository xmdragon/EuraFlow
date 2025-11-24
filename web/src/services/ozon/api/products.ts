/**
 * OZON 商品 API
 */

import { apiClient } from '../client';
import type { ProductFilter, PriceUpdate, StockUpdate, PurchasePriceHistoryResponse } from '../types/product';

/**
 * 获取商品列表
 */
export const getProducts = async (
  page: number = 1,
  pageSize: number = 20,
  filter?: ProductFilter,
) => {
  const params = {
    page: page,
    page_size: pageSize,
    ...filter,
  };
  // 如果shop_id为null（全部店铺），不传递该参数
  if (params.shop_id === null) {
    delete params.shop_id;
  }
  const response = await apiClient.get("/ozon/products", { params });
  return response.data;
};

/**
 * 获取商品详情
 */
export const getProduct = async (productId: number) => {
  const response = await apiClient.get(`/ozon/products/${productId}`);
  return response.data;
};

/**
 * 获取商品同步错误信息
 */
export const getProductSyncErrors = async (productId: number) => {
  const response = await apiClient.get(`/ozon/products/${productId}/sync-errors`);
  return response.data;
};

/**
 * 同步商品
 */
export const syncProducts = async (
  shopId?: number | null,
  fullSync: boolean = false,
) => {
  // 如果没有指定店铺，调用批量同步端点（同步所有有权限的店铺）
  if (!shopId) {
    const response = await apiClient.post("/ozon/products/sync", {
      full_sync: fullSync,
    });
    return response.data;
  }

  // 指定店铺时，调用单店铺同步端点
  const response = await apiClient.post(`/ozon/shops/${shopId}/sync`, null, {
    params: {
      sync_type: "products",
      products_mode: fullSync ? "full" : "incremental",
    },
  });
  return response.data;
};

/**
 * 同步单个商品
 */
export const syncSingleProduct = async (productId: number) => {
  const response = await apiClient.post(`/ozon/products/${productId}/sync`);
  return response.data;
};

/**
 * 归档商品
 */
export const archiveProduct = async (productId: number) => {
  const response = await apiClient.post(`/ozon/products/${productId}/archive`);
  return response.data;
};

/**
 * 恢复归档商品（简单版，仅改变归档状态）
 */
export const restoreArchivedProduct = async (productId: number) => {
  const response = await apiClient.post(`/ozon/products/${productId}/unarchive`);
  return response.data;
};

/**
 * 删除商品
 */
export const deleteProduct = async (productId: number) => {
  const response = await apiClient.delete(`/ozon/products/${productId}`);
  return response.data;
};

/**
 * 批量更新价格
 */
export const updatePrices = async (updates: PriceUpdate[], shopId?: number) => {
  const data: { updates: PriceUpdate[]; shop_id?: number } = { updates };
  if (shopId) {
    data.shop_id = shopId;
  }
  const response = await apiClient.post("/ozon/products/prices", data);
  return response.data;
};

/**
 * 批量更新库存
 */
export const updateStocks = async (updates: StockUpdate[], shopId?: number) => {
  const data: { updates: StockUpdate[]; shop_id?: number } = { updates };
  if (shopId) {
    data.shop_id = shopId;
  }
  const response = await apiClient.post("/ozon/products/stocks", data);
  return response.data;
};

/**
 * 查询批量库存更新任务状态
 */
export const getBatchStockUpdateTaskStatus = async (taskId: string) => {
  const response = await apiClient.get(`/ozon/products/stocks/task/${taskId}`);
  return response.data;
};

/**
 * 查询批量价格更新任务状态
 */
export const getBatchPriceUpdateTaskStatus = async (taskId: string) => {
  const response = await apiClient.get(`/ozon/products/prices/task/${taskId}`);
  return response.data;
};

/**
 * 获取商品SKU的进货价格历史记录
 */
export const getProductPurchasePriceHistory = async (
  sku: string,
  limit: number = 10,
): Promise<PurchasePriceHistoryResponse> => {
  const response = await apiClient.get(
    `/ozon/products/${sku}/purchase-price-history`,
    {
      params: { limit },
    },
  );
  return response.data;
};
