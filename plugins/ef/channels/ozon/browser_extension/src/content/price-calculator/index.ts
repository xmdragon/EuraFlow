/**
 * OZON 真实售价计算器 - 主类
 *
 * 在商品详情页自动计算并显示真实售价
 */

import { findPrices, calculateRealPrice } from './calculator';
import { injectCompleteDisplay } from './display';
import { configCache } from '../../shared/config-cache';
import { ApiClient } from '../../shared/api-client';

/**
 * 提取商品ID从URL
 */
function extractProductId(): string | null {
  const url = window.location.href;
  const match = url.match(/-(\d+)\/(\?|$)/);
  return match ? match[1] : null;
}

/**
 * 真实售价计算器主类
 */
export class RealPriceCalculator {
  /**
   * 后台预加载配置数据（不阻塞主流程）
   * 在页面加载的第一时间就开始，与数据采集并行
   */
  private preloadConfigInBackground(): void {
    chrome.storage.sync.get(['apiUrl', 'apiKey'], (result) => {
      if (result.apiUrl && result.apiKey) {
        console.log('[EuraFlow] 第一时间开始预加载配置数据（并行）...');
        const apiClient = new ApiClient(result.apiUrl, result.apiKey);
        configCache.preload(apiClient)
          .then(() => {
            console.log('[EuraFlow] ✓ 配置数据预加载完成（店铺、仓库、水印已缓存）');
          })
          .catch((error) => {
            console.warn('[EuraFlow] ⚠ 配置数据预加载失败:', error.message);
            // 预加载失败不影响功能，用户点击时会重新加载
          });
      } else {
        console.log('[EuraFlow] 跳过配置预加载（未配置 API）');
      }
    });
  }

  /**
   * 等待 OZON 右侧容器 DOM 稳定（Vue hydration 完成）
   * 监听 <div data-widget="webStickyColumn"> 内的 DOM 变化
   * 只有在指定时间内无任何变化才认为稳定
   */
  private async waitForContainerReady(): Promise<boolean> {
    const MAX_WAIT_TIME = 20000; // 最多等待20秒
    const STABLE_DURATION = 3000; // 3秒内无变化才认为稳定（Vue hydration 需要更长时间）

    return new Promise((resolve) => {
      const startTime = Date.now();
      let stableTimer: number | null = null;
      let changeCount = 0;

      // 查找 OZON 右侧粘性容器（这是我们要注入的位置）
      const findStickyColumn = (): HTMLElement | null => {
        return document.querySelector('div[data-widget="webStickyColumn"]') as HTMLElement | null;
      };

      const checkStability = () => {
        const stickyColumn = findStickyColumn();

        if (!stickyColumn) {
          // 容器不存在，继续等待
          if (Date.now() - startTime > MAX_WAIT_TIME) {
            console.warn('[EuraFlow] 等待 webStickyColumn 容器超时');
            resolve(false);
          } else {
            setTimeout(checkStability, 100);
          }
          return;
        }

        console.log('[EuraFlow] 找到 webStickyColumn 容器，开始监听 DOM 变化...');

        // 容器存在，开始监听其内部 DOM 变化
        const observer = new MutationObserver(() => {
          changeCount++;
          console.log(`[EuraFlow] 检测到第 ${changeCount} 次 DOM 变化`);

          // 清除之前的稳定计时器
          if (stableTimer) {
            clearTimeout(stableTimer);
          }

          // 设置新的稳定计时器：2秒内无变化才认为稳定
          stableTimer = window.setTimeout(() => {
            observer.disconnect();
            console.log(`[EuraFlow] DOM 已稳定（${STABLE_DURATION}ms 内无变化，共检测到 ${changeCount} 次变化）`);
            // 额外延迟500ms，确保Vue的hydration完全完成
            setTimeout(() => resolve(true), 500);
          }, STABLE_DURATION);
        });

        // 监听 webStickyColumn 容器及其所有子节点的变化
        observer.observe(stickyColumn, {
          childList: true,     // 子节点增删
          subtree: true,       // 所有后代节点
          attributes: true,    // 属性变化
          characterData: true  // 文本内容变化
        });

        // 立即启动稳定计时器（如果容器已经稳定，3秒后直接注入）
        stableTimer = window.setTimeout(() => {
          observer.disconnect();
          console.log(`[EuraFlow] DOM 已稳定（${STABLE_DURATION}ms 内无变化，共检测到 ${changeCount} 次变化）`);
          // 额外延迟500ms，确保Vue的hydration完全完成
          setTimeout(() => resolve(true), 500);
        }, STABLE_DURATION);

        // 超时保护
        setTimeout(() => {
          if (stableTimer) {
            clearTimeout(stableTimer);
            observer.disconnect();
            console.warn(`[EuraFlow] 等待 DOM 稳定超时（${MAX_WAIT_TIME}ms），强制继续`);
            resolve(true);
          }
        }, MAX_WAIT_TIME);
      };

      checkStability();
    });
  }

  /**
   * 初始化计算器
   */
  public async init(): Promise<void> {
    try {
      // 1. 第一时间预加载配置数据（与后续操作并行）
      this.preloadConfigInBackground();

      // 2. 等待容器稳定
      console.log('[EuraFlow] 等待容器稳定...');
      const isReady = await this.waitForContainerReady();
      if (!isReady) {
        console.error('[EuraFlow] 容器未就绪');
        return;
      }

      // 3. 计算真实售价
      const { greenPrice, blackPrice, currency } = findPrices();
      if (blackPrice === null && greenPrice === null) {
        console.warn('[EuraFlow] 未找到价格');
        return;
      }

      const { message, price } = calculateRealPrice(greenPrice, blackPrice, currency);
      if (!message) {
        console.warn('[EuraFlow] 无法计算真实售价');
        return;
      }

      // 4. 提取商品ID
      const productId = extractProductId();
      if (!productId) {
        console.error('[EuraFlow] 无法提取商品ID');
        return;
      }

      // 5. 并发获取所有商品数据（与步骤1的配置预加载并行）
      console.log('[EuraFlow] 并发获取所有商品数据...');

      // 【关键修复】读取页面的 Cookie（包含 sc_company_id）
      const pageCookie = document.cookie;
      console.log('[EuraFlow] 页面 Cookie 长度:', pageCookie.length);

      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_ALL_PRODUCT_DATA',
        data: {
          url: window.location.href,
          productId: productId,
          cookieString: pageCookie  // 传递页面 Cookie 给 Service Worker
        }
      });

      if (!response.success) {
        console.error('[EuraFlow] 数据获取失败:', response.error);
        return;
      }

      const { ozonProduct, spbSales, dimensions, euraflowConfig } = response.data;

      console.log('[EuraFlow] 最终数据:', {
        realPrice: { message, price },
        ozonProduct: ozonProduct ? '✓' : '✗',
        spbSales: spbSales ? '✓' : '✗',
        dimensions: dimensions ? '✓' : '✗',
        euraflowConfig: euraflowConfig ? '✓' : '✗'
      });

      // 6. 一次性注入完整组件
      await injectCompleteDisplay({
        message,
        price,
        ozonProduct,
        spbSales,
        dimensions,
        euraflowConfig
      });

      console.log('[EuraFlow] 组件注入完成');
      // 配置数据已在 init() 第一时间预加载，这里无需重复
    } catch (error) {
      console.error('[EuraFlow] 初始化失败:', error);
    }
  }

  /**
   * 销毁计算器，清理资源
   */
  public destroy(): void {
    // 无需清理，因为没有观察器、定时器等
  }
}
