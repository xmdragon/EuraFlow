/**
 * 促销活动自动拉取商品清理器
 *
 * 功能：每天自动清理所有店铺的促销活动待自动拉入商品
 * 执行时机：插件加载时（每天首次执行）
 *
 * 工作流程：
 * 1. 检查今天是否已执行过（chrome.storage.local 缓存）
 * 2. 获取店铺列表（从 EuraFlow API）
 * 3. 遍历每个店铺，切换 cookie 后请求促销活动列表
 * 4. 解析 HTML 中的 highlightList.originalHighlights
 * 5. 对每个有待自动拉入商品的活动，分页获取商品列表并删除
 */

import { createEuraflowApi } from '../shared/api/euraflow-api';
import { configCache } from '../shared/config-cache';
import type { Shop } from '../shared/types';

// 缓存键：记录最后执行日期
const CACHE_KEY = 'promo_auto_add_cleaner_last_run';

// 促销活动数据接口
interface PromotionHighlight {
  id: string;
  dateToNextAutoAdd: string | null;
  nextAutoAddProductAutoCount: string | number;
}

// 商品响应接口
interface AutoAddProductsResponse {
  products: Array<{ id: string }>;
}

/**
 * 促销自动拉取清理器
 */
class PromoAutoAddCleaner {
  /**
   * 检查今天是否已执行
   */
  private async hasRunToday(): Promise<boolean> {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const lastRun = result[CACHE_KEY];
    if (!lastRun) return false;

    const today = new Date().toISOString().split('T')[0];
    return lastRun === today;
  }

  /**
   * 标记今天已执行
   */
  private async markAsRunToday(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    await chrome.storage.local.set({ [CACHE_KEY]: today });
  }

  /**
   * 获取 API 配置
   */
  private getApiConfig(): Promise<{ apiUrl: string; apiKey: string }> {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['apiUrl', 'apiKey'], (result) => {
        resolve({
          apiUrl: result.apiUrl || '',
          apiKey: result.apiKey || '',
        });
      });
    });
  }

  /**
   * 主入口：执行清理
   */
  async run(): Promise<void> {
    // 检查是否已执行
    if (await this.hasRunToday()) {
      console.log('[PromoAutoAddCleaner] 今日已执行，跳过');
      return;
    }

    console.log('[PromoAutoAddCleaner] 开始执行促销自动拉取清理...');

    try {
      // 获取 API 配置
      const apiConfig = await this.getApiConfig();
      if (!apiConfig.apiUrl || !apiConfig.apiKey) {
        console.log('[PromoAutoAddCleaner] 未配置 API，跳过');
        return;
      }

      // 创建 API 客户端
      const api = createEuraflowApi(apiConfig.apiUrl, apiConfig.apiKey);

      // 获取店铺列表（通过 configCache 统一管理）
      const shops = await configCache.getShops(api);
      if (!shops.length) {
        console.log('[PromoAutoAddCleaner] 没有可用店铺');
        return;
      }

      // 过滤有 client_id 的店铺
      const validShops = shops.filter(shop => shop.client_id);
      if (!validShops.length) {
        console.log('[PromoAutoAddCleaner] 没有店铺配置 client_id');
        return;
      }

      // 遍历每个店铺
      for (const shop of validShops) {
        await this.cleanShop(shop);
      }

      // 标记已执行
      await this.markAsRunToday();
      console.log('[PromoAutoAddCleaner] 清理完成');

    } catch (error) {
      console.error('[PromoAutoAddCleaner] 执行失败:', error);
    }
  }

  /**
   * 清理单个店铺
   */
  private async cleanShop(shop: Shop): Promise<void> {
    console.log(`[PromoAutoAddCleaner] 处理店铺: ${shop.display_name} (${shop.client_id})`);

    try {
      // 1. 获取或创建 seller.ozon.ru 标签页
      const { tabId, shouldClose } = await this.getOrCreateSellerTab();

      try {
        // 2. 切换到目标店铺
        await this.switchToShop(shop.client_id);

        // 3. 在页面上下文中获取促销活动列表
        const promotions = await this.fetchPromotions(tabId);

        // 4. 过滤有待自动拉入商品的活动
        const activePromotions = promotions.filter(p => {
          const count = typeof p.nextAutoAddProductAutoCount === 'string'
            ? parseInt(p.nextAutoAddProductAutoCount, 10)
            : p.nextAutoAddProductAutoCount;
          return p.dateToNextAutoAdd && count > 0;
        });

        if (!activePromotions.length) {
          console.log(`[PromoAutoAddCleaner] 店铺 ${shop.display_name} 没有待处理的活动`);
          return;
        }

        console.log(`[PromoAutoAddCleaner] 店铺 ${shop.display_name} 有 ${activePromotions.length} 个待处理活动`);

        // 5. 处理每个活动
        for (const promo of activePromotions) {
          await this.cleanPromotion(tabId, shop.client_id, promo);
        }

      } finally {
        // 6. 如果是新创建的标签页，关闭它
        if (shouldClose) {
          await this.closeTab(tabId);
        }
      }

    } catch (error) {
      console.error(`[PromoAutoAddCleaner] 店铺 ${shop.display_name} 处理失败:`, error);
    }
  }

  /**
   * 获取或创建 seller.ozon.ru 标签页
   */
  private async getOrCreateSellerTab(): Promise<{ tabId: number; shouldClose: boolean }> {
    // 查找现有的 seller.ozon.ru 标签页
    const existingTabs = await chrome.tabs.query({ url: 'https://seller.ozon.ru/*' });

    if (existingTabs.length > 0 && existingTabs[0].id) {
      console.log('[PromoAutoAddCleaner] 使用现有 seller.ozon.ru 标签页');
      return { tabId: existingTabs[0].id, shouldClose: false };
    }

    // 创建新的后台标签页
    console.log('[PromoAutoAddCleaner] 创建新的 seller.ozon.ru 标签页');
    const newTab = await chrome.tabs.create({
      url: 'https://seller.ozon.ru/app/highlights/list',
      active: false  // 后台打开
    });

    if (!newTab.id) {
      throw new Error('无法创建标签页');
    }

    // 等待页面加载完成
    await this.waitForTabLoad(newTab.id);

    return { tabId: newTab.id, shouldClose: true };
  }

  /**
   * 等待标签页加载完成
   */
  private waitForTabLoad(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('标签页加载超时'));
      }, 30000);

      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          // 额外等待 2 秒确保 JS 执行完毕
          setTimeout(resolve, 2000);
        }
      };

      // 检查当前状态
      chrome.tabs.get(tabId).then(tab => {
        if (tab.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 2000);
        }
      }).catch(() => {
        clearTimeout(timeout);
        reject(new Error('标签页不存在'));
      });

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  /**
   * 关闭标签页
   */
  private async closeTab(tabId: number): Promise<void> {
    try {
      await chrome.tabs.remove(tabId);
      console.log('[PromoAutoAddCleaner] 已关闭标签页');
    } catch {
      // 标签页可能已关闭
    }
  }

  /**
   * 切换到指定店铺
   */
  private async switchToShop(clientId: string): Promise<void> {
    await chrome.cookies.set({
      url: 'https://seller.ozon.ru',
      name: 'sc_company_id',
      value: clientId,
      domain: '.ozon.ru',
      path: '/'
    });
    console.log(`[PromoAutoAddCleaner] 已切换到店铺: ${clientId}`);
  }

  /**
   * 获取促销活动列表
   * 在页面上下文中执行，解析 highlightList.originalHighlights
   */
  private async fetchPromotions(tabId: number): Promise<PromotionHighlight[]> {
    // 先导航到促销列表页面
    await chrome.tabs.update(tabId, { url: 'https://seller.ozon.ru/app/highlights/list' });
    await this.waitForTabLoad(tabId);

    // 在页面上下文中执行脚本获取促销数据
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 在页面上下文中查找 highlightList 数据
        // OZON 将数据存储在 window.__INITIAL_STATE__.store.highlightList
        try {
          const win = window as any;

          // 方法1：从 window.__INITIAL_STATE__.store 获取（主要方式）
          if (win.__INITIAL_STATE__?.store?.highlightList?.originalHighlights) {
            console.log('[PromoAutoAddCleaner] 从 __INITIAL_STATE__.store 获取数据');
            return win.__INITIAL_STATE__.store.highlightList.originalHighlights;
          }

          // 方法2：直接从 __INITIAL_STATE__ 获取（备用）
          if (win.__INITIAL_STATE__?.highlightList?.originalHighlights) {
            console.log('[PromoAutoAddCleaner] 从 __INITIAL_STATE__ 获取数据');
            return win.__INITIAL_STATE__.highlightList.originalHighlights;
          }

          // 方法3：遍历 __INITIAL_STATE__ 查找 highlightList
          if (win.__INITIAL_STATE__) {
            const findHighlightList = (obj: any, path: string): any => {
              if (!obj || typeof obj !== 'object') return null;
              if (obj.highlightList?.originalHighlights) {
                console.log(`[PromoAutoAddCleaner] 在 ${path} 找到 highlightList`);
                return obj.highlightList.originalHighlights;
              }
              for (const key of Object.keys(obj)) {
                if (key === 'highlightList') continue;
                const result = findHighlightList(obj[key], `${path}.${key}`);
                if (result) return result;
              }
              return null;
            };
            const result = findHighlightList(win.__INITIAL_STATE__, '__INITIAL_STATE__');
            if (result) return result;
          }

          console.log('[PromoAutoAddCleaner] 未找到 highlightList 数据');
          console.log('[PromoAutoAddCleaner] __INITIAL_STATE__ keys:', Object.keys(win.__INITIAL_STATE__ || {}));
          return [];
        } catch (error) {
          console.error('[PromoAutoAddCleaner] 页面脚本执行错误:', error);
          return [];
        }
      }
    });

    if (results && results[0]?.result) {
      const promotions = results[0].result as PromotionHighlight[];
      console.log(`[PromoAutoAddCleaner] 获取到 ${promotions.length} 个促销活动`);
      return promotions;
    }

    return [];
  }

  /**
   * 清理单个促销活动
   */
  private async cleanPromotion(
    tabId: number,
    clientId: string,
    promo: PromotionHighlight
  ): Promise<void> {
    const autoAddDate = promo.dateToNextAutoAdd!;
    const totalCount = typeof promo.nextAutoAddProductAutoCount === 'string'
      ? parseInt(promo.nextAutoAddProductAutoCount, 10)
      : promo.nextAutoAddProductAutoCount;

    console.log(`[PromoAutoAddCleaner] 处理活动 ${promo.id}: ${totalCount} 个待拉入商品`);

    // 1. 分页获取所有商品
    const allProductIds: string[] = [];
    const pageSize = 50;
    let offset = 0;

    while (offset < totalCount) {
      const products = await this.fetchAutoAddProducts(tabId, clientId, autoAddDate, offset, pageSize);
      allProductIds.push(...products.map(p => p.id));
      offset += pageSize;

      // 避免请求过快
      await this.sleep(500);
    }

    if (!allProductIds.length) {
      console.log(`[PromoAutoAddCleaner] 活动 ${promo.id} 没有商品需要删除`);
      return;
    }

    // 2. 删除商品
    await this.deleteProducts(tabId, clientId, allProductIds, autoAddDate);
    console.log(`[PromoAutoAddCleaner] 活动 ${promo.id}: 已删除 ${allProductIds.length} 个商品`);
  }

  /**
   * 获取待自动拉入的商品列表
   */
  private async fetchAutoAddProducts(
    tabId: number,
    clientId: string,
    autoAddDate: string,
    offset: number,
    limit: number
  ): Promise<Array<{ id: string }>> {
    const url = `https://seller.ozon.ru/api/site/sa-auto-add/v1/${clientId}/products-with-offset?offset=${offset}&limit=${limit}&autoAddDate=${encodeURIComponent(autoAddDate)}`;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (fetchUrl: string) => {
        try {
          const response = await fetch(fetchUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          });

          if (!response.ok) {
            console.error(`[PromoAutoAddCleaner] 请求失败: ${response.status}`);
            return { products: [] };
          }

          return await response.json();
        } catch (error) {
          console.error('[PromoAutoAddCleaner] 获取商品列表失败:', error);
          return { products: [] };
        }
      },
      args: [url]
    });

    if (results && results[0]?.result) {
      const data = results[0].result as AutoAddProductsResponse;
      return data.products || [];
    }

    return [];
  }

  /**
   * 删除商品
   */
  private async deleteProducts(
    tabId: number,
    clientId: string,
    productIds: string[],
    autoAddDate: string
  ): Promise<void> {
    const url = `https://seller.ozon.ru/api/site/sa-auto-add/v1/${clientId}/delete-products`;
    const body = {
      product_ids: productIds,
      auto_add_date: autoAddDate
    };

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (fetchUrl: string, requestBody: any) => {
        try {
          const response = await fetch(fetchUrl, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
          });

          if (!response.ok) {
            console.error(`[PromoAutoAddCleaner] 删除失败: ${response.status}`);
            return { success: false };
          }

          return { success: true };
        } catch (error) {
          console.error('[PromoAutoAddCleaner] 删除商品失败:', error);
          return { success: false };
        }
      },
      args: [url, body]
    });

    if (!results || !results[0]?.result?.success) {
      console.error('[PromoAutoAddCleaner] 删除商品失败');
    }
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 导出单例
export const promoAutoAddCleaner = new PromoAutoAddCleaner();

/**
 * 注册消息处理器（供调试使用）
 */
export function registerPromoCleanerHandlers(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // 手动触发清理（调试用）
    if (message.type === 'PROMO_CLEANER_RUN') {
      promoAutoAddCleaner.run()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // 重置今日执行标记（调试用）
    if (message.type === 'PROMO_CLEANER_RESET') {
      chrome.storage.local.remove(CACHE_KEY)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
  });
}
