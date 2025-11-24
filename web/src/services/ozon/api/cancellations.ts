/**
 * OZON 取消和退货 API
 */

import { apiClient } from '../client';
import type {
  Return,
  CancellationListResponse,
  ReturnListResponse,
  CancellationFilter,
  ReturnFilter
} from '../types/cancellation';

/**
 * 获取取消申请列表
 */
export const getCancellations = async (filter: CancellationFilter): Promise<CancellationListResponse> => {
  const response = await apiClient.get('/ozon/cancel-return/cancellations', { params: filter });
  return response.data;
};

/**
 * 获取退货申请列表
 */
export const getReturns = async (filter: ReturnFilter): Promise<ReturnListResponse> => {
  const response = await apiClient.get('/ozon/cancel-return/returns', { params: filter });
  return response.data;
};

/**
 * 获取退货申请详情
 */
export const getReturnDetail = async (returnId: number): Promise<Return> => {
  const response = await apiClient.get(`/ozon/cancel-return/returns/${returnId}`);
  return response.data;
};

/**
 * 手动同步取消申请
 */
export const syncCancellations = async (shopId: number | null): Promise<unknown> => {
  const response = await apiClient.post('/ozon/cancel-return/cancellations/sync', {
    shop_id: shopId
  });
  return response.data;
};

/**
 * 手动同步退货申请
 */
export const syncReturns = async (shopId: number | null): Promise<unknown> => {
  const response = await apiClient.post('/ozon/cancel-return/returns/sync', {
    shop_id: shopId
  });
  return response.data;
};
