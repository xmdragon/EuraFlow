/**
 * 配置缓存服务
 *
 * 在页面加载时预加载店铺、仓库、水印配置，缓存5分钟
 * 避免弹窗时临时加载，提升用户体验
 */

import { ApiClient } from './api-client';
import type { Shop, Warehouse, Watermark } from './types';

interface ConfigCache {
  shops: Shop[];
  warehouses: Map<number, Warehouse[]>; // key: shop_id
  watermarks: Watermark[];
  timestamp: number;
}

class ConfigCacheService {
  private cache: ConfigCache | null = null;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5分钟
  private loading: boolean = false;
  private loadPromise: Promise<ConfigCache> | null = null;

  /**
   * 预加载配置数据
   * @param apiClient API客户端实例
   */
  async preload(apiClient: ApiClient): Promise<void> {
    // 如果正在加载，等待加载完成
    if (this.loading && this.loadPromise) {
      await this.loadPromise;
      return;
    }

    // 如果缓存有效，直接返回
    if (this.isCacheValid()) {
      console.log('[ConfigCache] 使用有效缓存');
      return;
    }

    // 开始加载
    this.loading = true;
    this.loadPromise = this.loadConfig(apiClient);

    try {
      this.cache = await this.loadPromise;
      console.log('[ConfigCache] 预加载完成', {
        shops: this.cache.shops.length,
        watermarks: this.cache.watermarks.length,
      });
    } catch (error) {
      console.error('[ConfigCache] 预加载失败:', error);
      // 加载失败不影响页面，用户点击时会重新加载
    } finally {
      this.loading = false;
      this.loadPromise = null;
    }
  }

  /**
   * 获取缓存的配置（如果缓存失效，返回null）
   */
  getCached(): ConfigCache | null {
    if (!this.isCacheValid()) {
      return null;
    }
    return this.cache;
  }

  /**
   * 获取店铺列表
   * @param apiClient API客户端实例
   */
  async getShops(apiClient: ApiClient): Promise<Shop[]> {
    const cached = this.getCached();
    if (cached) {
      return cached.shops;
    }

    // 缓存失效，重新加载
    await this.preload(apiClient);
    return this.cache?.shops || [];
  }

  /**
   * 获取指定店铺的仓库列表
   * @param apiClient API客户端实例
   * @param shopId 店铺ID
   */
  async getWarehouses(apiClient: ApiClient, shopId: number): Promise<Warehouse[]> {
    const cached = this.getCached();
    if (cached && cached.warehouses.has(shopId)) {
      return cached.warehouses.get(shopId) || [];
    }

    // 缓存中没有此店铺的仓库，重新加载全部配置
    await this.preload(apiClient);
    return this.cache?.warehouses.get(shopId) || [];
  }

  /**
   * 获取水印列表
   * @param apiClient API客户端实例
   */
  async getWatermarks(apiClient: ApiClient): Promise<Watermark[]> {
    const cached = this.getCached();
    if (cached) {
      return cached.watermarks;
    }

    // 缓存失效，重新加载
    await this.preload(apiClient);
    return this.cache?.watermarks || [];
  }

  /**
   * 清除缓存（用于测试或强制刷新）
   */
  clearCache(): void {
    this.cache = null;
    console.log('[ConfigCache] 缓存已清除');
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid(): boolean {
    if (!this.cache) {
      return false;
    }

    const now = Date.now();
    const age = now - this.cache.timestamp;

    return age < this.CACHE_DURATION;
  }

  /**
   * 加载所有配置数据（优化：使用统一API减少请求次数）
   */
  private async loadConfig(apiClient: ApiClient): Promise<ConfigCache> {
    console.log('[ConfigCache] 开始加载配置...');

    // 使用新的统一配置API（1次请求代替原来的3+N次）
    const config = await apiClient.getConfig();

    // 验证返回数据格式
    if (!config || typeof config !== 'object') {
      throw new Error('API返回数据格式无效');
    }

    if (!Array.isArray(config.shops)) {
      console.error('[ConfigCache] 无效的shops数据:', config);
      throw new Error('API未返回有效的店铺列表（请检查API Key配置）');
    }

    if (!Array.isArray(config.watermarks)) {
      console.error('[ConfigCache] 无效的watermarks数据:', config);
      throw new Error('API未返回有效的水印列表');
    }

    // 转换数据格式
    const warehousesMap = new Map<number, Warehouse[]>();
    for (const shop of config.shops) {
      if (shop.warehouses && Array.isArray(shop.warehouses)) {
        warehousesMap.set(shop.id, shop.warehouses);
      }
    }

    return {
      shops: config.shops,
      warehouses: warehousesMap,
      watermarks: config.watermarks,
      timestamp: Date.now(),
    };
  }
}

// 导出单例
export const configCache = new ConfigCacheService();
