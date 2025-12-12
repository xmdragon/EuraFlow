 
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

import authService from './authService';

// 扩展InternalAxiosRequestConfig以包含_retry属性
interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

// 类型保护：判断是否为AxiosError
const isAxiosError = (error: unknown): error is AxiosError => {
  return axios.isAxiosError(error);
};

// 全局状态标志
let isRefreshing = false;
let isSessionExpired = false; // 会话已被踢出，阻止后续请求

/**
 * 标记会话已过期（用于 WebSocket 收到踢出通知时调用）
 */
export const markSessionExpired = () => {
  isSessionExpired = true;
};

// 请求拦截器
axios.interceptors.request.use(
  (config) => {
    // 如果会话已被踢出，阻止所有请求
    if (isSessionExpired) {
      return Promise.reject(new Error('Session expired'));
    }

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
const isAuthenticationError = (error: unknown): boolean => {
  if (!isAxiosError(error)) return false;

  const status = error.response?.status;

  // 401是认证错误（未登录或token过期）
  if (status === 401) {
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
      'login required',
    ];

    return authKeywords.some((keyword) => errorMessage.includes(keyword));
  }

  return false;
};

/**
 * 处理权限不足错误（403）
 */
const handlePermissionDenied = (error: unknown) => {
  // 使用动态导入避免循环依赖
  import('antd')
    .then(({ message: antdMessage }) => {
      let errorDetail = '您没有执行此操作的权限';
      let errorCode = '';
      if (isAxiosError(error) && error.response?.data) {
        const data = error.response.data as {
          error?: { detail?: string; code?: string };
          detail?: string;
          code?: string;
        };
        errorDetail = data?.error?.detail || data?.detail || errorDetail;
        errorCode = data?.error?.code || data?.code || '';
      }

      // 检查是否是账号状态导致的写操作被拒绝
      if (errorCode === 'ACCOUNT_WRITE_FORBIDDEN') {
        antdMessage.warning(errorDetail);
      } else {
        antdMessage.error(`权限不足: ${errorDetail}`);
      }
    })
    .catch(() => {
      // 如果antd加载失败，使用原生alert
      alert('权限不足：您没有执行此操作的权限');
    });
};

/**
 * 处理认证失败：清除token并跳转登录页
 */
const handleAuthenticationFailure = (message: string = '登录已过期，请重新登录') => {
  authService.clearTokens();

  // 避免在登录页重复跳转
  if (window.location.pathname !== '/login') {
    // 使用动态导入避免循环依赖
    import('antd')
      .then(({ message: antdMessage }) => {
        antdMessage.warning(message);
      })
      .catch(() => {
        // 如果antd加载失败，使用原生alert
        alert(message);
      });

    // 延迟跳转，让用户看到提示
    setTimeout(() => {
      window.location.href = '/login';
    }, 500);
  }
};

/**
 * 处理会话被踢出：显示不可关闭的Modal，点击确定后跳转登录页
 */
const handleSessionExpired = () => {
  // 避免重复弹窗
  if (isSessionExpired) return;
  isSessionExpired = true;

  // 避免在登录页弹窗
  if (window.location.pathname === '/login') return;

  // 使用动态导入避免循环依赖
  import('antd')
    .then(({ Modal }) => {
      Modal.warning({
        title: '账号已在其他设备登录',
        content: '您的账号已在其他设备登录，当前会话已失效。请重新登录。',
        okText: '确定',
        closable: false,
        keyboard: false,
        maskClosable: false,
        centered: true,
        onOk: () => {
          authService.clearTokens();
          window.location.href = '/login';
        },
      });
    })
    .catch(() => {
      // 如果antd加载失败，使用原生alert
      alert('您的账号已在其他设备登录，当前会话已失效。请重新登录。');
      authService.clearTokens();
      window.location.href = '/login';
    });
};

axios.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!isAxiosError(error)) {
      return Promise.reject(error);
    }

    const originalRequest = error.config as CustomAxiosRequestConfig | undefined;

    // 如果是登录页或刷新token请求，不处理
    if (
      originalRequest?.url?.includes('/auth/login') ||
      originalRequest?.url?.includes('/auth/refresh')
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

      // 401错误处理
      if (status === 401 && !originalRequest?._retry) {
        // 检查是否是会话被踢出（别处登录）
        const errorCode = (error.response?.data as { error?: { code?: string } })?.error?.code;
        if (errorCode === 'SESSION_EXPIRED') {
          handleSessionExpired();
          return Promise.reject(error);
        }

        // 如果会话已被标记为过期，阻止后续请求
        if (isSessionExpired) {
          return Promise.reject(error);
        }

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
              if (originalRequest?.headers) {
                originalRequest.headers['Authorization'] = `Bearer ${authService.accessToken}`;
              }
              return axios(originalRequest);
            })
            .catch((err) => {
              return Promise.reject(err);
            });
        }

        if (originalRequest) {
          originalRequest._retry = true;
        }
        isRefreshing = true;

        try {
          await authService.refresh();
          processQueue(null);
          isRefreshing = false;
          if (originalRequest?.headers) {
            originalRequest.headers['Authorization'] = `Bearer ${authService.accessToken}`;
          }
          return axios(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError, null);
          isRefreshing = false;
          // 刷新失败，清除token并跳转到登录页
          handleAuthenticationFailure('登录已过期，请重新登录');
          return Promise.reject(refreshError);
        }
      }
    }

    // 403错误是权限不足，不是认证错误
    if (error.response?.status === 403) {
      handlePermissionDenied(error);
      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);

export default axios;
