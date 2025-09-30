/**
 * 基础API服务 - 处理所有API请求的认证和错误
 */

import authService from './auth';

interface ApiRequestOptions extends RequestInit {
  skipAuth?: boolean;
}

class ApiService {
  private baseUrl = '/api/ef/v1';

  /**
   * 发送API请求
   */
  public async request<T = any>(
    url: string,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    const { skipAuth = false, ...fetchOptions } = options;

    // 构建完整URL
    const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;

    // 添加认证头
    if (!skipAuth) {
      const authHeaders = authService.getAuthHeader();
      fetchOptions.headers = {
        ...fetchOptions.headers,
        ...authHeaders
      };
    }

    // 确保有Content-Type
    if (!fetchOptions.headers || !fetchOptions.headers['Content-Type']) {
      if (fetchOptions.body && typeof fetchOptions.body === 'string') {
        fetchOptions.headers = {
          ...fetchOptions.headers,
          'Content-Type': 'application/json'
        };
      }
    }

    try {
      const response = await fetch(fullUrl, fetchOptions);

      // 处理401未授权
      if (response.status === 401) {
        // 尝试刷新token
        const refreshed = await authService.refreshToken();
        if (refreshed) {
          // 重试请求
          const retryHeaders = authService.getAuthHeader();
          fetchOptions.headers = {
            ...fetchOptions.headers,
            ...retryHeaders
          };
          const retryResponse = await fetch(fullUrl, fetchOptions);
          return this.handleResponse<T>(retryResponse);
        } else {
          // 刷新失败，跳转到登录页
          authService.logout();
          throw new Error('Authentication required');
        }
      }

      return this.handleResponse<T>(response);
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * 处理响应
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: response.statusText
      }));
      throw new Error(error.detail || error.message || 'Request failed');
    }

    // 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  /**
   * GET请求
   */
  public get<T = any>(url: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: 'GET'
    });
  }

  /**
   * POST请求
   */
  public post<T = any>(
    url: string,
    data?: any,
    options?: ApiRequestOptions
  ): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined
    });
  }

  /**
   * PUT请求
   */
  public put<T = any>(
    url: string,
    data?: any,
    options?: ApiRequestOptions
  ): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined
    });
  }

  /**
   * DELETE请求
   */
  public delete<T = any>(url: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: 'DELETE'
    });
  }
}

export default new ApiService();