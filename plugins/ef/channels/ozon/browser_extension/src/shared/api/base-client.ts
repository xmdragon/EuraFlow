/**
 * 基础 API 客户端
 *
 * 提供统一的 HTTP 请求封装：
 * - 统一错误处理
 * - 集成频率限制器
 * - 支持重试机制
 * - 支持 Service Worker 和 Content Script 两种调用方式
 */

import { OzonApiRateLimiter } from '../ozon-rate-limiter';

/**
 * API 错误
 */
export interface ApiError {
  code: string;
  message: string;
  status?: number;
  details?: any;
}

/**
 * API 客户端配置
 */
export interface ApiClientConfig {
  /** 是否使用频率限制器 */
  useRateLimiter?: boolean;
  /** 默认请求头 */
  defaultHeaders?: Record<string, string>;
  /** 请求超时（毫秒） */
  timeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * 基础 API 客户端（抽象类）
 */
export abstract class BaseApiClient {
  protected config: ApiClientConfig;
  protected rateLimiter: OzonApiRateLimiter;

  constructor(
    protected baseUrl: string,
    config?: ApiClientConfig
  ) {
    this.config = {
      useRateLimiter: true,
      timeout: 30000,
      maxRetries: 2,
      ...config,
    };
    this.rateLimiter = OzonApiRateLimiter.getInstance();
  }

  /**
   * 发起 HTTP 请求
   */
  protected async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = this.buildUrl(endpoint);
    const headers = this.buildHeaders(options.headers);

    const fetchFn = () =>
      fetch(url, {
        ...options,
        headers,
      });

    let response: Response;

    if (this.config.useRateLimiter) {
      response = await this.rateLimiter.executeWithRetry(
        fetchFn,
        this.config.maxRetries
      );
    } else {
      response = await fetchFn();
    }

    return this.handleResponse<T>(response);
  }

  /**
   * GET 请求
   */
  protected async get<T>(
    endpoint: string,
    params?: Record<string, string | number | undefined>
  ): Promise<T> {
    const queryString = this.buildQueryString(params);
    const fullEndpoint = queryString ? `${endpoint}?${queryString}` : endpoint;

    return this.request<T>(fullEndpoint, {
      method: 'GET',
    });
  }

  /**
   * POST 请求
   */
  protected async post<T>(endpoint: string, body?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * 构建完整 URL
   */
  protected buildUrl(endpoint: string): string {
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      return endpoint;
    }
    const base = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${base}${path}`;
  }

  /**
   * 构建请求头
   */
  protected buildHeaders(customHeaders?: HeadersInit): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...this.config.defaultHeaders,
    };

    if (customHeaders) {
      if (customHeaders instanceof Headers) {
        customHeaders.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(customHeaders)) {
        customHeaders.forEach(([key, value]) => {
          headers[key] = value;
        });
      } else {
        Object.assign(headers, customHeaders);
      }
    }

    return headers;
  }

  /**
   * 构建查询字符串
   */
  protected buildQueryString(
    params?: Record<string, string | number | undefined>
  ): string {
    if (!params) return '';

    const entries = Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

    return entries.join('&');
  }

  /**
   * 处理响应
   */
  protected async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error = await this.parseError(response);
      throw error;
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    }

    return response.text() as unknown as T;
  }

  /**
   * 解析错误响应
   */
  protected async parseError(response: Response): Promise<ApiError> {
    let details: any;

    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        details = await response.json();
      } else {
        details = await response.text();
      }
    } catch {
      details = null;
    }

    return {
      code: `HTTP_${response.status}`,
      message: details?.message || details?.error || response.statusText || '请求失败',
      status: response.status,
      details,
    };
  }

  /**
   * 通过 Service Worker 消息发送请求（用于 Content Script）
   */
  protected async sendMessage<T>(type: string, data?: any): Promise<T> {
    const response = await chrome.runtime.sendMessage({
      type,
      data,
    });

    if (!response.success) {
      throw {
        code: 'MESSAGE_ERROR',
        message: response.error || '请求失败',
        details: response,
      } as ApiError;
    }

    return response.data as T;
  }
}

/**
 * 创建 API 错误
 */
export function createApiError(
  code: string,
  message: string,
  status?: number,
  details?: any
): ApiError {
  return { code, message, status, details };
}

/**
 * 判断是否为 API 错误
 */
export function isApiError(error: any): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  );
}
