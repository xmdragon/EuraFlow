/**
 * 阿里云翻译API服务
 */
import axios from 'axios';

import authService from './authService';

const API_BASE = '/api/ef/v1';

export interface TranslationConfig {
  id: number;
  access_key_id?: string;
  region_id: string;
  enabled: boolean;
  last_test_at?: string;
  last_test_success?: boolean;
  created_at: string;
  updated_at: string;
}

export interface TranslationConfigRequest {
  access_key_id: string;
  access_key_secret: string;
  region_id?: string;
  enabled?: boolean;
}

/**
 * 获取翻译配置
 */
export const getTranslationConfig = async (): Promise<TranslationConfig | null> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.get(`${API_BASE}/ozon/translation/config`, {
    headers: authHeaders,
  });
  return response.data.data;
};

/**
 * 保存翻译配置
 */
export const saveTranslationConfig = async (
  config: TranslationConfigRequest
): Promise<TranslationConfig> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.post(`${API_BASE}/ozon/translation/config`, config, {
    headers: authHeaders,
  });
  return response.data.data;
};

/**
 * 测试翻译服务连接
 */
export const testTranslationConnection = async (): Promise<void> => {
  const authHeaders = authService.getAuthHeader();
  await axios.post(`${API_BASE}/ozon/translation/config/test`, {}, {
    headers: authHeaders,
  });
};

/**
 * 懒加载翻译消息
 */
export const translateMessage = async (
  shopId: number,
  chatId: string,
  messageId: string
): Promise<string> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.post(
    `${API_BASE}/ozon/translation/chats/${shopId}/${chatId}/messages/${messageId}/translate`,
    {},
    {
      headers: authHeaders,
    }
  );
  return response.data.data.translation;
};
