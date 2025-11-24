/**
 * OZON 全局设置 API
 */

import { apiClient } from '../client';

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
