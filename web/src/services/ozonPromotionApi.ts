/**
 * Ozon 促销活动 API 服务
 * 处理与后端促销接口的通信
 */
import axios from "axios";

import authService from "./authService";

const API_BASE = "/api/ef/v1";

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
});

// 请求拦截器：添加认证token
apiClient.interceptors.request.use(
  (config) => {
    const authHeaders = authService.getAuthHeader();
    if (authHeaders.Authorization) {
      config.headers.Authorization = authHeaders.Authorization;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 响应拦截器：处理错误和token刷新
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        await authService.refresh();
        const authHeaders = authService.getAuthHeader();
        originalRequest.headers.Authorization = authHeaders.Authorization;
        return apiClient(originalRequest);
      } catch {
        authService.logout();
      }
    }
    return Promise.reject(error);
  },
);

// ==================== 类型定义 ====================

/**
 * 促销活动信息
 */
export interface PromotionAction {
  id: number;
  shop_id?: number;
  action_id: number;
  title: string;
  description?: string;
  date_start: string;
  date_end: string;
  status?: string;
  auto_cancel_enabled: boolean;
  created_at?: string;
  updated_at?: string;
  last_sync_at?: string;
  // 统计字段
  candidate_count?: number;
  active_count?: number;
  // 从 raw_data 中提取的字段
  action_type?: string;
  action_status?: string;
  participation_type?: string;
  is_participating?: boolean;
  mechanics?: string;
  discount_info?: Record<string, unknown>;
  with_targeting?: boolean;
  title_for_buyer?: string;
  title_for_index?: string;
  order_amount_bound?: Record<string, unknown>;
  participants_type?: string;
  is_voucher_action?: boolean;
  raw_data?: Record<string, unknown>;
}

/**
 * 促销商品信息（候选或参与）
 */
export interface PromotionProduct {
  id: number;
  shop_id?: number;
  action_id?: number;
  product_id: number;
  ozon_product_id?: number;
  ozon_sku?: number;    // OZON平台SKU
  sku?: string;         // SKU（商品唯一标识）
  status?: "candidate" | "active" | "deactivated";
  add_mode?: "manual" | "automatic";
  promotion_price?: number;
  promotion_stock?: number;
  activated_at?: string;
  // 关联的商品详细信息（从 OzonProduct 表）
  title?: string;        // 商品标题
  price?: number;        // 商品价格
  stock?: number;        // 商品库存
  images?: {             // 商品图片对象
    primary?: string;    // 主图
    additional?: string[]; // 附加图片
  };
}

/**
 * 添加商品到促销的请求
 */
export interface ActivateProductRequest {
  product_id: number;
  promotion_price: string;
  promotion_stock: number;
}

/**
 * 批量添加商品请求
 */
export interface ActivateProductsRequest {
  products: ActivateProductRequest[];
}

/**
 * 批量取消商品请求
 */
export interface DeactivateProductsRequest {
  product_ids: number[];
}

/**
 * 设置自动取消请求
 */
export interface AutoCancelRequest {
  enabled: boolean;
}

/**
 * 设置加入方式请求
 */
export interface SetAddModeRequest {
  add_mode: "manual" | "automatic";
}

/**
 * API 响应包装
 */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    type: string;
    title: string;
    status: number;
    detail?: string;
    code: string;
  };
}

// ==================== 促销活动 API ====================

/**
 * 同步店铺的促销活动和商品数据
 */
export const syncPromotions = async (
  shopId: number,
): Promise<ApiResponse<{
  synced_actions: number;
  synced_candidates: number;
  synced_products: number;
}>> => {
  const response = await apiClient.post(`/ozon/shops/${shopId}/promotions/sync`);
  return response.data;
};

/**
 * 获取店铺的促销活动列表（带统计）
 */
export const getActions = async (
  shopId: number,
): Promise<ApiResponse<PromotionAction[]>> => {
  const response = await apiClient.get(`/ozon/shops/${shopId}/promotions/actions`);
  return response.data;
};

/**
 * 获取活动的候选商品列表
 */
export const getCandidates = async (
  shopId: number,
  actionId: number,
): Promise<ApiResponse<PromotionProduct[]>> => {
  const response = await apiClient.get(
    `/ozon/shops/${shopId}/promotions/actions/${actionId}/candidates`,
  );
  return response.data;
};

/**
 * 获取活动的参与商品列表
 */
export const getActiveProducts = async (
  shopId: number,
  actionId: number,
): Promise<ApiResponse<PromotionProduct[]>> => {
  const response = await apiClient.get(
    `/ozon/shops/${shopId}/promotions/actions/${actionId}/products`,
  );
  return response.data;
};

/**
 * 添加商品到促销活动
 */
export const activateProducts = async (
  shopId: number,
  actionId: number,
  request: ActivateProductsRequest,
): Promise<
  ApiResponse<{
    success_count: number;
    failed_count: number;
    results: Array<{ product_id: number; success: boolean; error?: string }>;
  }>
> => {
  const response = await apiClient.post(
    `/ozon/shops/${shopId}/promotions/actions/${actionId}/activate`,
    request,
  );
  return response.data;
};

/**
 * 从促销活动中移除商品
 */
export const deactivateProducts = async (
  shopId: number,
  actionId: number,
  request: DeactivateProductsRequest,
): Promise<
  ApiResponse<{
    success_count: number;
    failed_count: number;
    results: Array<{ product_id: number; success: boolean; error?: string }>;
  }>
> => {
  const response = await apiClient.post(
    `/ozon/shops/${shopId}/promotions/actions/${actionId}/deactivate`,
    request,
  );
  return response.data;
};

/**
 * 切换活动的自动取消开关
 */
export const setAutoCancel = async (
  shopId: number,
  actionId: number,
  request: AutoCancelRequest,
): Promise<
  ApiResponse<{
    action_id: number;
    auto_cancel_enabled: boolean;
  }>
> => {
  const response = await apiClient.put(
    `/ozon/shops/${shopId}/promotions/actions/${actionId}/auto-cancel`,
    request,
  );
  return response.data;
};

/**
 * 切换商品的加入方式（手动/自动）
 */
export const setAddMode = async (
  shopId: number,
  actionId: number,
  productId: number,
  request: SetAddModeRequest,
): Promise<
  ApiResponse<{
    product_id: number;
    add_mode: string;
  }>
> => {
  const response = await apiClient.put(
    `/ozon/shops/${shopId}/promotions/actions/${actionId}/products/${productId}/add-mode`,
    request,
  );
  return response.data;
};

export default {
  syncPromotions,
  getActions,
  getCandidates,
  getActiveProducts,
  activateProducts,
  deactivateProducts,
  setAutoCancel,
  setAddMode,
};
