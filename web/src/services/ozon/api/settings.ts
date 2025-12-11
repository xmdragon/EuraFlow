/**
 * OZON 全局设置 API
 */

import { apiClient } from '../client';

/**
 * 测试图片响应类型
 */
export interface TestImageResponse {
  image_url?: string;
  original_cdn?: string;
  error?: string;
}

/**
 * 获取所有全局设置
 */
export const getGlobalSettings = async (): Promise<unknown> => {
  const response = await apiClient.get("/ozon/global-settings");
  return response.data;
};

/**
 * 更新全局设置
 */
export const updateGlobalSetting = async (key: string, value: unknown): Promise<unknown> => {
  const response = await apiClient.put(`/ozon/global-settings/${key}`, {
    setting_value: value,
  });
  return response.data;
};

/**
 * 获取测试图片URL（用于CDN速度测试）
 */
export const getTestImage = async (): Promise<TestImageResponse> => {
  const response = await apiClient.get("/ozon/global-settings/test-image");
  return response.data;
};
