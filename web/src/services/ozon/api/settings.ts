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
 * 汇率信息类型
 */
export interface ExchangeRateInfo {
  cny_to_rub?: string;
  rub_to_cny?: string;
  updated_at?: string;
}

/**
 * 全局设置响应类型
 */
export interface GlobalSettingsResponse {
  settings: Record<string, {
    setting_key: string;
    setting_value: Record<string, unknown>;
    description?: string;
  }>;
  exchange_rate?: ExchangeRateInfo;
}

/**
 * 获取所有全局设置
 */
export const getGlobalSettings = async (): Promise<GlobalSettingsResponse> => {
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
