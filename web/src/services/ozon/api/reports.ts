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
  noCommission?: boolean,
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
  if (noCommission) {
    params.append("no_commission", "true");
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

/**
 * 获取 Posting 详情（包含商品列表）
 * 用于在报表列表中点击货件编号时查看完整商品信息
 */
export interface PostingDetailProduct {
  sku: string;
  offer_id?: string;
  name: string;
  quantity: number;
  price: string;
  image_url?: string;
}

export interface PostingDetailResponse {
  posting_number: string;
  shop_name: string;
  status: string;
  is_cancelled: boolean;
  created_at: string;
  in_process_at?: string;
  shipped_at?: string;
  delivered_at?: string;
  products: PostingDetailProduct[];
  product_count: number;
  order_amount: string;
  purchase_price: string;
  ozon_commission_cny: string;
  international_logistics_fee_cny: string;
  last_mile_delivery_fee_cny: string;
  material_cost: string;
  profit: string;
  profit_rate: number;
  warehouse_name?: string;
  delivery_method_name?: string;
  order_notes?: string;
  domestic_tracking_numbers?: string[];
}

export const getPostingDetail = async (
  postingNumber: string,
): Promise<PostingDetailResponse> => {
  const response = await apiClient.get(
    `/ozon/reports/postings/${encodeURIComponent(postingNumber)}`,
  );
  return response.data;
};
