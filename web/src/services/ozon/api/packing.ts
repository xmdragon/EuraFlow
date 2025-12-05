/**
 * OZON 打包发货 API
 */

import { apiClient } from '../client';
import type { PackingOrdersParams, PackingStatsParams, PackingStatsData, BatchPrintResult } from '../types/packing';

/**
 * 获取打包发货页面订单列表（支持操作状态筛选）
 */
export const getPackingOrders = async (
  page: number = 1,
  pageSize: number = 50,
  params?: PackingOrdersParams,
) => {
  const requestParams = {
    // 如果params中有offset，直接使用；否则根据page计算
    offset: params?.offset !== undefined ? params.offset : (page - 1) * pageSize,
    limit: pageSize,
    ...params,
  };
  // 如果shop_id为null（全部店铺），不传递该参数
  if (requestParams.shop_id === null) {
    delete requestParams.shop_id;
  }
  const response = await apiClient.get("/ozon/packing/orders", {
    params: requestParams,
  });
  return response.data;
};

/**
 * 获取打包发货各状态的统计数据（合并请求）
 */
export const getPackingStats = async (params?: PackingStatsParams): Promise<{
  success: boolean;
  data: PackingStatsData;
}> => {
  const requestParams = { ...params };
  // 如果shop_id为null（全部店铺），不传递该参数
  if (requestParams.shop_id === null) {
    delete requestParams.shop_id;
  }
  const response = await apiClient.get("/ozon/packing/stats", {
    params: requestParams,
  });
  return response.data;
};

/**
 * 批量打印快递面单（70x125mm竖向标签）
 *
 * @param postingNumbers 货件编号列表（最多20个）
 * @param weights 各货件的包装重量，key为posting_number，value为重量(克)
 * @returns 批量打印结果，包含PDF URL和详细错误信息
 * @note shop_id自动从posting记录中获取，无需手动指定
 */
export const batchPrintLabels = async (
  postingNumbers: string[],
  weights?: Record<string, number>,
): Promise<BatchPrintResult> => {
  if (postingNumbers.length > 20) {
    throw new Error("最多支持同时打印20个标签");
  }

  const response = await apiClient.post(
    "/ozon/packing/postings/batch-print-labels",
    {
      posting_numbers: postingNumbers,
      weights: weights,
    },
  );
  return response.data;
};
