/**
 * 象寄图片API服务
 */
import axios from 'axios';

import authService from './authService';

const API_BASE = '/api/ef/v1';

export interface XiangjifanyiConfig {
  id: number;
  phone?: string;
  api_url?: string;
  enabled: boolean;
  last_test_at?: string;
  last_test_success?: boolean;
  created_at: string;
  updated_at: string;
}

export interface XiangjifanyiConfigRequest {
  phone?: string;
  password?: string;
  api_url?: string;
  user_key?: string;
  video_trans_key?: string;
  fetch_key?: string;
  img_trans_key_ali?: string;
  img_trans_key_google?: string;
  img_trans_key_papago?: string;
  img_trans_key_deepl?: string;
  img_trans_key_chatgpt?: string;
  img_trans_key_baidu?: string;
  img_matting_key?: string;
  text_trans_key?: string;
  aigc_key?: string;
  enabled?: boolean;
}

/**
 * 获取象寄图片配置
 */
export const getXiangjifanyiConfig = async (): Promise<XiangjifanyiConfig | null> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.get(`${API_BASE}/ozon/xiangjifanyi/config`, {
    headers: authHeaders,
  });
  return response.data.data;
};

/**
 * 保存象寄图片配置
 */
export const saveXiangjifanyiConfig = async (
  config: XiangjifanyiConfigRequest
): Promise<XiangjifanyiConfig> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.post(`${API_BASE}/ozon/xiangjifanyi/config`, config, {
    headers: authHeaders,
  });
  return response.data.data;
};

/**
 * 测试象寄图片服务连接
 */
export const testXiangjifanyiConnection = async (): Promise<void> => {
  const authHeaders = authService.getAuthHeader();
  await axios.post(`${API_BASE}/ozon/xiangjifanyi/config/test`, {}, {
    headers: authHeaders,
  });
};

/**
 * 翻译结果
 */
export interface TranslationResult {
  url: string;
  translated_url?: string;
  request_id?: string;
  success: boolean;
  error?: string;
}

/**
 * 单张图片翻译
 */
export const translateSingleImage = async (
  imageUrl: string,
  engineType: number
): Promise<TranslationResult> => {
  try {
    const authHeaders = authService.getAuthHeader();
    const response = await axios.post(
      `${API_BASE}/ozon/xiangjifanyi/translate-single`,
      {
        image_url: imageUrl,
        engine_type: engineType,
        source_language: 'CHS',
        target_language: 'RUS',
      },
      {
        headers: authHeaders,
      }
    );

    // 映射后端返回的数据到前端格式
    const data = response.data.data;
    const result = {
      url: data.original_url || imageUrl,
      translated_url: data.url,
      request_id: data.request_id,
      success: true,
    };

    return result;
  } catch (error: any) {
    // 返回错误信息
    return {
      url: imageUrl,
      success: false,
      error: error.response?.data?.detail?.detail || error.message || '翻译失败',
    };
  }
};

/**
 * 批量图片翻译
 */
export const translateBatchImages = async (
  imageUrls: string[],
  engineType: number
): Promise<{ request_id: string; message: string; total: number }> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.post(
    `${API_BASE}/ozon/xiangjifanyi/translate-batch`,
    {
      image_urls: imageUrls,
      engine_type: engineType,
      source_language: 'CHS',
      target_language: 'RUS',
    },
    {
      headers: authHeaders,
    }
  );
  return response.data.data;
};

/**
 * 查询翻译结果（用于轮询）
 */
export const getTranslationResult = async (
  requestId: string
): Promise<{ completed: boolean; results?: TranslationResult[]; error?: string }> => {
  const authHeaders = authService.getAuthHeader();
  const response = await axios.get(
    `${API_BASE}/ozon/xiangjifanyi/translate-result/${requestId}`,
    {
      headers: authHeaders,
    }
  );
  return response.data.data;
};
