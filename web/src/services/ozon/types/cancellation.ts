/**
 * OZON 取消和退货类型定义
 */

/**
 * 取消申请
 */
export interface Cancellation {
  id: number;
  cancellation_id: number;
  posting_number: string;
  order_date: string | null;
  cancelled_at: string | null;
  cancellation_initiator: string | null;
  cancellation_reason_name: string | null;
  state: string;
  state_name: string | null;
  auto_approve_date: string | null;
}

/**
 * 退货申请
 */
export interface Return {
  id: number;
  return_id: number;
  return_number: string;
  posting_number: string;
  order_number: string | null;
  client_name: string | null;
  product_name: string | null;
  offer_id: string | null;
  sku: number | null;
  price: string | null;
  currency_code: string | null;
  group_state: string;
  state: string; // 详细状态标识
  state_name: string | null;
  money_return_state_name: string | null;
  delivery_method_name: string | null; // 物流方式
  // 从详情API获取的字段
  return_reason_id: number | null;
  return_reason_name: string | null;
  rejection_reason_id: number | null;
  rejection_reason_name: string | null;
  return_method_description: string | null;
  created_at_ozon: string | null;
  // 商品图片（从商品表JOIN获取）
  image_url: string | null;
}

/**
 * 取消申请列表响应
 */
export interface CancellationListResponse {
  items: Cancellation[];
  total: number;
  page: number;
  limit: number;
}

/**
 * 退货申请列表响应
 */
export interface ReturnListResponse {
  items: Return[];
  total: number;
  page: number;
  limit: number;
}

/**
 * 取消申请筛选条件
 */
export interface CancellationFilter {
  page?: number;
  limit?: number;
  shop_id?: number | null;
  state?: string;
  initiator?: string;
  posting_number?: string;
  date_from?: string;
  date_to?: string;
}

/**
 * 退货申请筛选条件
 */
export interface ReturnFilter {
  page?: number;
  limit?: number;
  shop_id?: number | null;
  group_state?: string;
  posting_number?: string;
  offer_id?: string;
  date_from?: string;
  date_to?: string;
}
