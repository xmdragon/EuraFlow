/**
 * OZON 促销活动 API
 */

import { apiClient } from '../client';
import type { PromotionAction } from '../types/promotion';

/**
 * 获取店铺促销活动列表
 */
export const getPromotionActions = async (shopId: number): Promise<PromotionAction[]> => {
  const response = await apiClient.get(`/ozon/shops/${shopId}/promotions/actions`);
  return response.data?.data || [];
};
