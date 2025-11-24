/**
 * OZON 订单 API
 */

import { apiClient } from '../client';
import type { OrderFilter, ShipmentRequest, DiscardOrderRequest } from '../types/order';

/**
 * 获取订单列表（页码分页）
 */
export const getOrders = async (
  page: number = 1,
  limit: number = 50,
  filter?: OrderFilter,
) => {
  const params = {
    page: page,
    limit: limit,
    ...filter,
  };
  // 如果shop_id为null（全部店铺），不传递该参数
  if (params.shop_id === null) {
    delete params.shop_id;
  }
  const response = await apiClient.get("/ozon/orders", { params });
  return response.data;
};

/**
 * 获取订单详情
 */
export const getOrder = async (orderId: number) => {
  const response = await apiClient.get(`/ozon/orders/${orderId}`);
  return response.data;
};

/**
 * 同步订单
 */
export const syncOrders = async (
  shopId?: number | null,
  dateFrom?: string,
  dateTo?: string,
) => {
  // 如果没有指定店铺，获取第一个店铺
  if (!shopId) {
    const shopsResponse = await apiClient.get("/ozon/shops");
    const shops = shopsResponse.data.data;
    if (!shops || shops.length === 0) {
      throw new Error("没有找到可用的店铺");
    }
    shopId = shops[0].id;
  }

  // 根据是否有日期范围决定同步模式
  const mode = dateFrom && dateTo ? "full" : "incremental";

  const response = await apiClient.post(`/ozon/shops/${shopId}/sync`, null, {
    params: {
      sync_type: "orders",
      orders_mode: mode,
    },
  });
  return response.data;
};

/**
 * 直接同步订单（新接口）
 */
export const syncOrdersDirect = async (
  shopId: number,
  mode: "full" | "incremental" = "incremental",
) => {
  const response = await apiClient.post("/ozon/orders/sync", {
    shop_id: shopId,
    mode: mode,
  });
  return response.data;
};

/**
 * 同步单个订单
 */
export const syncSingleOrder = async (
  postingNumber: string,
  shopId: number,
) => {
  const response = await apiClient.post(
    `/ozon/orders/${postingNumber}/sync`,
    null,
    {
      params: {
        shop_id: shopId,
      },
    },
  );
  return response.data;
};

/**
 * 获取同步任务状态
 */
export const getSyncStatus = async (taskId: string) => {
  const response = await apiClient.get(`/ozon/sync/status/${taskId}`);
  return response.data;
};

/**
 * 发货
 */
export const shipOrder = async (shipment: ShipmentRequest) => {
  const response = await apiClient.post("/ozon/orders/ship", shipment);
  return response.data;
};

/**
 * 取消订单
 */
export const cancelOrder = async (postingNumber: string, reason: string) => {
  const response = await apiClient.post("/ozon/orders/cancel", {
    posting_number: postingNumber,
    reason,
  });
  return response.data;
};

/**
 * 废弃订单（可选同步到跨境84并更新本地状态）
 */
export const discardOrder = async (postingNumber: string, data: DiscardOrderRequest) => {
  const response = await apiClient.post(
    `/ozon/packing/postings/${postingNumber}/discard`,
    data
  );
  return response.data;
};
