/**
 * EuraFlow 后端 API 客户端
 *
 * 负责与 EuraFlow 后端 API 交互：
 * - 商品上传
 * - 快速上架
 * - 任务状态查询
 * - 配置获取
 */

import { BaseApiClient, createApiError, ApiError } from './base-client';
import type {
  Shop,
  Warehouse,
  Watermark,
  TaskStatus,
  ProductData
} from '../types';

// 重新导出类型，供其他模块使用
export type {
  Shop,
  Warehouse,
  Watermark,
  TaskStatus
};

/**
 * 上传商品数据（与 ProductData 兼容，但 Date 类型转为 string）
 */
export type ProductUploadData = Omit<ProductData, 'product_created_date' | 'listing_date'> & {
  product_created_date?: string;
  listing_date?: string;
};

/**
 * 采集源信息（用于自动采集）
 */
export interface CollectionSource {
  id: number;
  source_type: 'category' | 'seller';
  source_url: string;
  source_path: string;
  display_name: string | null;
  target_count: number;
  priority: number;
}

/**
 * EuraFlow 后端 API 客户端
 *
 * 仅在 Service Worker 中使用（跨域请求）
 */
export class EuraflowApi extends BaseApiClient {
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    super(apiUrl, {
      useRateLimiter: false,
      timeout: 60000,  // 上传可能需要较长时间
      maxRetries: 1,
      defaultHeaders: {
        'X-API-Key': apiKey
      }
    });
    this.apiKey = apiKey;
  }

  /**
   * 测试 API 连接
   */
  async testConnection(): Promise<{ status: string; username: string }> {
    const response = await fetch(`${this.baseUrl}/api/ef/v1/ozon/extension/ping`, {
      method: 'GET',
      headers: {
        'X-API-Key': this.apiKey
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw createApiError('CONNECTION_FAILED', `HTTP ${response.status}: ${errorText}`, response.status);
    }

    return await response.json();
  }

  /**
   * 获取配置（店铺、仓库、水印）
   */
  async getConfig(): Promise<{
    shops: Array<Shop & { warehouses: Warehouse[] }>;
    watermarks: Watermark[];
  }> {
    const response = await fetch(`${this.baseUrl}/api/ef/v1/ozon/extension/config`, {
      method: 'GET',
      headers: {
        'X-API-Key': this.apiKey
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw createApiError(
        'CONFIG_FAILED',
        errorData.error || `HTTP ${response.status}: ${response.statusText}`,
        response.status
      );
    }

    const result = await response.json();

    // 后端返回 {success: true, data: {shops: [], watermarks: []}}
    if (result.success && result.data) {
      return result.data;
    }
    return result;
  }

  /**
   * 上传商品数据
   * @param products 商品数据列表
   * @param batchName 批次名称（可选，用于自动采集）
   * @param sourceId 采集源ID（可选，用于自动采集）
   */
  async uploadProducts(
    products: ProductUploadData[],
    batchName?: string,
    sourceId?: number
  ): Promise<{
    success: boolean;
    total: number;
    success_count?: number;
    failed_count?: number;
    errors?: any[];
  }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    console.log(`[EuraflowApi] 开始上传 ${products.length} 个商品到 ${this.baseUrl}${batchName ? ` (批次: ${batchName})` : ''}`);

    try {
      const response = await fetch(`${this.baseUrl}/api/ef/v1/ozon/extension/products/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify({
          products,
          ...(batchName && { batch_name: batchName }),
          ...(sourceId && { source_id: sourceId })
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log(`[EuraflowApi] 上传响应状态: ${response.status}`);

      if (!response.ok) {
        const errorData = await this.parseErrorResponse(response);
        console.error(`[EuraflowApi] 上传失败:`, errorData);
        throw errorData;
      }

      const result = await response.json();
      console.log(`[EuraflowApi] 上传成功:`, result);
      return result;
    } catch (error: any) {
      clearTimeout(timeoutId);

      console.error(`[EuraflowApi] 上传异常:`, error.message || error);

      if (error.name === 'AbortError') {
        throw createApiError('TIMEOUT', '上传超时（请检查网络连接或减少上传数量）');
      } else if (error.code) {
        throw error;
      } else if (error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')) {
        throw createApiError('NETWORK_ERROR', '网络连接失败（请检查 API 地址和网络）');
      } else {
        throw error;
      }
    }
  }

  /**
   * 查询任务状态
   */
  async getTaskStatus(taskId: string, shopId?: number): Promise<TaskStatus> {
    let url = `${this.baseUrl}/api/ef/v1/ozon/extension/tasks/${taskId}/status`;
    if (shopId !== undefined) {
      url += `?shop_id=${shopId}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': this.apiKey
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw createApiError(
        'STATUS_FAILED',
        errorData.error || `HTTP ${response.status}: ${response.statusText}`,
        response.status
      );
    }

    return await response.json();
  }

  /**
   * 采集商品
   */
  async collectProduct(sourceUrl: string, productData: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/ef/v1/ozon/extension/products/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify({
        source_url: sourceUrl,
        product_data: productData
      })
    });

    if (!response.ok) {
      const errorData = await this.parseErrorResponse(response);
      throw errorData;
    }

    return await response.json();
  }

  /**
   * 根据俄文类目名称查询完整三级类目中文名称
   * @param nameRu 俄文类目名称（商品属性 Тип 的值）
   * @returns 三级类目信息
   */
  async getCategoryByRussianName(nameRu: string): Promise<{
    category1: string | null;
    category1Id: number | null;
    category2: string | null;
    category2Id: number | null;
    category3: string | null;
    category3Id: number | null;
    fullPath: string | null;
  } | null> {
    if (!nameRu) {
      return null;
    }

    try {
      const url = `${this.baseUrl}/api/ef/v1/ozon/extension/categories/by-name?name_ru=${encodeURIComponent(nameRu)}`;

      if (__DEBUG__) {
        console.log('[EuraflowApi] 类目查询请求:', { URL: url, name_ru: nameRu });
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey
        }
      });

      if (!response.ok) {
        console.error('[EuraflowApi] 类目查询失败:', response.status);
        return null;
      }

      const result = await response.json();

      if (__DEBUG__) {
        console.log('[EuraflowApi] 类目查询返回:', result);
      }

      return result.success ? result.data : null;
    } catch (error: any) {
      console.error('[EuraflowApi] 类目查询异常:', error.message);
      return null;
    }
  }

  // ========== 自动采集 API ==========

  /**
   * 获取下一个待采集的地址
   * 优先返回超过 7 天未采集的地址
   */
  async getNextCollectionSource(): Promise<CollectionSource | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/ef/v1/ozon/extension/collection-sources/next`, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          // 没有待采集的地址
          return null;
        }
        const errorData = await response.json().catch(() => ({}));
        throw createApiError(
          'QUEUE_FAILED',
          errorData.detail?.message || `HTTP ${response.status}`,
          response.status
        );
      }

      const result = await response.json();
      return result.data || null;
    } catch (error: any) {
      if (error.code === 'QUEUE_FAILED') {
        throw error;
      }
      console.error('[EuraflowApi] 获取采集队列失败:', error.message);
      return null;
    }
  }

  /**
   * 更新采集源状态
   * @param sourceId 采集源 ID
   * @param status 新状态
   * @param productCount 本次采集的商品数量（可选）
   * @param error 错误信息（可选，失败时使用）
   */
  async updateCollectionSourceStatus(
    sourceId: number,
    status: 'collecting' | 'completed' | 'failed',
    productCount?: number,
    error?: string
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/ef/v1/ozon/extension/collection-sources/${sourceId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify({
        status,
        ...(productCount !== undefined && { product_count: productCount }),
        ...(error && { error_message: error })
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw createApiError(
        'STATUS_UPDATE_FAILED',
        errorData.detail?.message || `HTTP ${response.status}`,
        response.status
      );
    }
  }

  /**
   * 跟卖商品（立即上架）
   */
  async followPdp(data: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/ef/v1/ozon/extension/products/follow-pdp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const errorData = await this.parseErrorResponse(response);
      throw errorData;
    }

    return await response.json();
  }

  /**
   * 解析错误响应
   */
  private async parseErrorResponse(response: Response): Promise<ApiError> {
    let errorMessage = '请求失败';
    let errorCode = `HTTP_${response.status}`;

    try {
      const errorData = await response.json();

      // 输出原始错误响应用于调试
      console.error('[EuraflowApi] 原始错误响应:', JSON.stringify(errorData));

      // FastAPI 422 验证错误格式: {"detail": [{"loc": [...], "msg": "...", "type": "..."}]}
      if (Array.isArray(errorData.detail)) {
        const validationErrors = errorData.detail.map((err: any) => {
          const loc = err.loc?.join('.') || 'unknown';
          return `${loc}: ${err.msg}`;
        });
        errorMessage = `数据验证失败: ${validationErrors.slice(0, 3).join('; ')}`;
        if (validationErrors.length > 3) {
          errorMessage += ` (还有 ${validationErrors.length - 3} 个错误)`;
        }
        errorCode = 'VALIDATION_ERROR';
      }
      // 多层级解析错误信息
      else if (errorData.detail && typeof errorData.detail === 'object' && errorData.detail.message) {
        errorMessage = errorData.detail.message;
        if (errorData.detail.code) {
          errorCode = errorData.detail.code;
        }
      } else if (errorData.detail && typeof errorData.detail === 'string') {
        errorMessage = errorData.detail;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      } else if (errorData.error && errorData.error.message) {
        errorMessage = errorData.error.message;
      } else if (errorData.code || (errorData.detail && errorData.detail.code)) {
        const code = errorData.code || errorData.detail.code;
        errorCode = code;
        switch (code) {
          case 'UNAUTHORIZED':
            errorMessage = 'API Key 无效或权限不足';
            break;
          case 'PAYLOAD_TOO_LARGE':
            errorMessage = '数据量过大（最多 1000 条）';
            break;
          case 'EMPTY_PAYLOAD':
            errorMessage = '没有可上传的商品';
            break;
          default:
            errorMessage = `请求失败 [${code}]`;
        }
      }
    } catch {
      // JSON 解析失败
      try {
        const errorText = await response.text();
        if (errorText) {
          errorMessage = `服务器错误 (HTTP ${response.status}): ${errorText.substring(0, 100)}`;
        }
      } catch {
        errorMessage = `服务器错误 (HTTP ${response.status})`;
      }
    }

    return createApiError(errorCode, errorMessage, response.status);
  }
}

/**
 * 创建 EuraFlow API 客户端
 */
export function createEuraflowApi(apiUrl: string, apiKey: string): EuraflowApi {
  return new EuraflowApi(apiUrl, apiKey);
}

/**
 * Content Script 专用客户端（通过消息转发）
 */
export class EuraflowApiProxy {
  constructor(
    private apiUrl: string,
    private apiKey: string
  ) {}

  /**
   * 发送消息到 Service Worker（带重试）
   */
  private async sendRequest(type: string, payload: any = {}, maxRetries: number = 2): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // 添加超时控制
        const response = await Promise.race([
          chrome.runtime.sendMessage({
            type,
            data: {
              apiUrl: this.apiUrl,
              apiKey: this.apiKey,
              ...payload
            }
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('消息超时（Service Worker 可能已休眠）')), 30000)
          )
        ]);

        // Service Worker 未响应
        if (response === undefined) {
          throw new Error('Service Worker 未响应（可能已休眠）');
        }

        if (!response.success) {
          throw new Error(response.error || '请求失败');
        }

        return response.data;
      } catch (error: any) {
        lastError = error;

        // 如果是最后一次重试，不再等待
        if (attempt < maxRetries) {
          // 等待一小段时间后重试（给 Service Worker 唤醒的机会）
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    throw lastError;
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<{ status: string; username: string }> {
    return this.sendRequest('TEST_CONNECTION', {});
  }

  /**
   * 获取配置
   */
  async getConfig(): Promise<{
    shops: Array<Shop & { warehouses: Warehouse[] }>;
    watermarks: Watermark[];
  }> {
    return this.sendRequest('GET_CONFIG', {});
  }

  /**
   * 上传商品
   */
  async uploadProducts(products: ProductUploadData[]): Promise<{
    success: boolean;
    total: number;
    success_count?: number;
    failed_count?: number;
    errors?: any[];
  }> {
    return this.sendRequest('UPLOAD_PRODUCTS', { products });
  }

  /**
   * 查询任务状态
   */
  async getTaskStatus(taskId: string, shopId?: number): Promise<TaskStatus> {
    return this.sendRequest('GET_TASK_STATUS', { taskId, shopId });
  }

  /**
   * 采集商品
   */
  async collectProduct(sourceUrl: string, productData: any): Promise<any> {
    return this.sendRequest('COLLECT_PRODUCT', { source_url: sourceUrl, product_data: productData });
  }
}

/**
 * 创建 Content Script 专用客户端
 */
export function createEuraflowApiProxy(apiUrl: string, apiKey: string): EuraflowApiProxy {
  return new EuraflowApiProxy(apiUrl, apiKey);
}
