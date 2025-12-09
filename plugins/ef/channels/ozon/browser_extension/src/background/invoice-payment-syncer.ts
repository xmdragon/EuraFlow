/**
 * 账单付款同步器
 *
 * 功能：定期从 OZON 卖家中心同步账单付款数据到 EuraFlow
 * 执行时机：
 *   - 周期 1-15 结束后 → 18、19、20 号检查
 *   - 周期 16-月末结束后 → 下月 3、4、5 号检查
 *   - 北京时间 5 点后执行
 *
 * 工作流程：
 * 1. 检查是否在检查窗口内且今天未执行
 * 2. 获取店铺列表（从 EuraFlow API）
 * 3. 遍历每个店铺，切换 cookie 后打开财务发票页面
 * 4. 解析表格数据并上传到 EuraFlow
 */

import { createEuraflowApi, type EuraflowApi } from '../shared/api/euraflow-api';
import { configCache } from '../shared/config-cache';
import type { Shop } from '../shared/types';

// 缓存键：记录最后执行日期
const CACHE_KEY = 'invoice_payment_syncer_last_run';

// 付款记录接口
interface InvoicePayment {
  payment_type: string;
  amount_cny: string;
  payment_status: string;
  scheduled_payment_date: string;
  actual_payment_date: string | null;
  period_text: string | null;
  payment_file_number: string | null;
  payment_method: string | null;
}

/**
 * 账单付款同步器
 */
class InvoicePaymentSyncer {
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
   * 检查是否应该执行（在检查窗口内且北京时间5点后）
   */
  private shouldRunToday(): boolean {
    const now = new Date();

    // 计算北京时间（UTC+8）
    const utcHour = now.getUTCHours();
    const beijingHour = (utcHour + 8) % 24;

    // 必须在北京时间 5 点后
    if (beijingHour < 5) {
      return false;
    }

    // 获取 UTC 日期（用于检查窗口）
    const day = now.getUTCDate();

    // 检查窗口：
    // - 周期 1-15 结束后 → 18、19、20 号检查
    // - 周期 16-月末结束后 → 下月 3、4、5 号检查
    const inCheckWindow = (day >= 3 && day <= 5) || (day >= 18 && day <= 20);

    return inCheckWindow;
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
    // 检查是否在检查窗口内
    if (!this.shouldRunToday()) {
      if (__DEBUG__) {
        console.log('[InvoicePaymentSyncer] 不在检查窗口内，跳过');
      }
      return;
    }

    // 检查今天是否已执行
    if (await this.hasRunToday()) {
      if (__DEBUG__) {
        console.log('[InvoicePaymentSyncer] 今日已执行，跳过');
      }
      return;
    }

    console.log('[InvoicePaymentSyncer] 开始执行账单付款同步...');

    try {
      // 获取 API 配置
      const apiConfig = await this.getApiConfig();
      if (!apiConfig.apiUrl || !apiConfig.apiKey) {
        console.log('[InvoicePaymentSyncer] 未配置 API，跳过');
        return;
      }

      // 创建 API 客户端
      const api = createEuraflowApi(apiConfig.apiUrl, apiConfig.apiKey);

      // 获取店铺列表（通过 configCache 统一管理）
      const shops = await configCache.getShops(api);
      if (!shops.length) {
        console.log('[InvoicePaymentSyncer] 没有可用店铺');
        return;
      }

      // 过滤有 client_id 的店铺
      const validShops = shops.filter(shop => shop.client_id);
      if (!validShops.length) {
        console.log('[InvoicePaymentSyncer] 没有店铺配置 client_id');
        return;
      }

      // 遍历每个店铺
      for (const shop of validShops) {
        await this.syncShop(shop, api);
      }

      // 标记已执行
      await this.markAsRunToday();
      console.log('[InvoicePaymentSyncer] 同步完成');

    } catch (error) {
      console.error('[InvoicePaymentSyncer] 执行失败:', error);
    }
  }

  /**
   * 同步单个店铺
   */
  private async syncShop(shop: Shop, api: EuraflowApi): Promise<void> {
    try {
      // 1. 先切换到目标店铺（设置 cookie）
      await this.switchToShop(shop.client_id);

      // 2. 获取或创建标签页
      const { tabId, shouldClose } = await this.getOrCreateFinanceTab();

      try {
        // 3. 在页面上下文中解析付款表格
        const payments = await this.fetchPayments(tabId);

        if (payments.length === 0) {
          console.log(`[InvoicePaymentSyncer] ${shop.display_name}: 没有付款记录`);
          return;
        }

        // 4. 上传到 EuraFlow
        const result = await this.uploadPayments(api, shop.client_id, payments);

        console.log(
          `[InvoicePaymentSyncer] ${shop.display_name}: ` +
          `同步 ${payments.length} 条记录，新增 ${result.created}，更新 ${result.updated}`
        );

      } finally {
        // 5. 如果是新创建的标签页，关闭它
        if (shouldClose) {
          await this.closeTab(tabId);
        }
      }

    } catch (error) {
      console.error(`[InvoicePaymentSyncer] ${shop.display_name}: 同步失败`, error);
    }
  }

  /**
   * 获取或创建财务发票标签页
   */
  private async getOrCreateFinanceTab(): Promise<{ tabId: number; shouldClose: boolean }> {
    // 查找现有的财务发票标签页
    const existingTabs = await chrome.tabs.query({ url: 'https://seller.ozon.ru/app/finances/invoices*' });

    if (existingTabs.length > 0 && existingTabs[0].id) {
      return { tabId: existingTabs[0].id, shouldClose: false };
    }

    // 创建新的后台标签页
    const newTab = await chrome.tabs.create({
      url: 'https://seller.ozon.ru/app/finances/invoices',
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
   * 获取付款记录
   * 在页面上下文中执行，解析财务发票表格
   */
  private async fetchPayments(tabId: number): Promise<InvoicePayment[]> {
    // 强制硬刷新：先导航到目标页，再用 bypassCache 强制刷新（确保 cookie 生效）
    await chrome.tabs.update(tabId, { url: 'https://seller.ozon.ru/app/finances/invoices' });
    await this.waitForTabLoad(tabId);
    // 硬刷新确保使用新 cookie
    await chrome.tabs.reload(tabId, { bypassCache: true });
    await this.waitForTabLoad(tabId);

    // 在页面上下文中解析表格
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const payments: Array<{
          payment_type: string;
          amount_cny: string;
          payment_status: string;
          scheduled_payment_date: string;
          actual_payment_date: string | null;
          period_text: string | null;
          payment_file_number: string | null;
          payment_method: string | null;
        }> = [];

        // 查找表格行
        // OZON 财务发票页面的表格结构可能变化，需要根据实际页面调整
        const rows = document.querySelectorAll('table tbody tr');

        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 6) {
            // 表格列顺序（可能需要调整）：
            // 0: 付款类型
            // 1: 金额
            // 2: 付款状态
            // 3: 计划付款日期
            // 4: 付款发放日期（实际付款日期）
            // 5: 周期
            // 6: 付款文件编号
            // 7: 支付方式
            const paymentType = cells[0]?.textContent?.trim() || '';
            const amountText = cells[1]?.textContent?.trim() || '';
            const statusText = cells[2]?.textContent?.trim() || '';
            const scheduledDate = cells[3]?.textContent?.trim() || '';
            const actualDate = cells[4]?.textContent?.trim() || null;
            const periodText = cells[5]?.textContent?.trim() || null;
            const fileNumber = cells.length > 6 ? cells[6]?.textContent?.trim() || null : null;
            const paymentMethod = cells.length > 7 ? cells[7]?.textContent?.trim() || null : null;

            // 只处理有效的付款记录
            if (paymentType && amountText && scheduledDate) {
              payments.push({
                payment_type: paymentType,
                amount_cny: amountText,
                payment_status: statusText,
                scheduled_payment_date: scheduledDate,
                actual_payment_date: actualDate && actualDate !== '—' ? actualDate : null,
                period_text: periodText && periodText !== '—' ? periodText : null,
                payment_file_number: fileNumber && fileNumber !== '—' ? fileNumber : null,
                payment_method: paymentMethod && paymentMethod !== '—' ? paymentMethod : null,
              });
            }
          }
        });

        return payments;
      }
    });

    return (results && results[0]?.result) ? results[0].result as InvoicePayment[] : [];
  }

  /**
   * 上传付款记录到 EuraFlow
   */
  private async uploadPayments(
    api: EuraflowApi,
    clientId: string,
    payments: InvoicePayment[]
  ): Promise<{ created: number; updated: number }> {
    try {
      const response = await fetch(`${(api as any).baseUrl}/api/ef/v1/ozon/invoice-payments/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': (api as any).apiKey
        },
        body: JSON.stringify({
          client_id: clientId,
          payments: payments
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      return {
        created: result.created || 0,
        updated: result.updated || 0
      };
    } catch (error: any) {
      console.error('[InvoicePaymentSyncer] 上传失败:', error.message);
      return { created: 0, updated: 0 };
    }
  }
}

// 导出单例
export const invoicePaymentSyncer = new InvoicePaymentSyncer();

/**
 * 注册消息处理器（供调试使用）
 */
export function registerInvoicePaymentSyncerHandlers(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // 手动触发同步（调试用）
    if (message.type === 'INVOICE_PAYMENT_SYNCER_RUN') {
      invoicePaymentSyncer.run()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // 重置今日执行标记（调试用）
    if (message.type === 'INVOICE_PAYMENT_SYNCER_RESET') {
      chrome.storage.local.remove(CACHE_KEY)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
  });
}
