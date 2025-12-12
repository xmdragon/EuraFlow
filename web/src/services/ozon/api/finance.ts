/**
 * OZON 财务 API
 */

import { apiClient } from '../client';
import type {
  FinanceTransactionsResponse,
  FinanceTransactionsSummary,
  FinanceTransactionsFilter,
  FinanceTransactionsDailySummaryResponse,
  InvoicePaymentsByPeriodResponse,
  FinanceHistorySyncRequest,
  FinanceHistorySyncResponse,
  FinanceHistorySyncProgress
} from '../types/finance';

/**
 * 获取财务交易列表
 */
export const getFinanceTransactions = async (
  filter: FinanceTransactionsFilter,
): Promise<FinanceTransactionsResponse> => {
  const response = await apiClient.get("/ozon/finance/transactions", {
    params: filter,
  });
  return response.data;
};

/**
 * 获取财务交易汇总
 */
export const getFinanceTransactionsSummary = async (
  shopId: number | null,
  dateFrom?: string,
  dateTo?: string,
  transactionType?: string,
  postingStatus?: string,
): Promise<FinanceTransactionsSummary> => {
  const params: { shop_id?: number; date_from?: string; date_to?: string; transaction_type?: string; posting_status?: string } = {};
  if (shopId !== null) params.shop_id = shopId;
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  if (transactionType) params.transaction_type = transactionType;
  if (postingStatus) params.posting_status = postingStatus;

  const response = await apiClient.get("/ozon/finance/transactions/summary", {
    params,
  });
  return response.data;
};

/**
 * 获取财务交易按日期汇总
 */
export const getFinanceTransactionsDailySummary = async (
  filter: FinanceTransactionsFilter,
): Promise<FinanceTransactionsDailySummaryResponse> => {
  const response = await apiClient.get("/ozon/finance/transactions/daily-summary", {
    params: filter,
  });
  return response.data;
};

/**
 * 按周期查询账单付款
 */
export const getInvoicePaymentsByPeriod = async (
  shopId: number | null,
  periodStart: string,
  periodEnd: string
): Promise<InvoicePaymentsByPeriodResponse> => {
  const params: Record<string, unknown> = {
    period_start: periodStart,
    period_end: periodEnd
  };
  if (shopId !== null) params.shop_id = shopId;

  const response = await apiClient.get("/ozon/invoice-payments/by-period", { params });
  return response.data;
};

/**
 * 启动财务历史数据同步
 */
export const startFinanceHistorySync = async (
  request: FinanceHistorySyncRequest
): Promise<FinanceHistorySyncResponse> => {
  const response = await apiClient.post("/ozon/finance/history-sync", request);
  return response.data;
};

/**
 * 获取财务历史同步进度
 */
export const getFinanceHistorySyncProgress = async (
  taskId: string
): Promise<FinanceHistorySyncProgress> => {
  const response = await apiClient.get(`/ozon/finance/history-sync/${taskId}/progress`);
  return response.data;
};
