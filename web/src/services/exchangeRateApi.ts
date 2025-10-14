/**
 * 汇率管理 API 服务
 * 处理与后端汇率接口的通信
 */
import axios from 'axios';
import authService from './authService';

const API_BASE = '/api/ef/v1';

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：添加认证token
apiClient.interceptors.request.use(
  (config) => {
    const authHeaders = authService.getAuthHeader();
    if (authHeaders.Authorization) {
      config.headers.Authorization = authHeaders.Authorization;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器：处理错误和token刷新
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshed = await authService.refreshToken();
      if (refreshed) {
        const authHeaders = authService.getAuthHeader();
        originalRequest.headers.Authorization = authHeaders.Authorization;
        return apiClient(originalRequest);
      } else {
        authService.logout();
      }
    }
    return Promise.reject(error);
  }
);

// ==================== 类型定义 ====================

export interface ExchangeRateConfig {
  id: number;
  api_provider: string;
  is_enabled: boolean;
  base_currency: string;
}

export interface ExchangeRateConfigRequest {
  api_key: string;
  api_provider?: string;
  base_currency?: string;
  is_enabled?: boolean;
}

export interface ExchangeRate {
  from_currency: string;
  to_currency: string;
  rate: string;
  cached: boolean;
}

export interface ConvertRequest {
  amount: string;
  from_currency?: string;
  to_currency?: string;
}

export interface ConvertResponse {
  amount: string;
  from_currency: string;
  to_currency: string;
  rate: string;
  converted_amount: string;
}

export interface RateHistoryPoint {
  time: string;
  rate: number;
}

export interface RateHistoryResponse {
  from_currency: string;
  to_currency: string;
  time_range: string;
  data: RateHistoryPoint[];
}

export interface TestConnectionRequest {
  api_key: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  rate?: string;
}

// ==================== API 方法 ====================

/**
 * 配置汇率API
 */
export const configureExchangeRateApi = async (
  request: ExchangeRateConfigRequest
): Promise<ExchangeRateConfig> => {
  const response = await apiClient.post('/exchange-rates/config', request);
  return response.data;
};

/**
 * 获取汇率API配置（不含密钥）
 */
export const getExchangeRateConfig = async (): Promise<{
  configured: boolean;
  api_provider?: string;
  is_enabled?: boolean;
  base_currency?: string;
  message?: string;
}> => {
  const response = await apiClient.get('/exchange-rates/config');
  return response.data;
};

/**
 * 获取汇率
 */
export const getExchangeRate = async (
  from_currency: string = 'CNY',
  to_currency: string = 'RUB',
  force_refresh: boolean = false
): Promise<ExchangeRate> => {
  const response = await apiClient.get('/exchange-rates/rate', {
    params: {
      from_currency,
      to_currency,
      force_refresh,
    },
  });
  return response.data;
};

/**
 * 货币转换
 */
export const convertCurrency = async (
  request: ConvertRequest
): Promise<ConvertResponse> => {
  const response = await apiClient.post('/exchange-rates/convert', request);
  return response.data;
};

/**
 * 手动刷新汇率
 */
export const refreshExchangeRate = async (): Promise<{
  status: string;
  message: string;
  rate?: string;
  fetched_at?: string;
}> => {
  const response = await apiClient.post('/exchange-rates/refresh');
  return response.data;
};

/**
 * 获取汇率历史数据
 */
export const getExchangeRateHistory = async (
  from_currency: string = 'CNY',
  to_currency: string = 'RUB',
  time_range: 'today' | 'week' | 'month' = 'today'
): Promise<RateHistoryResponse> => {
  const response = await apiClient.get('/exchange-rates/history', {
    params: {
      from_currency,
      to_currency,
      range: time_range,
    },
  });
  return response.data;
};

/**
 * 测试API连接
 */
export const testExchangeRateConnection = async (
  api_key: string
): Promise<TestConnectionResponse> => {
  const response = await apiClient.post('/exchange-rates/test-connection', {
    api_key,
  });
  return response.data;
};
