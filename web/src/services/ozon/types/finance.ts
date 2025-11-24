/**
 * OZON 财务类型定义
 */

/**
 * 财务交易
 */
export interface FinanceTransaction {
  id: number;
  shop_id: number;
  operation_id: number;
  operation_type: string;
  operation_type_name?: string;
  transaction_type: string;
  posting_number?: string;
  operation_date: string;
  accruals_for_sale: string;
  amount: string;
  delivery_charge: string;
  return_delivery_charge: string;
  sale_commission: string;
  ozon_sku?: string;
  item_name?: string;
  item_quantity?: number;
  item_price?: string;
  posting_delivery_schema?: string;
  posting_warehouse_name?: string;
  created_at: string;
}

/**
 * 财务交易响应
 */
export interface FinanceTransactionsResponse {
  items: FinanceTransaction[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * 财务交易汇总
 */
export interface FinanceTransactionsSummary {
  total_amount: string;
  total_accruals_for_sale: string;
  total_sale_commission: string;
  total_delivery_charge: string;
  total_return_delivery_charge: string;
  transaction_count: number;
}

/**
 * 财务交易筛选条件
 */
export interface FinanceTransactionsFilter {
  shop_id?: number | null;
  date_from?: string;
  date_to?: string;
  transaction_type?: string;
  operation_type?: string;
  posting_number?: string;
  posting_status?: string;
  page?: number;
  page_size?: number;
}

/**
 * 财务交易按日期汇总
 */
export interface FinanceTransactionDailySummary {
  operation_date: string;
  transaction_count: number;
  total_amount: string;
  total_accruals_for_sale: string;
  total_sale_commission: string;
  total_delivery_charge: string;
  total_return_delivery_charge: string;
}

/**
 * 财务交易按日期汇总响应
 */
export interface FinanceTransactionsDailySummaryResponse {
  items: FinanceTransactionDailySummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
