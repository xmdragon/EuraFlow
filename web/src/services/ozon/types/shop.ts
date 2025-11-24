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
