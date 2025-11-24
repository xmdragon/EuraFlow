/**
 * OZON 打包发货类型定义
 */

/**
 * 批量打印失败的货件
 */
export interface FailedPosting {
  posting_number: string;
  error: string;
  suggestion: string;
}

/**
 * 批量打印结果
 */
export interface BatchPrintResult {
  success: boolean;
  message: string;
  pdf_url?: string;
  cached_count?: number;
  fetched_count?: number;
  total?: number;
  error?: string;
  failed_postings?: FailedPosting[];
  success_postings?: string[];
}

/**
 * 打包订单查询参数
 */
export interface PackingOrdersParams {
  shop_id?: number | null;
  posting_number?: string;
  sku?: string; // SKU搜索
  tracking_number?: string; // OZON追踪号码搜索
  domestic_tracking_number?: string; // 国内单号搜索
  delivery_method?: string; // 配送方式搜索（左匹配）
  operation_status?: string; // awaiting_stock/allocating/allocated/tracking_confirmed
  ozon_status?: string; // OZON原生状态，支持逗号分隔（如：awaiting_packaging,awaiting_deliver）
  source_platform?: string; // 采购平台筛选
  offset?: number; // 直接指定offset（用于无限滚动，优先级高于page计算）
}

/**
 * 打包统计参数
 */
export interface PackingStatsParams {
  shop_id?: number | null;
  posting_number?: string;
  sku?: string;
  tracking_number?: string;
  domestic_tracking_number?: string;
}

/**
 * 打包统计数据
 */
export interface PackingStatsData {
  awaiting_stock: number;
  allocating: number;
  allocated: number;
  tracking_confirmed: number;
  printed: number;
  shipping: number;
}
