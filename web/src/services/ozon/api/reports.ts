/**
 * OZON 报表 API
 */

import { apiClient } from '../client';

/**
 * 获取订单报表（旧版）
 */
export const getOrderReport = async (
  month: string,
  shopIds?: string,
): Promise<unknown> => {
  const params = new URLSearchParams({ month });
  if (shopIds) {
    params.append("shop_ids", shopIds);
  }
  const response = await apiClient.get(
    `/ozon/reports/orders?${params.toString()}`,
  );
  return response.data;
};

/**
 * 获取 Posting 级别报表（新版）
 */
export const getPostingReport = async (
  month: string,
  shopIds?: string,
  statusFilter: "delivered" | "placed" = "delivered",
  page: number = 1,
  pageSize: number = 50,
  sortBy?: string,
  sortOrder: "asc" | "desc" = "desc",
  postingNumber?: string,
): Promise<unknown> => {
  const params = new URLSearchParams({
    month,
    status_filter: statusFilter,
    page: page.toString(),
    page_size: pageSize.toString(),
    sort_order: sortOrder,
  });
  if (shopIds) {
    params.append("shop_ids", shopIds);
  }
  if (sortBy) {
    params.append("sort_by", sortBy);
  }
  if (postingNumber) {
    params.append("posting_number", postingNumber);
  }
  const response = await apiClient.get(
    `/ozon/reports/postings?${params.toString()}`,
  );
  return response.data;
};

/**
 * 获取报表汇总数据（用于图表）
 */
export const getReportSummary = async (
  month: string,
  shopIds?: string,
  statusFilter: "delivered" | "placed" = "delivered",
): Promise<unknown> => {
  const params = new URLSearchParams({
    month,
    status_filter: statusFilter,
  });
  if (shopIds) {
    params.append("shop_ids", shopIds);
  }
  const response = await apiClient.get(
    `/ozon/reports/summary?${params.toString()}`,
  );
  return response.data;
};

/**
 * 启动批量财务同步任务
 */
export const startBatchFinanceSync = async (): Promise<{
  task_id: string;
  message: string;
}> => {
  const response = await apiClient.post(`/ozon/reports/batch-sync-finance`);
  return response.data;
};

/**
 * 查询批量财务同步进度
 */
export const getBatchFinanceSyncProgress = async (
  taskId: string,
): Promise<unknown> => {
  const response = await apiClient.get(
    `/ozon/reports/batch-sync-finance/${taskId}`,
  );
  return response.data;
};
