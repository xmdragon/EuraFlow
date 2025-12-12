/**
 * OZON 店铺类型定义
 */

/**
 * 店铺数据结构
 */
export interface ShopData {
  shop_name: string;
  shop_name_cn?: string;
  client_id: string;
  api_key: string;
  platform?: string;
  shipping_managed?: boolean;  // 发货托管：启用后发货员可操作该店铺订单
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * API 认证凭据
 */
export interface ApiCredentials {
  client_id: string;
  api_key: string;
}
