/**
 * 店铺任务协调器
 *
 * 统一管理多个店铺级别的后台任务，按店铺循环执行，减少 cookie 切换和标签页开关次数
 *
 * 包含的任务：
 * 1. 促销自动拉取清理（promo-auto-add-cleaner）
 * 2. 账单付款同步（invoice-payment-syncer）
 * 3. 店铺余额同步（balance-syncer）
 *
 * 执行流程（后端优先，扩展 Fallback）：
 * 1. 检查当前时间是否已过"最早执行时间"
 * 2. 调用后端 /sync-status 检查后端是否已成功
 * 3. 后端已成功则跳过，否则执行
 * 4. 按店铺循环执行任务
 *
 * 执行时间限制（北京时间）：
 * - 促销清理：不早于 6:10（后端 6:00 执行）
 * - 账单同步：不早于 7:00（后端 6:30 执行）
 * - 余额同步：不早于整点过 15 分（后端整点过 5 分执行）
 */

import { createEuraflowApi, type EuraflowApi } from '../shared/api/euraflow-api';
import { configCache } from '../shared/config-cache';
import { isAuthenticated, getAuthConfig } from '../shared/storage';
import type { Shop } from '../shared/types';

// ========== 任务接口定义 ==========

/**
 * 任务执行上下文
 */
interface TaskContext {
  tabId: number;
  shop: Shop;
  api: EuraflowApi;
}

/**
 * 任务执行结果
 */
interface TaskResult {
  taskName: string;
  success: boolean;
  message?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * 店铺任务接口
 */
interface ShopTask {
  name: string;
  /** 检查任务是否应该执行（全局级别，如：今天是否已执行、时间限制） */
  shouldRun(): Promise<boolean>;
  /** 检查后端是否已执行（在获取 API 配置后调用） */
  checkBackendStatus?(apiUrl: string, apiKey: string): Promise<boolean>;
  /** 检查特定店铺是否需要执行此任务 */
  shouldRunForShop?(shop: Shop, api: EuraflowApi): Promise<boolean>;
  /** 执行任务 */
  run(ctx: TaskContext): Promise<TaskResult>;
  /** 任务完成后的回调（如：标记已执行） */
  onComplete?(): Promise<void>;
}

// ========== 任务缓存键 ==========

const CACHE_KEYS = {
  PROMO_CLEANER: 'promo_auto_add_cleaner_last_run',
  INVOICE_SYNCER: 'invoice_payment_syncer_last_run',
  BALANCE_SYNCER: 'balance_syncer_last_run',
  RUNNER_LAST_RUN: 'shop_task_runner_last_run',
};

// ========== 后端状态检查 ==========

interface SyncStatus {
  promo_cleaner: {
    last_success_at: string | null;
    today_executed: boolean;
  };
  invoice_sync: {
    last_success_at: string | null;
    current_window_executed: boolean;
  };
  balance_sync: {
    last_success_at: string | null;
    current_hour_executed: boolean;
  };
}

/**
 * 获取后端同步状态
 */
async function fetchBackendSyncStatus(apiUrl: string, apiKey: string): Promise<SyncStatus | null> {
  try {
    const response = await fetch(`${apiUrl}/api/ef/v1/ozon/extension/sync-status`, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
    });

    if (!response.ok) {
      console.warn(`[SyncStatus] 获取状态失败: HTTP ${response.status}`);
      return null;
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.warn('[SyncStatus] 获取状态异常:', error);
    return null;
  }
}

/**
 * 获取北京时间
 */
function getBeijingTime(): { hour: number; minute: number; dateStr: string } {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();

  // 北京时间 = UTC + 8
  let beijingHour = (utcHour + 8) % 24;
  let beijingMinute = utcMinute;

  // 计算北京日期
  const beijingDate = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const dateStr = beijingDate.toISOString().split('T')[0];

  return { hour: beijingHour, minute: beijingMinute, dateStr };
}

// ========== 促销清理任务 ==========

class PromoCleanerTask implements ShopTask {
  name = '促销清理';

  /**
   * 检查是否应该执行
   *
   * 条件：
   * 1. 北京时间不早于 6:10
   * 2. 后端今天未成功执行
   * 3. 扩展今天未执行过
   */
  async shouldRun(): Promise<boolean> {
    // 1. 检查时间限制（北京时间不早于 6:10）
    const { hour, minute, dateStr } = getBeijingTime();
    const currentMinutes = hour * 60 + minute;
    const earliestMinutes = 6 * 60 + 10; // 6:10

    if (currentMinutes < earliestMinutes) {
      console.log(`[PromoCleanerTask] 跳过：当前北京时间 ${hour}:${minute}，早于 6:10`);
      return false;
    }

    // 2. 检查扩展本地缓存
    const result = await chrome.storage.local.get(CACHE_KEYS.PROMO_CLEANER);
    const lastRun = result[CACHE_KEYS.PROMO_CLEANER];
    if (lastRun === dateStr) {
      console.log('[PromoCleanerTask] 跳过：今天已执行过');
      return false;
    }

    return true;
  }

  /**
   * 检查后端状态（在获取 API 配置后调用）
   */
  async checkBackendStatus(apiUrl: string, apiKey: string): Promise<boolean> {
    const status = await fetchBackendSyncStatus(apiUrl, apiKey);
    if (status?.promo_cleaner?.today_executed) {
      console.log('[PromoCleanerTask] 跳过：后端今天已成功执行');
      return false;
    }
    return true;
  }

  async run(ctx: TaskContext): Promise<TaskResult> {
    try {
      // 导航到促销列表页
      await navigateAndWait(ctx.tabId, 'https://seller.ozon.ru/app/highlights/list');

      // 获取促销活动列表
      const promotions = await this.fetchPromotions(ctx.tabId);

      // 过滤有待自动拉入商品的活动
      const activePromotions = promotions.filter(p => {
        const count = typeof p.nextAutoAddProductAutoCount === 'string'
          ? parseInt(p.nextAutoAddProductAutoCount, 10)
          : p.nextAutoAddProductAutoCount;
        return p.dateToNextAutoAdd && count > 0;
      });

      // 处理每个活动
      let totalDeleted = 0;
      for (const promo of activePromotions) {
        const deleted = await this.cleanPromotion(ctx.tabId, promo);
        totalDeleted += deleted;
      }

      const message = totalDeleted > 0
        ? `从 ${activePromotions.length} 个促销活动移除 ${totalDeleted} 个商品`
        : `${promotions.length} 个促销活动，无需清理`;

      return { taskName: this.name, success: true, message };

    } catch (error) {
      return { taskName: this.name, success: false, message: (error as Error).message };
    }
  }

  async onComplete(): Promise<void> {
    const { dateStr } = getBeijingTime();
    await chrome.storage.local.set({ [CACHE_KEYS.PROMO_CLEANER]: dateStr });
  }

  private async fetchPromotions(tabId: number): Promise<Array<{
    id: string;
    dateToNextAutoAdd: string | null;
    nextAutoAddProductAutoCount: string | number;
  }>> {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const windowAny = window as any;
        const highlights = windowAny.__MODULE_STATE__?.highlights?.highlightsModule?.highlightList?.originalHighlights;
        if (!Array.isArray(highlights)) return [];

        return highlights.map((h: any) => ({
          id: h.id,
          dateToNextAutoAdd: h.dateToNextAutoAdd,
          nextAutoAddProductAutoCount: h.nextAutoAddProductAutoCount,
        }));
      }
    });

    return results?.[0]?.result || [];
  }

  private async cleanPromotion(tabId: number, promo: { id: string }): Promise<number> {
    let totalDeleted = 0;
    let hasMore = true;
    let page = 1;

    while (hasMore) {
      const products = await this.fetchAutoAddProducts(tabId, promo.id, page);
      if (!products.length) {
        hasMore = false;
        break;
      }

      for (const product of products) {
        const success = await this.deleteProduct(tabId, promo.id, product.id);
        if (success) totalDeleted++;
      }

      if (products.length < 20) {
        hasMore = false;
      } else {
        page++;
      }
    }

    return totalDeleted;
  }

  private async fetchAutoAddProducts(tabId: number, promoId: string, page: number): Promise<Array<{ id: string }>> {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [promoId, page],
      func: async (promoId: string, page: number) => {
        try {
          const response = await fetch(`/api/seller/highlight/${promoId}/products/auto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page, sortOrder: 'ASC', sortBy: 'AUTO_ADD_DATE' })
          });
          if (!response.ok) return [];
          const data = await response.json();
          return data.products || [];
        } catch {
          return [];
        }
      }
    });

    return results?.[0]?.result || [];
  }

  private async deleteProduct(tabId: number, promoId: string, productId: string): Promise<boolean> {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [promoId, productId],
      func: async (promoId: string, productId: string) => {
        try {
          const response = await fetch(`/api/seller/highlight/${promoId}/products/${productId}/auto/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          return response.ok;
        } catch {
          return false;
        }
      }
    });

    return results?.[0]?.result || false;
  }
}

// ========== 账单付款同步任务 ==========

class InvoiceSyncerTask implements ShopTask {
  name = '账单同步';
  private shopsToSync: string[] = [];

  /**
   * 检查是否应该执行
   *
   * 条件：
   * 1. 北京时间不早于 7:00（后端 6:30 执行）
   * 2. 后端当前窗口期未成功执行
   * 3. 满足原有的 7 天间隔
   */
  async shouldRun(): Promise<boolean> {
    // 1. 检查时间限制（北京时间不早于 7:00）
    const { hour, minute } = getBeijingTime();
    const currentMinutes = hour * 60 + minute;
    const earliestMinutes = 7 * 60; // 7:00

    if (currentMinutes < earliestMinutes) {
      console.log(`[InvoiceSyncerTask] 跳过：当前北京时间 ${hour}:${minute}，早于 7:00`);
      return false;
    }

    // 2. 检查间隔
    const result = await chrome.storage.local.get(CACHE_KEYS.INVOICE_SYNCER);
    const lastRunTimestamp = result[CACHE_KEYS.INVOICE_SYNCER];
    if (lastRunTimestamp) {
      const intervalMs = 7 * 24 * 60 * 60 * 1000; // 7天
      if ((Date.now() - lastRunTimestamp) < intervalMs) {
        console.log('[InvoiceSyncerTask] 跳过：距上次执行不足 7 天');
        return false;
      }
    }

    return true;
  }

  /**
   * 检查后端状态（在获取 API 配置后调用）
   */
  async checkBackendStatus(apiUrl: string, apiKey: string): Promise<boolean> {
    const status = await fetchBackendSyncStatus(apiUrl, apiKey);
    if (status?.invoice_sync?.current_window_executed) {
      console.log('[InvoiceSyncerTask] 跳过：后端当前窗口期已成功执行');
      return false;
    }
    return true;
  }

  async shouldRunForShop(shop: Shop, api: EuraflowApi): Promise<boolean> {
    // 首次调用时获取需要同步的店铺列表
    if (this.shopsToSync.length === 0) {
      try {
        const response = await fetch(`${(api as any).baseUrl}/api/ef/v1/ozon/extension/invoice-payments/should-sync`, {
          method: 'GET',
          headers: { 'X-API-Key': (api as any).apiKey }
        });

        if (response.ok) {
          const result = await response.json();
          if (result.in_check_window && result.shops_to_sync) {
            this.shopsToSync = result.shops_to_sync.map((s: any) => s.client_id);
          }
        }
      } catch {
        return false;
      }
    }

    return this.shopsToSync.includes(shop.client_id);
  }

  async run(ctx: TaskContext): Promise<TaskResult> {
    try {
      // 导航到发票页面
      await navigateAndWait(ctx.tabId, 'https://seller.ozon.ru/app/finances/invoices');

      // 获取付款数据
      const payments = await this.fetchPayments(ctx.tabId, ctx.shop.client_id);

      if (!payments || payments.length === 0) {
        return { taskName: this.name, success: true, message: '没有付款记录' };
      }

      // 上传到后端
      await this.uploadPayments(ctx.api, ctx.shop.client_id, payments);

      return { taskName: this.name, success: true, message: `同步 ${payments.length} 条付款记录` };

    } catch (error) {
      return { taskName: this.name, success: false, message: (error as Error).message };
    }
  }

  async onComplete(): Promise<void> {
    await chrome.storage.local.set({ [CACHE_KEYS.INVOICE_SYNCER]: Date.now() });
    this.shopsToSync = []; // 重置
  }

  private async fetchPayments(tabId: number, expectedClientId: string): Promise<any[] | null> {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [expectedClientId],
      func: (expectedClientId: string) => {
        const windowAny = window as any;

        // 校验 company.id
        const actualCompanyId = windowAny.__INITIAL_STATE__?.store?.company?.id
          ? String(windowAny.__INITIAL_STATE__.store.company.id)
          : null;

        if (!actualCompanyId || actualCompanyId !== expectedClientId) {
          return null;
        }

        // 获取付款数据
        const invoicesData = windowAny.__MODULE_STATE__?.finances?.financesModule?.invoices?.invoiceList;
        if (!invoicesData || !Array.isArray(invoicesData)) return [];

        return invoicesData.map((item: any) => ({
          payment_type: item.type || '',
          amount_cny: item.amount?.value || '0',
          payment_status: item.status || '',
          scheduled_payment_date: item.plannedPaymentDate || '',
          actual_payment_date: item.realPaymentDate || null,
          period_text: item.period || null,
          payment_file_number: item.paymentFileName || null,
          payment_method: item.paymentMethod || null,
        }));
      }
    });

    return results?.[0]?.result ?? null;
  }

  private async uploadPayments(api: EuraflowApi, clientId: string, payments: any[]): Promise<void> {
    const response = await fetch(`${(api as any).baseUrl}/api/ef/v1/ozon/extension/invoice-payments/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': (api as any).apiKey
      },
      body: JSON.stringify({ client_id: clientId, payments })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  }
}

// ========== 余额同步任务 ==========

class BalanceSyncerTask implements ShopTask {
  name = '余额同步';

  /**
   * 检查是否应该执行
   *
   * 条件：
   * 1. 北京时间不早于整点过 15 分（后端整点过 5 分执行）
   * 2. 后端当前小时未成功执行
   * 3. 距上次执行超过 1 小时
   */
  async shouldRun(): Promise<boolean> {
    // 1. 检查时间限制（北京时间不早于整点过 15 分）
    const { hour, minute } = getBeijingTime();
    if (minute < 15) {
      console.log(`[BalanceSyncerTask] 跳过：当前北京时间 ${hour}:${minute}，早于整点过 15 分`);
      return false;
    }

    // 2. 检查间隔
    const result = await chrome.storage.local.get(CACHE_KEYS.BALANCE_SYNCER);
    const lastRunTimestamp = result[CACHE_KEYS.BALANCE_SYNCER];
    if (lastRunTimestamp) {
      const intervalMs = 60 * 60 * 1000; // 1小时
      if ((Date.now() - lastRunTimestamp) < intervalMs) {
        console.log('[BalanceSyncerTask] 跳过：距上次执行不足 1 小时');
        return false;
      }
    }

    return true;
  }

  /**
   * 检查后端状态（在获取 API 配置后调用）
   */
  async checkBackendStatus(apiUrl: string, apiKey: string): Promise<boolean> {
    const status = await fetchBackendSyncStatus(apiUrl, apiKey);
    if (status?.balance_sync?.current_hour_executed) {
      console.log('[BalanceSyncerTask] 跳过：后端当前小时已成功执行');
      return false;
    }
    return true;
  }

  async run(ctx: TaskContext): Promise<TaskResult> {
    try {
      // 导航到余额页面
      await navigateAndWait(ctx.tabId, 'https://seller.ozon.ru/app/finances/balance?tab=IncomesExpenses');

      // 获取余额
      const result = await this.fetchBalance(ctx.tabId, ctx.shop.client_id);

      if (result.error || result.balance === null) {
        return { taskName: this.name, success: false, message: result.error || '未知错误' };
      }

      // 上传到后端
      await this.uploadBalance(ctx.api, ctx.shop.client_id, result.balance);

      return { taskName: this.name, success: true, message: `余额 ${result.balance.toFixed(2)} RUB` };

    } catch (error) {
      return { taskName: this.name, success: false, message: (error as Error).message };
    }
  }

  async onComplete(): Promise<void> {
    await chrome.storage.local.set({ [CACHE_KEYS.BALANCE_SYNCER]: Date.now() });
  }

  private async fetchBalance(tabId: number, expectedClientId: string): Promise<{ balance: number | null; error?: string }> {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [expectedClientId],
      func: (expectedClientId: string) => {
        const windowAny = window as any;

        // 校验 company.id
        const actualCompanyId = windowAny.__INITIAL_STATE__?.store?.company?.id
          ? String(windowAny.__INITIAL_STATE__.store.company.id)
          : null;

        // 从 DOM 解析余额（格式如 "325 831 ₽"）
        let balance: number | null = null;
        const balanceEl = document.querySelector('.index_balanceAmount_3BoPq');
        if (balanceEl) {
          const text = balanceEl.textContent || '';
          const cleaned = text.replace(/[^\d.,\-]/g, '').replace(/\s/g, '').replace(',', '.');
          balance = parseFloat(cleaned);
          if (isNaN(balance)) balance = null;
        }

        return {
          matched: actualCompanyId === expectedClientId,
          balance,
          actualCompanyId,
        };
      }
    });

    const data = results?.[0]?.result as {
      matched: boolean;
      balance: number | null;
      actualCompanyId: string | null;
    } | undefined;

    if (!data?.matched) {
      const error = `company.id 不匹配: 预期=${expectedClientId}, 实际=${data?.actualCompanyId}`;
      console.warn(`[BalanceSyncer] ${error}`);
      return { balance: null, error };
    }

    if (data?.balance === null) {
      return { balance: null, error: '无法从页面获取余额' };
    }

    return { balance: data.balance };
  }

  private async uploadBalance(api: EuraflowApi, clientId: string, balance: number): Promise<void> {
    const response = await fetch(`${(api as any).baseUrl}/api/ef/v1/ozon/extension/shop-balance/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': (api as any).apiKey
      },
      body: JSON.stringify({ client_id: clientId, balance_rub: balance })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  }
}

// ========== 辅助函数 ==========

/**
 * 导航到指定 URL 并等待加载完成（强制刷新绕过缓存）
 */
async function navigateAndWait(tabId: number, url: string): Promise<void> {
  // 使用 bypassCache 刷新确保 cookie 切换后加载正确店铺的数据
  await chrome.tabs.update(tabId, { url });
  await waitForTabLoad(tabId);
  await chrome.tabs.reload(tabId, { bypassCache: true });
  await waitForTabLoad(tabId);
  // 等待页面脚本完全执行
  await sleep(2000);
}

/**
 * 等待标签页加载完成
 */
function waitForTabLoad(tabId: number): Promise<void> {
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
        setTimeout(resolve, 1000);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete' && !resolved) {
        cleanup();
        setTimeout(resolve, 1000);
      }
    }).catch(() => {
      cleanup();
      reject(new Error('标签页不存在'));
    });
  });
}

/**
 * 睡眠
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 切换到指定店铺
 */
async function switchToShop(clientId: string): Promise<void> {
  // 先删除旧 cookie，再设置新的，确保切换生效
  await chrome.cookies.remove({
    url: 'https://seller.ozon.ru',
    name: 'sc_company_id',
  });
  await chrome.cookies.set({
    url: 'https://seller.ozon.ru',
    name: 'sc_company_id',
    value: clientId,
    domain: '.ozon.ru',
    path: '/'
  });
  // 等待 cookie 生效
  await sleep(500);
}

/**
 * 创建后台标签页
 */
async function createBackgroundTab(url: string): Promise<number> {
  const newTab = await chrome.tabs.create({ url, active: false });
  if (!newTab.id) {
    throw new Error('无法创建标签页');
  }
  await waitForTabLoad(newTab.id);
  return newTab.id;
}

/**
 * 关闭标签页
 */
async function closeTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // 标签页可能已关闭
  }
}

// ========== 任务协调器 ==========

class ShopTaskRunner {
  private tasks: ShopTask[] = [
    new PromoCleanerTask(),
    new InvoiceSyncerTask(),
    new BalanceSyncerTask(),
  ];

  /**
   * 主入口：执行所有任务
   */
  async run(): Promise<void> {
    console.log('[ShopTaskRunner] 开始执行店铺任务...');

    try {
      // 检查是否已登录
      const authenticated = await isAuthenticated();
      if (!authenticated) {
        console.log('[ShopTaskRunner] 跳过：未登录');
        return;
      }

      // 获取认证配置（用于检查后端状态）
      const authConfig = await getAuthConfig();

      // 创建 API 客户端
      const api = await createEuraflowApi();

      // 过滤出需要执行的任务（两步过滤：本地条件 + 后端状态）
      const tasksToRun: ShopTask[] = [];
      for (const task of this.tasks) {
        // 第一步：检查本地条件（时间限制、本地缓存）
        if (!(await task.shouldRun())) {
          console.log(`[ShopTaskRunner] 跳过任务: ${task.name}（本地条件不满足）`);
          continue;
        }

        // 第二步：检查后端状态（后端是否已成功执行）
        if (task.checkBackendStatus) {
          const shouldRun = await task.checkBackendStatus(authConfig.apiUrl, authConfig.accessToken || '');
          if (!shouldRun) {
            console.log(`[ShopTaskRunner] 跳过任务: ${task.name}（后端已执行）`);
            continue;
          }
        }

        tasksToRun.push(task);
      }

      if (tasksToRun.length === 0) {
        console.log('[ShopTaskRunner] 没有需要执行的任务');
        return;
      }

      console.log(`[ShopTaskRunner] 将执行 ${tasksToRun.length} 个任务: ${tasksToRun.map(t => t.name).join(', ')}`);

      // 获取店铺列表
      const shops = await configCache.getShops(api);
      const validShops = shops.filter(shop => shop.client_id);

      if (!validShops.length) {
        console.log('[ShopTaskRunner] 没有有效店铺');
        return;
      }

      console.log(`[ShopTaskRunner] 共 ${validShops.length} 个店铺`);

      // 按店铺循环执行
      for (const shop of validShops) {
        await this.runTasksForShop(shop, api, tasksToRun);
      }

      // 标记任务完成
      for (const task of tasksToRun) {
        if (task.onComplete) {
          await task.onComplete();
        }
      }

      console.log('[ShopTaskRunner] 所有任务执行完成');

    } catch (error) {
      console.error('[ShopTaskRunner] 执行失败:', error);
    }
  }

  /**
   * 为单个店铺执行所有任务
   */
  private async runTasksForShop(shop: Shop, api: EuraflowApi, tasks: ShopTask[]): Promise<void> {
    console.log(`[ShopTaskRunner] 处理店铺: ${shop.display_name} (${shop.client_id})`);

    let tabId: number | null = null;

    try {
      // 1. 切换到目标店铺
      await switchToShop(shop.client_id);

      // 2. 创建标签页（使用第一个任务需要的 URL）
      tabId = await createBackgroundTab('https://seller.ozon.ru/app/highlights/list');

      // 3. 依次执行每个任务
      const results: string[] = [];
      for (const task of tasks) {
        // 检查是否需要为此店铺执行
        if (task.shouldRunForShop) {
          const shouldRun = await task.shouldRunForShop(shop, api);
          if (!shouldRun) {
            results.push(`${task.name}: 跳过`);
            continue;
          }
        }

        // 执行任务
        const result = await task.run({ tabId, shop, api });
        if (result.success) {
          results.push(`${task.name}: ${result.message || '成功'}`);
        } else {
          results.push(`${task.name}: 失败 - ${result.message}`);
        }
      }

      console.log(`[ShopTaskRunner] ${shop.display_name}: ${results.join(' | ')}`);

    } catch (error) {
      console.error(`[ShopTaskRunner] ${shop.display_name}: 处理失败`, error);
    } finally {
      // 4. 关闭标签页
      if (tabId) {
        await closeTab(tabId);
      }
    }
  }
}

// 导出单例
export const shopTaskRunner = new ShopTaskRunner();

/**
 * 注册消息处理器
 */
export function registerShopTaskRunnerHandlers(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SHOP_TASK_RUNNER_RUN') {
      shopTaskRunner.run()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // 重置所有任务缓存
    if (message.type === 'SHOP_TASK_RUNNER_RESET') {
      Promise.all([
        chrome.storage.local.remove(CACHE_KEYS.PROMO_CLEANER),
        chrome.storage.local.remove(CACHE_KEYS.INVOICE_SYNCER),
        chrome.storage.local.remove(CACHE_KEYS.BALANCE_SYNCER),
      ])
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
  });
}
