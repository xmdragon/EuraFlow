/**
 * OZON 财务 API
 */

import { apiClient } from '../client';
import type {
  FinanceTransactionsResponse,
  FinanceTransactionsSummary,
  FinanceTransactionsFilter,
  FinanceTransactionsDailySummaryResponse
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
