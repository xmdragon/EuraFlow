import axios from 'axios';

import authService from './authService';
import { loggers } from '@/utils/logger';

// 防抖：避免多个401请求同时触发跳转
let isRedirecting = false;

// 请求拦截器 - 添加token
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

// 响应拦截器 - 处理401错误
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;

    // 如果是401错误（未授权）
    if (status === 401) {
      loggers.auth.warn('检测到401错误，Token可能已过期', {
        url: error.config?.url,
        timestamp: new Date().toISOString(),
      });

      // 避免重复跳转
      if (isRedirecting) {
        return Promise.reject(error);
      }

      // 清除token
      authService.clearTokens();

      // 避免在登录页再次跳转
      if (window.location.pathname !== '/login') {
        isRedirecting = true;

        // 延迟跳转，让React组件有时间清理状态
        setTimeout(() => {
          loggers.auth.info('Token已过期，跳转到登录页');
          window.location.href = '/login';
        }, 100);
      }
    }

    // 如果是403错误（无权限）
    if (status === 403) {
      loggers.auth.warn('检测到403错误，权限不足', {
        url: error.config?.url,
        timestamp: new Date().toISOString(),
      });
    }

    return Promise.reject(error);
  }
);

export default axios;
