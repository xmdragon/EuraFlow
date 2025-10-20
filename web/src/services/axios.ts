/* eslint-disable no-unused-vars */
import axios from 'axios';

import authService from './authService';

// 请求拦截器
axios.interceptors.request.use(
  (config) => {
    const token = authService.accessToken;
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
let isRefreshing = false;
interface QueueItem {
  resolve: (token: string | null) => void;
  reject: (error: unknown) => void;
}

let failedQueue: QueueItem[] = [];

const processQueue = (_error: unknown, _token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (_error) {
      prom.reject(_error);
    } else {
      prom.resolve(_token);
    }
  });
  failedQueue = [];
};

/**
 * 检查是否是认证相关错误
 */
const isAuthenticationError = (error: any): boolean => {
  const status = error.response?.status;

  // 明确的认证错误状态码
  if (status === 401 || status === 403) {
    return true;
  }

  // 500错误可能是token解析失败导致的
  if (status === 500) {
    const data = error.response?.data;
    const errorMessage = JSON.stringify(data || '').toLowerCase();

    // 检查错误信息中是否包含认证相关关键词
    const authKeywords = [
      'token',
      'authentication',
      'unauthorized',
      'jwt',
      'expired',
      'invalid signature',
      'decode',
      'not authenticated',
      'login required'
    ];

    return authKeywords.some(keyword => errorMessage.includes(keyword));
  }

  return false;
};

/**
 * 处理认证失败：清除token并跳转登录页
 */
const handleAuthenticationFailure = (message: string = '登录已过期，请重新登录') => {
  authService.clearTokens();

  // 避免在登录页重复跳转
  if (window.location.pathname !== '/login') {
    // 使用动态导入避免循环依赖
    import('antd').then(({ message: antdMessage }) => {
      antdMessage.warning(message);
    }).catch(() => {
      // 如果antd加载失败，使用原生alert
      alert(message);
    });

    // 延迟跳转，让用户看到提示
    setTimeout(() => {
      window.location.href = '/login';
    }, 500);
  }
};

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 如果是登录页或刷新token请求，不处理
    if (
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/refresh')
    ) {
      return Promise.reject(error);
    }

    // 检查是否是认证相关错误（包括401/403/500等）
    if (isAuthenticationError(error)) {
      const status = error.response?.status;

      // 500错误直接清除token并跳转，不尝试刷新
      if (status === 500) {
        handleAuthenticationFailure('认证信息异常，请重新登录');
        return Promise.reject(error);
      }

      // 401错误尝试刷新token
      if (status === 401 && !originalRequest._retry) {
        // 如果没有refresh token，直接跳转登录页
        if (!authService.refreshToken) {
          handleAuthenticationFailure();
          return Promise.reject(error);
        }

        if (isRefreshing) {
          // 如果正在刷新，将请求加入队列
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          })
            .then(() => {
              originalRequest.headers['Authorization'] = `Bearer ${authService.accessToken}`;
              return axios(originalRequest);
            })
            .catch((err) => {
              return Promise.reject(err);
            });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          await authService.refresh();
          processQueue(null);
          isRefreshing = false;
          originalRequest.headers['Authorization'] = `Bearer ${authService.accessToken}`;
          return axios(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError, null);
          isRefreshing = false;
          // 刷新失败，清除token并跳转到登录页
          handleAuthenticationFailure('登录已过期，请重新登录');
          return Promise.reject(refreshError);
        }
      }

      // 403错误直接跳转登录页
      if (status === 403) {
        handleAuthenticationFailure('没有访问权限，请重新登录');
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export default axios;
