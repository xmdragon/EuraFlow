/**
 * 翻译API服务（支持阿里云翻译和ChatGPT翻译）
 */
import axios from 'axios';

import authService from './authService';

const API_BASE = '/api/ef/v1';

// ===== 阿里云翻译类型定义 =====
export interface AliyunTranslationConfig {
  id: number;
  access_key_id?: string;
  region_id: string;
  enabled: boolean;
  is_default: boolean;
  last_test_at?: string;
  last_test_success?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AliyunTranslationConfigRequest {
  access_key_id: string;
  access_key_secret?: string; // 留空表示不修改
  region_id?: string;
  enabled?: boolean;
}

// ===== ChatGPT翻译类型定义 =====
export interface ChatGPTTranslationConfig {
  id: number;
  base_url?: string;
  model_name: string;
  temperature: number;
  system_prompt: string;
  enabled: boolean;
  is_default: boolean;
  last_test_at?: string;
  last_test_success?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatGPTTranslationConfigRequest {
  api_key?: string; // 留空表示不修改
  base_url?: string;
  model_name?: string;
  temperature?: number;
  system_prompt?: string;
  enabled?: boolean;
}

// ===== 兼容性类型（已废弃，仅用于向后兼容）=====
/** @deprecated 使用 AliyunTranslationConfig 代替 */
export type TranslationConfig = AliyunTranslationConfig;
/** @deprecated 使用 AliyunTranslationConfigRequest 代替 */
export type TranslationConfigRequest = AliyunTranslationConfigRequest;

// ===== 通用翻译API =====
/**
 * 获取当前激活的翻译引擎类型
 */
export const getActiveProvider = async (): Promise<'aliyun' | 'chatgpt' | 'none'> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.get(`${API_BASE}/ozon/translation/active-provider`, {
    headers: authHeaders,
  });
  return response.data.data.provider;
};

// ===== 阿里云翻译API =====
/**
 * 获取阿里云翻译配置
 */
export const getAliyunTranslationConfig = async (): Promise<AliyunTranslationConfig | null> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.get(`${API_BASE}/ozon/translation/aliyun/config`, {
    headers: authHeaders,
  });
  return response.data.data;
};

/**
 * 保存阿里云翻译配置
 */
export const saveAliyunTranslationConfig = async (
  config: AliyunTranslationConfigRequest
): Promise<AliyunTranslationConfig> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.post(`${API_BASE}/ozon/translation/aliyun/config`, config, {
    headers: authHeaders,
  });
  return response.data.data;
};

/**
 * 测试阿里云翻译服务连接
 */
export const testAliyunTranslationConnection = async (): Promise<void> => {
  const authHeaders = authService.getAuthHeader();
  await axios.post(`${API_BASE}/ozon/translation/aliyun/config/test`, {}, {
    headers: authHeaders,
  });
};

/**
 * 设置阿里云翻译为默认引擎
 */
export const setAliyunTranslationAsDefault = async (): Promise<void> => {
  const authHeaders = authService.getAuthHeader();
  await axios.put(`${API_BASE}/ozon/translation/aliyun/set-default`, {}, {
    headers: authHeaders,
  });
};

// ===== ChatGPT翻译API =====
/**
 * 获取ChatGPT翻译配置
 */
export const getChatGPTTranslationConfig = async (): Promise<ChatGPTTranslationConfig | null> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.get(`${API_BASE}/ozon/translation/chatgpt/config`, {
    headers: authHeaders,
  });
  return response.data.data;
};

/**
 * 保存ChatGPT翻译配置
 */
export const saveChatGPTTranslationConfig = async (
  config: ChatGPTTranslationConfigRequest
): Promise<ChatGPTTranslationConfig> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.post(`${API_BASE}/ozon/translation/chatgpt/config`, config, {
    headers: authHeaders,
  });
  return response.data.data;
};

/**
 * 测试ChatGPT翻译服务连接
 */
export const testChatGPTTranslationConnection = async (): Promise<void> => {
  const authHeaders = authService.getAuthHeader();
  await axios.post(`${API_BASE}/ozon/translation/chatgpt/config/test`, {}, {
    headers: authHeaders,
  });
};

/**
 * 设置ChatGPT翻译为默认引擎
 */
export const setChatGPTTranslationAsDefault = async (): Promise<void> => {
  const authHeaders = authService.getAuthHeader();
  await axios.put(`${API_BASE}/ozon/translation/chatgpt/set-default`, {}, {
    headers: authHeaders,
  });
};

// ===== 兼容性API（已废弃）=====
/** @deprecated 使用 getAliyunTranslationConfig 代替 */
export const getTranslationConfig = getAliyunTranslationConfig;
/** @deprecated 使用 saveAliyunTranslationConfig 代替 */
export const saveTranslationConfig = saveAliyunTranslationConfig;
/** @deprecated 使用 testAliyunTranslationConnection 代替 */
export const testTranslationConnection = testAliyunTranslationConnection;

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
