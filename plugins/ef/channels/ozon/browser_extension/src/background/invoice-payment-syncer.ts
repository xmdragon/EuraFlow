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

// 缓存键：记录最后执行时间戳
const CACHE_KEY = 'invoice_payment_syncer_last_run';
// 检查间隔：7 天
const CHECK_INTERVAL_DAYS = 7;

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
   * 检查是否在检查间隔内已执行
   */
  private async hasRunRecently(): Promise<boolean> {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const lastRunTimestamp = result[CACHE_KEY];
    if (!lastRunTimestamp) return false;

    const now = Date.now();
    const intervalMs = CHECK_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
    return (now - lastRunTimestamp) < intervalMs;
  }

  /**
   * 标记已执行
   */
  private async markAsRun(): Promise<void> {
    await chrome.storage.local.set({ [CACHE_KEY]: Date.now() });
  }

  /**
   * 检查是否应该执行（北京时间5点后）
   */
  private shouldRunNow(): boolean {
    const now = new Date();

    // 计算北京时间（UTC+8）
    const utcHour = now.getUTCHours();
    const beijingHour = (utcHour + 8) % 24;

    // 必须在北京时间 5 点后
    return beijingHour >= 5;
  }

  /**
   * 调用后端 API 检查是否需要同步
   */
  private async checkShouldSync(api: EuraflowApi): Promise<{ shouldSync: boolean; reason: string }> {
    try {
      const response = await fetch(`${(api as any).baseUrl}/api/ef/v1/ozon/invoice-payments/should-sync`, {
        method: 'GET',
        headers: {
          'X-API-Key': (api as any).apiKey
        }
      });

      if (!response.ok) {
        // API 错误时默认执行同步
        return { shouldSync: true, reason: 'API 检查失败，默认执行同步' };
      }

      const result = await response.json();
      return {
        shouldSync: result.should_sync,
        reason: result.reason
      };
    } catch (error) {
      // 网络错误时默认执行同步
      return { shouldSync: true, reason: '网络错误，默认执行同步' };
    }
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
    // 检查是否在北京时间 5 点后
    if (!this.shouldRunNow()) {
      return;
    }

    // 检查是否在 7 天内已执行
    if (await this.hasRunRecently()) {
      return;
    }

    try {
      // 获取 API 配置
      const apiConfig = await this.getApiConfig();
      if (!apiConfig.apiUrl || !apiConfig.apiKey) {
        return;
      }

      // 创建 API 客户端
      const api = createEuraflowApi(apiConfig.apiUrl, apiConfig.apiKey);

      // 调用后端 API 检查是否需要同步
      const { shouldSync, reason } = await this.checkShouldSync(api);
      if (!shouldSync) {
        // 不需要同步，但仍然标记已执行（避免频繁检查）
        await this.markAsRun();
        return;
      }

      console.log('[InvoicePaymentSyncer] 开始执行账单付款同步...', reason);

      // 获取店铺列表（通过 configCache 统一管理）
      const shops = await configCache.getShops(api);
      if (!shops.length) {
        return;
      }

      // 过滤有 client_id 的店铺
      const validShops = shops.filter(shop => shop.client_id);
      if (!validShops.length) {
        return;
      }

      // 遍历每个店铺
      for (const shop of validShops) {
        await this.syncShop(shop, api);
      }

      // 标记已执行
      await this.markAsRun();

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
      active: false
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

      // 先添加 listener，再检查当前状态
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

        // 查找发票表格（使用类名匹配）
        const table = document.querySelector('table[class*="invoicesTable"]') || document.querySelector('table');
        if (!table) {
          return payments;
        }

        // 查找表格行（跳过表头）
        const rows = table.querySelectorAll('tbody tr');

        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');

          // 表格有 10 列，第一列和最后一列是空白占位符
          // 列 0: 空白
          // 列 1: 付款类型
          // 列 2: 金额
          // 列 3: 付款状态
          // 列 4: 计划付款日期
          // 列 5: 付款发放日期
          // 列 6: 时期
          // 列 7: 付款文件编号
          // 列 8: 支付方式
          // 列 9: 空白
          if (cells.length >= 9) {
            const paymentType = cells[1]?.textContent?.trim() || '';
            const amountText = cells[2]?.textContent?.trim() || '';
            const statusText = cells[3]?.textContent?.trim() || '';
            const scheduledDate = cells[4]?.textContent?.trim() || '';
            const actualDate = cells[5]?.textContent?.trim() || null;
            const periodText = cells[6]?.textContent?.trim() || null;
            const fileNumber = cells[7]?.textContent?.trim() || null;
            const paymentMethod = cells[8]?.textContent?.trim() || null;

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
