/**
 * API Key管理服务
 */
import axios from './axios';

const API_BASE_URL = '/api/ef/v1';

export interface APIKey {
  id: number;
  name: string;
  permissions: string[];
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAPIKeyRequest {
  name: string;
  permissions?: string[];
  expires_in_days?: number;
}

export interface CreateAPIKeyResponse {
  key_id: number;
  key: string; // 原始Key，仅在创建时返回
  name: string;
  permissions: string[];
  expires_at: string | null;
  created_at: string;
}

export interface RegenerateAPIKeyResponse {
  key_id: number;
  key: string; // 新的Key
  name: string;
  permissions: string[];
  expires_at: string | null;
  updated_at: string;
}

/**
 * 获取所有API Keys
 */
export const listAPIKeys = async (): Promise<APIKey[]> => {
  const response = await axios.get(`${API_BASE_URL}/api-keys/`);
  return response.data;
};

/**
 * 创建新的API Key
 */
export const createAPIKey = async (data: CreateAPIKeyRequest): Promise<CreateAPIKeyResponse> => {
  const response = await axios.post(`${API_BASE_URL}/api-keys/`, data);
  return response.data;
};

/**
 * 删除API Key
 */
export const deleteAPIKey = async (keyId: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/api-keys/${keyId}`);
};

/**
 * 重新生成API Key
 */
export const regenerateAPIKey = async (keyId: number): Promise<RegenerateAPIKeyResponse> => {
  const response = await axios.put(`${API_BASE_URL}/api-keys/${keyId}/regenerate`);
  return response.data;
};
