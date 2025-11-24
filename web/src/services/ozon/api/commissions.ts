/**
 * OZON 类目佣金 API
 */

import { apiClient } from '../client';

/**
 * 查询类目佣金列表
 */
export const getCategoryCommissions = async (params: {
  page: number;
  page_size: number;
  module?: string;
  search?: string;
}): Promise<unknown> => {
  const response = await apiClient.get("/ozon/category-commissions", { params });
  return response.data;
};

/**
 * 获取类目模块列表
 */
export const getCategoryModules = async (): Promise<string[]> => {
  const response = await apiClient.get("/ozon/category-commissions/modules");
  return response.data;
};

/**
 * 更新类目佣金
 */
export const updateCategoryCommission = async (
  id: number,
  data: {
    rfbs_tier1: number;
    rfbs_tier2: number;
    rfbs_tier3: number;
    fbp_tier1: number;
    fbp_tier2: number;
    fbp_tier3: number;
  }
): Promise<unknown> => {
  const response = await apiClient.put(`/ozon/category-commissions/${id}`, data);
  return response.data;
};

/**
 * 导入类目佣金CSV
 */
export const importCommissionsCsv = async (formData: FormData): Promise<unknown> => {
  const response = await apiClient.post("/ozon/category-commissions/import-csv", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
};
