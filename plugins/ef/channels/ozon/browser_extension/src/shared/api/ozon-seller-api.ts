/**
 * OZON Seller API 客户端
 *
 * 负责与 seller.ozon.ru 卖家后台 API 交互：
 * - 需要 seller.ozon.ru 登录态
 * - 需要 x-o3-company-id 等 headers
 * - 支持页面上下文执行（绕过反爬虫）
 */

import { BaseApiClient, createApiError } from './base-client';
import { getBrowserInfo } from '../ozon-headers';

/**
 * Seller API 商品变体信息
 */
export interface SellerVariant {
  id: string;
  sku: string;
  name: string;
  attributes: Array<{
    key: string;
    value: string;
  }>;
  images?: string[];
  price?: number;
  stock?: number;
}

/**
 * Seller API 商品详情响应
 */
export interface SellerProductDetail {
  id?: string;
  sku?: string;
  name?: string;
  title: string;
  dimensions: {
    weight: string | null;  // 重量（克）- attribute key 4497
    length: string | null;  // 长度（毫米）- attribute key 9454
    width: string | null;   // 宽度（毫米）- attribute key 9455
    height: string | null;  // 高度（毫米）- attribute key 9456
  };
  variants: SellerVariant[];
  has_variants: boolean;
}

/**
 * 在页面上下文中执行的 Seller API 请求函数
 * 【关键】此函数会被 chrome.scripting.executeScript 注入到页面中执行
 * 可以绕过反爬虫检测（TLS 指纹、IP 等都是真实浏览器的）
 */
export async function executeSellerApiInPage(
  productSku: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // 从页面 Cookie 中提取 sellerId
    const cookieMatch = document.cookie.match(/sc_company_id=(\d+)/);
    if (!cookieMatch) {
      return { success: false, error: '未找到 sc_company_id' };
    }
    const sellerId = parseInt(cookieMatch[1], 10);

    // 在页面上下文中发起请求（使用页面的 Cookie 和 TLS 指纹）
    const response = await fetch('https://seller.ozon.ru/api/v1/search-variant-model', {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'x-o3-company-id': sellerId.toString(),
        'x-o3-app-name': 'seller-ui',
        'x-o3-language': 'zh-Hans',
        'x-o3-page-type': 'products-other'
      },
      credentials: 'include',  // 自动携带 Cookie
      body: JSON.stringify({
        limit: 50,
        name: productSku,
        sellerId: sellerId
      })
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const result = await response.json();

    if (!result.items || result.items.length === 0) {
      return { success: false, error: '商品不存在或已下架' };
    }

    // 处理返回数据
    const variants = result.items;
    const firstVariant = variants[0];
    const attrs = firstVariant.attributes || [];

    const findAttr = (key: string) => {
      const attr = attrs.find((a: any) => a.key == key);
      return attr ? attr.value : null;
    };

    const dimensions = {
      weight: findAttr('4497'),
      length: findAttr('9454'),
      width: findAttr('9455'),
      height: findAttr('9456')
    };

    return {
      success: true,
      data: {
        ...firstVariant,
        title: firstVariant.name,
        dimensions: dimensions,
        variants: variants,
        has_variants: variants.length > 1
      }
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * OZON Seller API 客户端
 *
 * 仅在 Service Worker 中使用
 */
export class OzonSellerApi extends BaseApiClient {
  private static instance: OzonSellerApi;

  private constructor() {
    super('https://seller.ozon.ru/api', {
      useRateLimiter: true,
      timeout: 30000,
      maxRetries: 2
    });
  }

  /**
   * 获取单例实例
   */
  static getInstance(): OzonSellerApi {
    if (!OzonSellerApi.instance) {
      OzonSellerApi.instance = new OzonSellerApi();
    }
    return OzonSellerApi.instance;
  }

  /**
   * 搜索商品变体（获取尺寸信息）
   *
   * 【策略】优先在 seller.ozon.ru 页面上执行请求（绕过反爬虫）
   * 如果页面执行失败，回退到 Service Worker 直接请求
   *
   * @param productSku - 商品 SKU
   * @param documentCookie - 可选的 Cookie 字符串（来自 Content Script）
   */
  async searchVariantModel(
    productSku: string,
    documentCookie?: string
  ): Promise<SellerProductDetail> {
    if (!productSku) {
      throw createApiError('MISSING_PARAM', '缺少商品 SKU 参数');
    }

    // 【方案1】尝试在 seller.ozon.ru 标签页中执行请求（绕过反爬虫）
    const pageResult = await this.tryExecuteInPage(productSku);
    if (pageResult) {
      return pageResult;
    }

    // 【方案2】Fallback: 从 Service Worker 直接请求
    return this.requestFromServiceWorker(productSku, documentCookie);
  }

  /**
   * 尝试在 seller.ozon.ru 页面上下文中执行请求
   */
  private async tryExecuteInPage(productSku: string): Promise<SellerProductDetail | null> {
    try {
      // 查找已打开的 seller.ozon.ru 标签页
      let sellerTabs = await chrome.tabs.query({ url: 'https://seller.ozon.ru/*' });

      // 如果没有 seller 标签页，自动在后台创建一个
      if (sellerTabs.length === 0) {
        try {
          const newTab = await chrome.tabs.create({
            url: 'https://seller.ozon.ru/app/products',
            active: false  // 在后台创建，不切换焦点
          });

          // 等待页面加载完成（最多等待 10 秒）
          await this.waitForTabLoad(newTab.id!, 10000);

          // 额外等待 1 秒让页面 JS 初始化
          await this.sleep(1000);

          sellerTabs = await chrome.tabs.query({ url: 'https://seller.ozon.ru/*' });
        } catch (createError: any) {
          console.error('[OzonSellerApi] 创建 seller 标签页失败:', createError.message);
          return null;
        }
      }

      if (sellerTabs.length === 0) {
        return null;
      }

      const sellerTab = sellerTabs[0];

      // 尝试执行脚本（最多重试一次，超时后刷新页面）
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // 5 秒超时
          const timeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), 5000);
          });

          const scriptPromise = chrome.scripting.executeScript({
            target: { tabId: sellerTab.id! },
            func: executeSellerApiInPage,
            args: [productSku]
          });

          const results = await Promise.race([scriptPromise, timeoutPromise]);

          if (results && results[0] && results[0].result) {
            const result = results[0].result;
            if (result.success) {
              return result.data as SellerProductDetail;
            } else {
              console.warn('[OzonSellerApi] 页面上下文请求失败:', result.error);
              return null; // 请求失败，不需要重试
            }
          }

          // 超时了，第一次尝试时刷新页面
          if (attempt === 0) {
            await chrome.tabs.reload(sellerTab.id!);
            await this.waitForTabLoad(sellerTab.id!, 5000);
          }
        } catch (scriptError: any) {
          console.warn('[OzonSellerApi] 执行页面脚本失败:', scriptError.message);
          return null; // 脚本错误，不需要重试
        }
      }

      return null;
    } catch (error: any) {
      console.error('[OzonSellerApi] 页面执行失败:', error.message);
      return null;
    }
  }

  /**
   * 从 Service Worker 直接发起 Seller API 请求
   */
  private async requestFromServiceWorker(
    productSku: string,
    documentCookie?: string
  ): Promise<SellerProductDetail> {
    // 合并 Cookie
    const cookieString = await this.buildCookieString(documentCookie);

    // 提取 Seller ID
    const sellerId = await this.getSellerId(cookieString);

    // 动态获取真实浏览器信息
    const browserInfo = await getBrowserInfo();

    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ru;q=0.7',
      'Content-Type': 'application/json',
      'User-Agent': browserInfo.userAgent,
      'sec-ch-ua': browserInfo.secChUa,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Origin': 'https://seller.ozon.ru',
      'Referer': 'https://seller.ozon.ru/app/products',
      'x-o3-company-id': sellerId.toString(),
      'x-o3-app-name': 'seller-ui',
      'x-o3-language': 'zh-Hans',
      'x-o3-page-type': 'products-other',
      'Cookie': cookieString
    };

    const requestBody = {
      limit: 50,
      name: productSku,
      sellerId: sellerId
    };

    const response = await this.rateLimiter.execute(() =>
      fetch('https://seller.ozon.ru/api/v1/search-variant-model', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      })
    );

    if (!response.ok) {
      console.error('[OzonSellerApi] Seller API 请求失败:', response.status);
      throw createApiError('HTTP_ERROR', `HTTP ${response.status}: ${response.statusText}`, response.status);
    }

    const result = await response.json();

    if (!result.items || result.items.length === 0) {
      throw createApiError('NOT_FOUND', '商品不存在或已下架', 404);
    }

    // 处理返回数据
    const variants = result.items;
    const firstVariant = variants[0];
    const attrs = firstVariant.attributes || [];

    const findAttr = (key: string) => {
      const attr = attrs.find((a: any) => a.key == key);
      return attr ? attr.value : null;
    };

    const dimensions = {
      weight: findAttr('4497'),   // 重量（克）
      length: findAttr('9454'),   // 长度（毫米）
      width: findAttr('9455'),    // 宽度（毫米）
      height: findAttr('9456')    // 高度（毫米）
    };

    return {
      ...firstVariant,
      title: firstVariant.name,
      dimensions: dimensions,
      variants: variants,
      has_variants: variants.length > 1
    };
  }

  /**
   * 刷新 seller.ozon.ru 标签页（确保 session 有效）
   * 采集开始前调用，避免 "商品不存在或已下架" 错误
   */
  async refreshSellerTab(): Promise<{ refreshed: boolean; tabId?: number; created?: boolean }> {
    try {
      // 查找已打开的 seller.ozon.ru 标签页
      let sellerTabs = await chrome.tabs.query({ url: 'https://seller.ozon.ru/*' });
      let sellerTab: chrome.tabs.Tab;
      let isNewTab = false;

      if (sellerTabs.length === 0) {
        // 未找到，新建一个 seller 标签页
        if (__DEBUG__) {
          console.log('[OzonSellerApi] 未找到 seller 标签页，新建...');
        }
        sellerTab = await chrome.tabs.create({
          url: 'https://seller.ozon.ru/app/products',
          active: false  // 在后台打开，不切换焦点
        });
        isNewTab = true;
      } else {
        sellerTab = sellerTabs[0];
        if (__DEBUG__) {
          console.log(`[OzonSellerApi] 刷新标签页 ID=${sellerTab.id}`);
        }
        // 刷新已有标签页
        await chrome.tabs.reload(sellerTab.id!);
      }

      if (!sellerTab.id) {
        return { refreshed: false };
      }

      // 等待页面加载完成（最多等待 5 秒）
      await this.waitForTabLoad(sellerTab.id, 5000);

      // 额外等待（新建标签页等待更长时间）
      const waitTime = isNewTab ? 2000 : 500;
      await this.sleep(waitTime);

      if (__DEBUG__) {
        console.log(`[OzonSellerApi] ${isNewTab ? '新建' : '刷新'}完成`);
      }

      return { refreshed: true, tabId: sellerTab.id, created: isNewTab };
    } catch (error: any) {
      console.error('[OzonSellerApi] 操作失败:', error.message);
      return { refreshed: false };
    }
  }

  /**
   * 构建 Cookie 字符串
   */
  private async buildCookieString(documentCookie?: string): Promise<string> {
    const ozonCookies = await chrome.cookies.getAll({ domain: '.ozon.ru' });
    const sellerCookies = await chrome.cookies.getAll({ domain: 'seller.ozon.ru' });
    const cookieMap = new Map<string, string>();

    for (const c of ozonCookies) cookieMap.set(c.name, c.value);
    for (const c of sellerCookies) cookieMap.set(c.name, c.value);

    if (documentCookie) {
      for (const cookie of documentCookie.split('; ')) {
        const [name, ...valueParts] = cookie.split('=');
        if (name) cookieMap.set(name, valueParts.join('='));
      }
    }

    return Array.from(cookieMap.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /**
   * 从 Cookie 字符串中提取 Seller ID
   */
  private async getSellerId(cookieString: string): Promise<number> {
    // 1. 尝试匹配 sc_company_id=数字
    let match = cookieString.match(/sc_company_id=(\d+)/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }

    // 2. 尝试匹配 contentId=数字（备用方案）
    match = cookieString.match(/contentId=(\d+)/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }

    // 3. 尝试匹配 company_id=数字（第三备用方案）
    match = cookieString.match(/company_id=(\d+)/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }

    // 4. 都没有找到
    throw createApiError(
      'NO_SELLER_ID',
      '未找到 OZON Seller ID，请确认已登录卖家后台（seller.ozon.ru）'
    );
  }

  /**
   * 等待标签页加载完成
   */
  private waitForTabLoad(tabId: number, timeout: number): Promise<void> {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = Math.floor(timeout / 100);
      const checkInterval = setInterval(async () => {
        attempts++;
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.status === 'complete') {
            clearInterval(checkInterval);
            resolve();
          } else if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            resolve(); // 超时也继续
          }
        } catch {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 获取 OZON Seller API 客户端单例
 */
export function getOzonSellerApi(): OzonSellerApi {
  return OzonSellerApi.getInstance();
}
