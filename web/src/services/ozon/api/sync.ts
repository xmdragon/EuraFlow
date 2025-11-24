/**
 * OZON 同步日志 API
 */

import { apiClient } from '../client';

/**
 * 获取同步日志
 */
export const getSyncLogs = async (entityType?: string, limit: number = 20) => {
  const params = {
    entity_type: entityType,
    limit,
  };
  const response = await apiClient.get("/ozon/sync-logs", { params });
  return response.data;
};

/**
 * 获取同步任务状态
 */
export const getSyncTaskStatus = async (taskId: string) => {
  const response = await apiClient.get(`/ozon/sync/task/${taskId}`);
  return response.data;
};

/**
 * 获取订单详情
 */
export const getOrderDetail = async (
  postingNumber: string,
  shopId?: number,
) => {
  const params: { shop_id?: number } = {};
  if (shopId) {
    params.shop_id = shopId;
  }
  const response = await apiClient.get(`/ozon/orders/${postingNumber}`, {
    params,
  });
  return response.data;
};
