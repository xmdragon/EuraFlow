/**
 * OZON 店铺 API
 */

import { apiClient } from '../client';
import type { ShopData, ApiCredentials } from '../types/shop';

/**
 * 获取店铺列表
 */
export const getShops = async (includeStats: boolean = false) => {
  const response = await apiClient.get("/ozon/shops", {
    params: { include_stats: includeStats }
  });
  return response.data;
};

/**
 * 创建店铺
 */
export const createShop = async (data: ShopData) => {
  const response = await apiClient.post("/ozon/shops", data);
  return response.data;
};

/**
 * 更新店铺
 */
export const updateShop = async (shopId: number, data: Partial<ShopData>) => {
  const response = await apiClient.put(`/ozon/shops/${shopId}`, data);
  return response.data;
};

/**
 * 删除店铺
 */
export const deleteShop = async (shopId: number) => {
  const response = await apiClient.delete(`/ozon/shops/${shopId}`);
  return response.data;
};

/**
 * 测试店铺连接
 */
export const testShopConnection = async (shopId: number) => {
  const response = await apiClient.post(
    `/ozon/shops/${shopId}/test-connection`,
  );
  return response.data;
};

/**
 * 测试 API 连接
 */
export const testApiConnection = async (credentials: ApiCredentials) => {
  const response = await apiClient.post("/ozon/test-connection", credentials);
  return response.data;
};

/**
 * 获取店铺列表（用于店铺管理页面）
 * 包含所有者信息和编辑权限标识
 */
export const getShopsForManagement = async () => {
  const response = await apiClient.get("/ozon/shops/management");
  return response.data;
};
