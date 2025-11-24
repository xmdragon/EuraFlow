/**
 * 跨境巴士同步 API
 */

import { apiClient } from '../client';
import type { Kuajing84Config, Kuajing84ConfigRequest, Kuajing84SyncLog } from '../types/kuajing84';

/**
 * 保存跨境巴士全局配置
 */
export const saveKuajing84Config = async (config: Kuajing84ConfigRequest) => {
  const response = await apiClient.post("/ozon/kuajing84/config", config);
  return response.data;
};

/**
 * 获取跨境巴士全局配置
 */
export const getKuajing84Config = async (): Promise<{
  success: boolean;
  data?: Kuajing84Config;
  message?: string;
}> => {
  const response = await apiClient.get("/ozon/kuajing84/config");
  return response.data;
};

/**
 * 测试跨境巴士连接
 */
export const testKuajing84Connection = async (): Promise<{
  success: boolean;
  message: string;
  data?: unknown;
}> => {
  const response = await apiClient.post("/ozon/kuajing84/test-connection");
  return response.data;
};

/**
 * 同步物流单号到跨境巴士
 */
export const syncToKuajing84 = async (
  ozonOrderId: number,
  postingNumber: string,
  logisticsOrder: string,
) => {
  const response = await apiClient.post("/ozon/kuajing84/sync", {
    ozon_order_id: ozonOrderId,
    posting_number: postingNumber,
    logistics_order: logisticsOrder,
  });
  return response.data;
};

/**
 * 获取跨境巴士同步日志
 */
export const getKuajing84SyncLogs = async (
  shopId: number,
  status?: string,
  limit: number = 50,
): Promise<{ success: boolean; data: Kuajing84SyncLog[] }> => {
  const params: { limit: number; status?: string } = { limit };
  if (status) {
    params.status = status;
  }
  const response = await apiClient.get(`/ozon/kuajing84/logs/${shopId}`, {
    params,
  });
  return response.data;
};
