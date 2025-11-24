/**
 * OZON 库存管理 API
 */

import { apiClient } from '../client';
import type { StockItem, AddStockRequest, UpdateStockRequest, StockCheckItem } from '../types/stock';

/**
 * 获取库存列表
 */
export const getStockList = async (params?: {
  shop_id?: number;
  sku?: string;
  page?: number;
  page_size?: number;
}): Promise<{
  items: StockItem[];
  total: number;
  page: number;
  page_size: number;
}> => {
  const response = await apiClient.get('/ozon/stock', { params });
  return response.data.data;
};

/**
 * 添加库存
 */
export const addStock = async (data: AddStockRequest): Promise<{ id: number; message: string }> => {
  const response = await apiClient.post('/ozon/stock', data);
  return response.data.data;
};

/**
 * 更新库存
 */
export const updateStock = async (stockId: number, data: UpdateStockRequest): Promise<{ message: string }> => {
  const response = await apiClient.put(`/ozon/stock/${stockId}`, data);
  return response.data.data;
};

/**
 * 删除库存
 */
export const deleteStock = async (stockId: number): Promise<{ message: string }> => {
  const response = await apiClient.delete(`/ozon/stock/${stockId}`);
  return response.data.data;
};

/**
 * 检查订单商品的库存情况（备货时使用）
 */
export const checkStockForPosting = async (postingNumber: string): Promise<{
  posting_number: string;
  items: StockCheckItem[];
}> => {
  const response = await apiClient.get(`/ozon/stock/check/${postingNumber}`);
  return response.data.data;
};
