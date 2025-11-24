/**
 * OZON API 客户端配置
 *
 * 共享的 axios 实例，包含：
 * - 认证拦截器
 * - Token 自动刷新
 * - 统一错误处理
 */
import axios from 'axios';
import authService from '../authService';

const API_BASE = '/api/ef/v1';

// 创建 axios 实例
export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：添加认证 token
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

// 响应拦截器：处理错误和 token 刷新
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // 尝试刷新 token
      try {
        await authService.refresh();
        // 重新设置认证头并重试请求
        const authHeaders = authService.getAuthHeader();
        originalRequest.headers.Authorization = authHeaders.Authorization;
        return apiClient(originalRequest);
      } catch {
        // 刷新失败，跳转登录
        authService.logout();
      }
    }
    return Promise.reject(error);
  }
);
