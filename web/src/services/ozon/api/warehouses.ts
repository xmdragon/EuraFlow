/**
 * OZON 仓库 API
 */

import { apiClient } from '../client';

/**
 * 获取店铺仓库列表（从数据库读取）
 */
export const getWarehouses = async (shopId: number) => {
  const response = await apiClient.get(`/ozon/shops/${shopId}/warehouses`);
  return response.data;
};

/**
 * 同步仓库（单个店铺）
 */
export const syncWarehouses = async (shopId: number) => {
  const response = await apiClient.post(
    `/ozon/shops/${shopId}/sync-warehouses`,
  );
  return response.data;
};

/**
 * 批量同步所有店铺仓库
 */
export const syncAllWarehouses = async () => {
  const response = await apiClient.post(`/ozon/shops/sync-all-warehouses`);
  return response.data;
};
