/**
 * OZON 买家端 API 客户端
 *
 * 负责与 www.ozon.ru 买家端公开 API 交互：
 * - 商品详情页数据
 * - 商品变体数据
 * - 跟卖数据
 * - 分类页分页商品列表
 */

import { BaseApiClient } from './base-client';
import { getOzonStandardHeaders, getBrowserInfo } from '../ozon-headers';

/**
 * 商品基础信息（从分页 API 获取）
 */
export interface ProductBasicInfo {
  sku: string;           // 商品 SKU
  link: string;          // 商品链接
  title: string;         // 商品标题
  price: number | null;  // 当前价格（卢布）
  originalPrice: number | null;  // 原价（卢布）
  rating: number | null; // 评分
  reviewCount: number | null;  // 评价数
  imageUrl: string | null;     // 主图 URL
}

/**
 * 跟卖数据
 */
export interface FollowSellerData {
  count: number;              // 跟卖卖家数量
  minPrice?: number;          // 最低价格
  skus: string[];             // 跟卖卖家 SKU 列表
  prices: number[];           // 价格列表（从低到高排序）
}

/**
 * OZON 买家端 API 客户端
 *
 * 可在 Content Script 和 Service Worker 中使用
 * Content Script 直接调用（同源），Service Worker 需要处理 Cookie
 */
export class OzonBuyerApi extends BaseApiClient {
  private static instance: OzonBuyerApi;

  private constructor() {
    super('https://www.ozon.ru/api', {
      useRateLimiter: true,
      timeout: 30000,
      maxRetries: 2
    });
  }

  /**
   * 获取单例实例
   */
  static getInstance(): OzonBuyerApi {
    if (!OzonBuyerApi.instance) {
      OzonBuyerApi.instance = new OzonBuyerApi();
    }
    return OzonBuyerApi.instance;
  }

  /**
   * 获取商品列表页的商品数据（分页 API）
   *
   * API: https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url={encodedPath}&page={pageNum}
   * 响应: widgetStates["tileGridDesktop-XXX"].items[]
   *
   * @param pageUrl - 页面路径（如 /category/igry-i-igrushki-7500/）
   * @param page - 页码（从 1 开始）
   * @returns 商品列表
   */
  async getProductsPage(pageUrl: string, page: number): Promise<ProductBasicInfo[]> {
    try {
      const encodedUrl = encodeURIComponent(pageUrl);
      const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}&page=${page}`;

      if (__DEBUG__) {
        console.log(`[OzonBuyerApi] 请求第 ${page} 页:`, apiUrl);
      }

      // 直接请求（不使用 tryExecuteInPage，避免从 Content Script 调用时死锁）
      // 获取标准 headers
      const { headers: baseHeaders } = await getOzonStandardHeaders({
        referer: `https://www.ozon.ru${pageUrl}`,
        serviceName: 'composer'
      });

      // 在 Service Worker 中需要显式添加 Cookie
      let headers = { ...baseHeaders };
      if (typeof chrome !== 'undefined' && chrome.cookies) {
        const ozonCookies = await chrome.cookies.getAll({ domain: '.ozon.ru' });
        const cookieString = ozonCookies.map(c => `${c.name}=${c.value}`).join('; ');
        headers = {
          ...headers,
          'Cookie': cookieString,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ru;q=0.7'
        };
      }

      const response = await this.rateLimiter.execute(() =>
        fetch(apiUrl, {
          method: 'GET',
          headers,
          credentials: 'include'
        })
      );

      if (!response.ok) {
        console.error(`[OzonBuyerApi] HTTP 错误: ${response.status}`);
        return [];
      }

      const result = await response.json();
      const products = this.parseProductsResponse(result);

      if (__DEBUG__) {
        console.log(`[OzonBuyerApi] 第 ${page} 页获取到 ${products.length} 个商品`);
      }

      return products;
    } catch (error: any) {
      console.error('[OzonBuyerApi] 请求失败:', error.message);
      return [];
    }
  }

  /**
   * 迭代获取所有商品（生成器模式）
   *
   * @param pageUrl - 页面路径
   * @param maxPages - 最大页数限制（防止无限循环）
   */
  async *iterateProducts(
    pageUrl: string,
    maxPages: number = 100
  ): AsyncGenerator<ProductBasicInfo[], void, unknown> {
    let page = 1;
    let consecutiveEmptyPages = 0;

    while (page <= maxPages) {
      const products = await this.getProductsPage(pageUrl, page);

      if (products.length === 0) {
        consecutiveEmptyPages++;
        // 连续 2 个空页，认为到底了
        if (consecutiveEmptyPages >= 2) {
          break;
        }
      } else {
        consecutiveEmptyPages = 0;
        yield products;
      }

      page++;

      // 页间延迟，避免请求过快
      await this.sleep(200);
    }
  }

  /**
   * 批量获取跟卖数据
   *
   * @param productIds - SKU 数组
   * @returns 跟卖数据 Map
   */
  async getFollowSellerDataBatch(productIds: string[]): Promise<Map<string, FollowSellerData>> {
    const results = new Map<string, FollowSellerData>();

    if (!productIds || productIds.length === 0) {
      return results;
    }

    // 获取 Cookie（Service Worker 中需要）
    let cookieString = '';
    if (typeof chrome !== 'undefined' && chrome.cookies) {
      const ozonCookies = await chrome.cookies.getAll({ domain: '.ozon.ru' });
      cookieString = ozonCookies.map(c => `${c.name}=${c.value}`).join('; ');
    }

    for (const productId of productIds) {
      try {
        const data = await this.getFollowSellerDataSingle(productId, cookieString);
        if (data) {
          results.set(productId, data);
        } else {
          results.set(productId, { count: 0, skus: [], prices: [] });
        }
      } catch (error: any) {
        console.error(`[OzonBuyerApi] SKU=${productId} 跟卖数据获取失败:`, error.message);
        results.set(productId, { count: 0, skus: [], prices: [] });
      }

      // 批次间延迟
      await this.sleep(100);
    }

    return results;
  }

  /**
   * 获取单个商品的跟卖数据
   *
   * @param productId - 商品 SKU
   * @param cookieString - Cookie 字符串（Service Worker 中使用）
   */
  async getFollowSellerDataSingle(
    productId: string,
    cookieString?: string
  ): Promise<FollowSellerData | null> {
    if (!productId) {
      return null;
    }

    try {
      const origin = 'https://www.ozon.ru';
      const encodedUrl = encodeURIComponent(
        `/modal/otherOffersFromSellers?product_id=${productId}&page_changed=true`
      );
      const apiUrl = `${origin}/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}`;

      if (__DEBUG__) {
        console.log('[API] OzonBuyerApi.getFollowSellerDataSingle 请求:', {
          url: apiUrl,
          productId
        });
      }

      // 直接请求（不使用 tryExecuteInPage，避免从 Content Script 调用时死锁）
      const { headers: baseHeaders } = await getOzonStandardHeaders({
        referer: `https://www.ozon.ru/product/${productId}/`,
        serviceName: 'composer'
      });

      let headers = { ...baseHeaders };
      if (cookieString) {
        const browserInfo = await getBrowserInfo();
        headers = {
          ...headers,
          'Cookie': cookieString,
          'User-Agent': browserInfo.userAgent
        };
      }

      const response = await this.rateLimiter.execute(() =>
        fetch(apiUrl, {
          method: 'GET',
          headers,
          credentials: 'include'
        })
      );

      if (!response.ok) {
        if (__DEBUG__) {
          console.log('[API] OzonBuyerApi.getFollowSellerDataSingle HTTP 错误:', response.status);
        }
        return null;
      }

      const data = await response.json();

      if (__DEBUG__) {
        console.log('[API] OzonBuyerApi.getFollowSellerDataSingle 返回:', JSON.stringify(data, null, 2).slice(0, 2000));
      }

      const result = this.parseFollowSellerResponse(data);

      if (__DEBUG__) {
        console.log('[API] OzonBuyerApi.getFollowSellerDataSingle 解析结果:', result);
      }

      return result;
    } catch (error: any) {
      return null;
    }
  }

  /**
   * 解析跟卖数据响应
   */
  private parseFollowSellerResponse(data: any): FollowSellerData | null {
    const widgetStates = data.widgetStates || {};

    // 查找包含 "webSellerList" 的 key
    const sellerListKey = Object.keys(widgetStates).find(key =>
      key.includes('webSellerList')
    );

    if (!sellerListKey || !widgetStates[sellerListKey]) {
      return null;
    }

    const sellerListData = JSON.parse(widgetStates[sellerListKey]);
    const sellers = sellerListData.sellers || [];

    if (sellers.length === 0) {
      return null;
    }

    // 提取跟卖价格并解析
    const prices: number[] = [];
    const skus: string[] = [];

    sellers.forEach((seller: any) => {
      if (seller.sku) {
        skus.push(seller.sku);
      }

      let priceStr = seller.price?.cardPrice?.price || seller.price?.price || '';
      priceStr = priceStr.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price > 0) {
        prices.push(price);
      }
    });

    prices.sort((a, b) => a - b);

    return {
      count: sellers.length,
      minPrice: prices.length > 0 ? prices[0] : undefined,
      skus,
      prices
    };
  }

  /**
   * 从当前页面 URL 提取路径部分
   *
   * @param fullUrl - 完整 URL（如 https://www.ozon.ru/category/xxx/?sorting=score）
   * @returns 路径部分（如 /category/xxx/）
   */
  extractPagePath(fullUrl: string): string {
    try {
      const url = new URL(fullUrl);
      return url.pathname;
    } catch {
      // 如果解析失败，尝试直接提取路径
      const match = fullUrl.match(/ozon\.ru(\/[^?#]*)/);
      return match ? match[1] : '/';
    }
  }

  /**
   * 解析商品列表项
   */
  private parseProductItem(item: any): ProductBasicInfo {
    // 提取 SKU
    let sku = String(item.sku || item.id || '');
    if (!sku && item.action?.link) {
      const skuMatch = item.action.link.match(/-(\d{6,})(?:\/|\?|$)/);
      if (skuMatch) {
        sku = skuMatch[1];
      }
    }

    // 提取价格
    let price: number | null = null;
    let originalPrice: number | null = null;

    // 1. priceV2 格式（新版）
    if (item.priceV2) {
      const priceText = item.priceV2.price?.[0]?.text || item.priceV2.price || '';
      price = this.parseOzonPrice(priceText);
      const originalText = item.priceV2.originalPrice?.[0]?.text || item.priceV2.originalPrice || '';
      originalPrice = this.parseOzonPrice(originalText);
    }

    // 2. mainState 中的价格
    if (price === null && item.mainState) {
      for (const state of item.mainState) {
        if (state.type === 'priceV2' && state.priceV2?.price) {
          const priceItems = state.priceV2.price;
          if (Array.isArray(priceItems)) {
            const priceItem = priceItems.find((p: any) => p.textStyle === 'PRICE');
            if (priceItem?.text) {
              price = this.parseOzonPrice(priceItem.text);
            }
            const originalItem = priceItems.find((p: any) => p.textStyle === 'ORIGINAL_PRICE');
            if (originalItem?.text) {
              originalPrice = this.parseOzonPrice(originalItem.text);
            }
          }
          break;
        }
        if (state.price) {
          price = this.parseOzonPrice(state.price);
          break;
        }
        if (state.atom?.price) {
          price = this.parseOzonPrice(state.atom.price);
          break;
        }
      }
    }

    // 3. 直接 price 字段
    if (price === null && item.price) {
      price = typeof item.price === 'number' ? item.price : this.parseOzonPrice(item.price);
    }

    // 4. atom.price 格式
    if (price === null && item.atom?.price) {
      price = this.parseOzonPrice(item.atom.price);
    }

    // 5. cardPrice 格式
    if (price === null && item.cardPrice) {
      price = this.parseOzonPrice(item.cardPrice);
    }

    // 提取评分
    let rating: number | null = null;
    let reviewCount: number | null = null;

    if (item.rating) {
      rating = typeof item.rating === 'number' ? item.rating : parseFloat(item.rating);
    }
    if (item.reviewCount || item.reviews) {
      const countStr = String(item.reviewCount || item.reviews || '');
      reviewCount = parseInt(countStr.replace(/\D/g, ''), 10) || null;
    }

    return {
      sku,
      link: item.action?.link || item.link || '',
      title: item.title || item.name || '',
      price,
      originalPrice,
      rating,
      reviewCount,
      imageUrl: item.image || item.mainImage || item.images?.[0] || null
    };
  }

  /**
   * 解析 OZON 价格字符串
   * 支持格式：
   * - "52,15 ₽" → 52.15
   * - "2 189,50 ₽" → 2189.50
   * - "1234" → 1234
   */
  private parseOzonPrice(priceStr: string): number | null {
    if (!priceStr || typeof priceStr !== 'string') {
      return null;
    }

    // 移除货币符号和空格
    let cleaned = priceStr.replace(/[₽¥$€\s]/g, '');

    // 处理欧洲格式：移除千位分隔符（空格），将逗号替换为点
    cleaned = cleaned.replace(/\s/g, '').replace(',', '.');

    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取 Modal 变体数据（完整的颜色×尺码组合）
   *
   * 注意：此方法从 Content Script 通过 Service Worker 调用，
   * 不能使用 tryExecuteInPage（会造成死锁：Content Script 等待 SW 响应，SW 又在等待页面脚本执行）
   *
   * @param productId 商品 ID
   * @returns 变体数据数组
   */
  async getModalVariants(productId: string): Promise<any[] | null> {
    try {
      const origin = 'https://www.ozon.ru';
      const encodedUrl = encodeURIComponent(`/modal/aspectsNew?product_id=${productId}`);
      const apiUrl = `${origin}/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}`;

      if (__DEBUG__) {
        console.log('[OzonBuyerApi] Modal API 请求:', apiUrl);
      }

      // 直接请求（不使用 tryExecuteInPage，避免死锁）
      const { headers } = await getOzonStandardHeaders({
        referer: `https://www.ozon.ru/product/${productId}/`,
        serviceName: 'composer'
      });

      const response = await this.rateLimiter.execute(() =>
        fetch(apiUrl, {
          method: 'GET',
          headers,
          credentials: 'include'
        })
      );

      if (!response.ok) {
        if (__DEBUG__) {
          console.warn('[OzonBuyerApi] Modal API 请求失败:', response.status);
        }
        return null;
      }

      const data = await response.json();
      return this.parseModalVariantsResponse(data);
    } catch (error: any) {
      if (__DEBUG__) {
        console.error('[OzonBuyerApi] Modal API 错误:', error.message);
      }
      return null;
    }
  }

  /**
   * 解析 Modal 变体响应
   */
  private parseModalVariantsResponse(data: any): any[] | null {
    const widgetStates = data.widgetStates || {};
    const keys = Object.keys(widgetStates);
    const modalKey = keys.find(k => k.includes('webAspectsModal'));

    if (!modalKey) {
      if (__DEBUG__) {
        console.warn('[OzonBuyerApi] Modal API 返回数据中没有 webAspectsModal');
      }
      return null;
    }

    try {
      const modalData = JSON.parse(widgetStates[modalKey]);
      const aspects = modalData?.aspects;
      if (aspects && Array.isArray(aspects)) {
        return aspects;
      }
    } catch {
      // JSON 解析失败
    }

    return null;
  }

  /**
   * 解析商品列表响应
   */
  private parseProductsResponse(result: any): ProductBasicInfo[] {
    const widgetStates = result.widgetStates || {};

    // 查找包含商品列表的 widget
    const productListKey = Object.keys(widgetStates).find(key =>
      key.includes('tileGridDesktop') || key.includes('searchResultsV2')
    );

    if (!productListKey) {
      return [];
    }

    // 解析 widget 数据
    let widgetData: any;
    try {
      widgetData = typeof widgetStates[productListKey] === 'string'
        ? JSON.parse(widgetStates[productListKey])
        : widgetStates[productListKey];
    } catch (parseError) {
      console.error('[OzonBuyerApi] 解析 widget 数据失败:', parseError);
      return [];
    }

    const items = widgetData.items || widgetData.products || [];

    if (items.length === 0) {
      return [];
    }

    // 转换为标准格式
    return items.map((item: any) => this.parseProductItem(item))
      .filter((p: ProductBasicInfo) => p.sku);
  }
}

/**
 * 获取 OZON 买家端 API 客户端单例
 */
export function getOzonBuyerApi(): OzonBuyerApi {
  return OzonBuyerApi.getInstance();
}

/**
 * Content Script 专用客户端（通过消息转发）
 *
 * 用于 Content Script 中调用需要 Service Worker 处理的 API
 */
export class OzonBuyerApiProxy {
  /**
   * 获取商品列表页数据（通过 Service Worker）
   */
  async getProductsPage(pageUrl: string, page: number): Promise<ProductBasicInfo[]> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_OZON_PRODUCTS_PAGE',
        data: { pageUrl, page }
      });

      if (!response.success) {
        console.error('[OzonBuyerApiProxy] API 请求失败:', response.error);
        return [];
      }

      return response.data || [];
    } catch (error: any) {
      console.error('[OzonBuyerApiProxy] 请求异常:', error.message);
      return [];
    }
  }

  /**
   * 批量获取跟卖数据（通过 Service Worker）
   */
  async getFollowSellerDataBatch(productIds: string[]): Promise<Map<string, FollowSellerData>> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_FOLLOW_SELLER_DATA_BATCH',
        data: { productIds }
      });

      if (!response.success) {
        throw new Error(response.error || '获取跟卖数据失败');
      }

      const dataMap = new Map<string, FollowSellerData>();

      if (Array.isArray(response.data)) {
        response.data.forEach((item: any) => {
          const sku = item.goods_id;
          if (sku) {
            const prices = item.gmArr || [];
            dataMap.set(sku, {
              count: item.gm || 0,
              minPrice: prices.length > 0 ? prices[0] : undefined,
              skus: item.gmGoodsIds || [],
              prices
            });
          }
        });
      }

      return dataMap;
    } catch (error: any) {
      console.error('[OzonBuyerApiProxy] 批量获取失败:', error);
      return new Map();
    }
  }

  /**
   * 从当前页面 URL 提取路径部分
   */
  extractPagePath(fullUrl: string): string {
    try {
      const url = new URL(fullUrl);
      return url.pathname;
    } catch {
      const match = fullUrl.match(/ozon\.ru(\/[^?#]*)/);
      return match ? match[1] : '/';
    }
  }

  /**
   * 迭代获取所有商品（生成器模式）
   */
  async *iterateProducts(
    pageUrl: string,
    maxPages: number = 100
  ): AsyncGenerator<ProductBasicInfo[], void, unknown> {
    let page = 1;
    let consecutiveEmptyPages = 0;

    while (page <= maxPages) {
      const products = await this.getProductsPage(pageUrl, page);

      if (products.length === 0) {
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= 2) {
          break;
        }
      } else {
        consecutiveEmptyPages = 0;
        yield products;
      }

      page++;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}

/**
 * Content Script 专用客户端单例
 */
export const ozonBuyerApiProxy = new OzonBuyerApiProxy();
