/**
 * OZON 统计 API
 */

import { apiClient } from '../client';
import type { DailyPostingStats, DailyRevenueStats } from '../types/statistics';

/**
 * 获取统计数据
 */
export const getStatistics = async (shopId?: number | null) => {
  const params: { shop_id?: number } = {};
  if (shopId) {
    params.shop_id = shopId;
  }
  const response = await apiClient.get("/ozon/statistics", { params });
  return response.data;
};

/**
 * 获取每日 Posting 统计
 */
export const getDailyPostingStats = async (
  shopId?: number | null,
  rangeType?: string,
  startDate?: string,
  endDate?: string
) => {
  const params: { shop_id?: number; range_type?: string; start_date?: string; end_date?: string } = {};

  if (shopId) {
    params.shop_id = shopId;
  }

  if (rangeType) {
    params.range_type = rangeType;
  }

  // 自定义日期范围
  if (startDate && endDate) {
    params.start_date = startDate;
    params.end_date = endDate;
  }

  const response = await apiClient.get<DailyPostingStats>("/ozon/daily-posting-stats", { params });
  return response.data;
};

/**
 * 获取每日销售额统计
 */
export const getDailyRevenueStats = async (
  shopId?: number | null,
  rangeType?: string,
  startDate?: string,
  endDate?: string
) => {
  const params: { shop_id?: number; range_type?: string; start_date?: string; end_date?: string } = {};

  if (shopId) {
    params.shop_id = shopId;
  }

  if (rangeType) {
    params.range_type = rangeType;
  }

  // 自定义日期范围
  if (startDate && endDate) {
    params.start_date = startDate;
    params.end_date = endDate;
  }

  const response = await apiClient.get<DailyRevenueStats>("/ozon/daily-revenue-stats", { params });
  return response.data;
};
