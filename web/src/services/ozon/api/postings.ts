/**
 * OZON 发货单（Posting）API
 */

import { apiClient } from '../client';
import type {
  PrepareStockRequest,
  UpdateBusinessInfoRequest,
  SubmitDomesticTrackingRequest,
  UpdateDomesticTrackingRequest,
  OrderExtraInfo
} from '../types/posting';

/**
 * 提交备货请求
 */
export const prepareOrder = async (postingNumber: string) => {
  const response = await apiClient.post("/ozon/orders/prepare", {
    posting_number: postingNumber,
  });
  return response.data;
};

/**
 * 备货操作：保存业务信息 + 调用 OZON exemplar set API
 */
export const prepareStock = async (
  postingNumber: string,
  data: PrepareStockRequest,
) => {
  const response = await apiClient.post(
    `/ozon/postings/${postingNumber}/prepare`,
    data,
  );
  return response.data;
};

/**
 * 更新业务信息（不改变操作状态）
 */
export const updatePostingBusinessInfo = async (
  postingNumber: string,
  data: UpdateBusinessInfoRequest,
) => {
  const response = await apiClient.patch(
    `/ozon/postings/${postingNumber}`,
    data,
  );
  return response.data;
};

/**
 * 填写国内物流单号 + 同步跨境巴士
 */
export const submitDomesticTracking = async (
  postingNumber: string,
  data: SubmitDomesticTrackingRequest,
) => {
  const response = await apiClient.post(
    `/ozon/postings/${postingNumber}/domestic-tracking`,
    data,
  );
  return response.data;
};

/**
 * 更新国内物流单号列表（用于修正错误单号）
 */
export const updateDomesticTracking = async (
  postingNumber: string,
  data: UpdateDomesticTrackingRequest,
) => {
  const response = await apiClient.patch(
    `/ozon/postings/${postingNumber}/domestic-tracking`,
    data,
  );
  return response.data;
};

/**
 * 更新订单额外信息
 */
export const updateOrderExtraInfo = async (
  postingNumber: string,
  extraInfo: OrderExtraInfo,
) => {
  const response = await apiClient.put(
    `/ozon/orders/${postingNumber}/extra-info`,
    extraInfo,
  );
  return response.data;
};

/**
 * 根据追踪号码查询货件
 */
export const searchPostingByTracking = async (trackingNumber: string) => {
  const response = await apiClient.get(
    "/ozon/packing/postings/search-by-tracking",
    {
      params: { tracking_number: trackingNumber },
    },
  );
  return response.data;
};

/**
 * 标记货件为已打印状态
 */
export const markPostingPrinted = async (postingNumber: string) => {
  const response = await apiClient.post(
    `/ozon/packing/postings/${postingNumber}/mark-printed`,
  );
  return response.data;
};

/**
 * 从跨境巴士同步单个发货单的打包费用
 */
export const syncMaterialCost = async (postingNumber: string) => {
  const response = await apiClient.post(
    `/ozon/postings/${postingNumber}/sync-material-cost`,
  );
  return response.data;
};

/**
 * 从 OZON 同步单个发货单的财务费用
 */
export const syncFinance = async (postingNumber: string) => {
  const response = await apiClient.post(
    `/ozon/postings/${postingNumber}/sync-finance`,
  );
  return response.data;
};
