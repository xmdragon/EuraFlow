/**
 * 店铺余额同步器
 *
 * 功能：每小时从 OZON 卖家中心同步店铺余额到 EuraFlow
 *
 * 工作流程：
 * 1. 检查距离上次同步是否超过 1 小时
 * 2. 获取店铺列表（从 EuraFlow API）
 * 3. 遍历每个店铺，切换 cookie 后打开余额页面
 * 4. 解析余额数据并上传到 EuraFlow
 */

import { createEuraflowApi, type EuraflowApi } from '../shared/api/euraflow-api';
import { configCache } from '../shared/config-cache';
import type { Shop } from '../shared/types';

// 缓存键：记录最后执行时间戳
const CACHE_KEY = 'balance_syncer_last_run';
// 同步间隔：1 小时
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 店铺余额同步器
 */
class BalanceSyncer {
  /**
   * 检查是否在同步间隔内已执行
   */
  private async hasRunRecently(): Promise<boolean> {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const lastRunTimestamp = result[CACHE_KEY];
    if (!lastRunTimestamp) return false;

    const now = Date.now();
    return (now - lastRunTimestamp) < SYNC_INTERVAL_MS;
  }

  /**
   * 标记已执行
   */
  private async markAsRun(): Promise<void> {
    await chrome.storage.local.set({ [CACHE_KEY]: Date.now() });
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
   * 主入口：执行同步
   */
  async run(): Promise<void> {
    console.log('[BalanceSyncer] run() 被调用');

    // 检查是否在 1 小时内已执行
    if (await this.hasRunRecently()) {
      console.log('[BalanceSyncer] 跳过：1 小时内已执行');
      return;
    }

    try {
      // 获取 API 配置
      const apiConfig = await this.getApiConfig();
      if (!apiConfig.apiUrl || !apiConfig.apiKey) {
        console.log('[BalanceSyncer] 跳过：缺少 API 配置');
        return;
      }

      // 创建 API 客户端
      const api = createEuraflowApi(apiConfig.apiUrl, apiConfig.apiKey);

      console.log('[BalanceSyncer] 开始执行余额同步...');

      // 获取店铺列表（通过 configCache 统一管理）
      const shops = await configCache.getShops(api);
      console.log('[BalanceSyncer] 店铺数据:', JSON.stringify(shops[0]));
      if (!shops.length) {
        console.log('[BalanceSyncer] 没有店铺');
        return;
      }

      // 遍历店铺
      for (const shop of shops) {
        await this.syncShop(shop, api);
      }

      // 标记已执行
      await this.markAsRun();

    } catch (error) {
      console.error('[BalanceSyncer] 执行失败:', error);
    }
  }

  /**
   * 同步单个店铺
   */
  private async syncShop(shop: Shop, api: EuraflowApi): Promise<void> {
    try {
      // 1. 先切换到目标店铺（设置 cookie）
      await this.switchToShop(shop.client_id);

      // 2. 创建标签页
      const tabId = await this.createBalanceTab();

      try {
        // 3. 在页面上下文中解析余额
        const balance = await this.fetchBalance(tabId, shop.client_id);

        if (balance === null) {
          console.log(`[BalanceSyncer] ${shop.display_name}: 无法获取余额`);
          return;
        }

        // 4. 上传到 EuraFlow
        await this.uploadBalance(api, shop.client_id, balance);

        console.log(`[BalanceSyncer] ${shop.display_name}: 余额 ${balance.toFixed(2)} RUB`);

      } finally {
        // 5. 关闭标签页
        await this.closeTab(tabId);
      }

    } catch (error) {
      console.error(`[BalanceSyncer] ${shop.display_name}: 同步失败`, error);
    }
  }

  /**
   * 创建余额页面标签页
   */
  private async createBalanceTab(): Promise<number> {
    const newTab = await chrome.tabs.create({
      url: 'https://seller.ozon.ru/app/finances/balance?tab=IncomesExpenses',
      active: false
    });

    if (!newTab.id) {
      throw new Error('无法创建标签页');
    }

    // 等待页面加载完成
    await this.waitForTabLoad(newTab.id);

    return newTab.id;
  }

  /**
   * 等待标签页加载完成
   */
  private waitForTabLoad(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('标签页加载超时'));
      }, 60000);

      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete' && !resolved) {
          cleanup();
          // 额外等待 3 秒确保 JS 执行完毕
          setTimeout(resolve, 3000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      // 检查当前状态
      chrome.tabs.get(tabId).then(tab => {
        if (tab.status === 'complete' && !resolved) {
          cleanup();
          setTimeout(resolve, 3000);
        }
      }).catch(() => {
        cleanup();
        reject(new Error('标签页不存在'));
      });
    });
  }

  /**
   * 关闭标签页
   */
  private async closeTab(tabId: number): Promise<void> {
    try {
      await chrome.tabs.remove(tabId);
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
  }

  /**
   * 获取余额
   * 在页面上下文中执行，从 window.__MODULE_STATE__ 解析余额
   */
  private async fetchBalance(tabId: number, expectedClientId: string): Promise<number | null> {
    // 强制硬刷新
    await chrome.tabs.update(tabId, { url: 'https://seller.ozon.ru/app/finances/balance?tab=IncomesExpenses' });
    await this.waitForTabLoad(tabId);
    await chrome.tabs.reload(tabId, { bypassCache: true });
    await this.waitForTabLoad(tabId);

    // 在页面上下文中解析余额
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [expectedClientId],
      func: (expectedClientId: string) => {
        // 1. 校验 company.id
        const windowAny = window as any;
        const actualCompanyId = windowAny.__INITIAL_STATE__?.store?.company?.id
          ? String(windowAny.__INITIAL_STATE__.store.company.id)
          : null;

        if (!actualCompanyId || actualCompanyId !== expectedClientId) {
          return { matched: false, balance: null, expectedClientId, actualCompanyId };
        }

        // 2. 获取余额
        // 路径: window.__MODULE_STATE__["finances"].financesModule.balanceModule.monthlyBalance.balance.endAmount.amount
        const moduleState = windowAny.__MODULE_STATE__;
        const balanceModule = moduleState?.["finances"]?.financesModule?.balanceModule;
        const monthlyBalance = balanceModule?.monthlyBalance;
        const endAmount = monthlyBalance?.balance?.endAmount;
        const balance = endAmount?.amount;

        if (typeof balance === 'number') {
          return { matched: true, balance, expectedClientId, actualCompanyId };
        }

        return { matched: true, balance: null };
      }
    });

    const data = results?.[0]?.result as { matched: boolean; balance: number | null; expectedClientId?: string; actualCompanyId?: string | null } | undefined;

    // 调试输出
    console.log(`[BalanceSyncer] 预期 client_id: ${data?.expectedClientId}, 页面 company.id: ${data?.actualCompanyId}, 余额: ${data?.balance}`);

    if (!data?.matched) {
      console.warn(`[BalanceSyncer] company.id 不匹配，跳过 ${expectedClientId}`);
      return null;
    }

    return data?.balance ?? null;
  }

  /**
   * 上传余额到 EuraFlow
   */
  private async uploadBalance(
    api: EuraflowApi,
    clientId: string,
    balance: number
  ): Promise<void> {
    try {
      const response = await fetch(`${(api as any).baseUrl}/api/ef/v1/ozon/extension/shop-balance/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': (api as any).apiKey
        },
        body: JSON.stringify({
          client_id: clientId,
          balance_rub: balance
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
    } catch (error: any) {
      console.error('[BalanceSyncer] 上传失败:', error.message);
    }
  }
}

// 导出单例
export const balanceSyncer = new BalanceSyncer();

/**
 * 注册消息处理器（供调试使用）
 */
export function registerBalanceSyncerHandlers(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // 手动触发同步（调试用）
    if (message.type === 'BALANCE_SYNCER_RUN') {
      balanceSyncer.run()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // 重置执行标记（调试用）
    if (message.type === 'BALANCE_SYNCER_RESET') {
      chrome.storage.local.remove(CACHE_KEY)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
  });
}
