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
   * 等待 OZON 页面 DOM 稳定（Vue hydration 完成）
   * 检测 webSale 组件内的配送信息是否加载完成
   * 检测逻辑：pdp_fa 容器内容不是 SVG 图标时，说明内容已加载
   */
  private async waitForContainerReady(): Promise<boolean> {
    const MAX_WAIT_TIME = 20000; // 最多等待20秒
    const CHECK_INTERVAL = 200;  // 每200ms检查一次

    return new Promise((resolve) => {
      const startTime = Date.now();
      let checkCount = 0;

      // 检查关键元素是否已加载（Vue hydration 完成的标志）
      const checkKeyElements = (): boolean => {
        // 查找 webSale 组件（商品销售信息区域）
        const webSaleWidget = document.querySelector('div[data-widget="webSale"]');
        if (!webSaleWidget) {
          if (checkCount === 1) {
            console.log('[EuraFlow] 未找到 webSale 组件');
          }
          return false;
        }

        // 在 webSale 内查找配送信息容器（使用宽松选择器）
        const deliveryContainer = webSaleWidget.querySelector('div[class*="pdp_fa"]');
        if (!deliveryContainer) {
          if (checkCount === 1) {
            console.log('[EuraFlow] 在 webSale 内未找到 pdp_fa 容器');
          }
          return false;
        }

        // 检查内容是否不是 SVG（如果不是 SVG，说明内容已加载完成）
        const hasSvg = deliveryContainer.querySelector('svg');
        if (!hasSvg) {
          const content = deliveryContainer.textContent?.trim() || '';
          console.log('[EuraFlow] ✓ 检测到配送信息已加载:', content);
          return true;
        }

        if (checkCount === 1) {
          console.log('[EuraFlow] pdp_fa 容器内仍然是 SVG，继续等待...');
        }

        return false;
      };

      const checkReady = () => {
        checkCount++;
        const elapsed = Date.now() - startTime;

        // 超时检查
        if (elapsed > MAX_WAIT_TIME) {
          console.warn('[EuraFlow] ⚠️ 等待关键元素超时，强制继续');
          resolve(true);
          return;
        }

        // 检查关键元素是否已加载
        if (checkKeyElements()) {
          console.log(`[EuraFlow] ✓ DOM 已稳定（用时 ${elapsed}ms，检查了 ${checkCount} 次）`);
          // 额外延迟200ms，确保 Vue 完全完成
          setTimeout(() => resolve(true), 200);
        } else {
          // 关键元素未出现，继续等待
          setTimeout(checkReady, CHECK_INTERVAL);
        }
      };

      console.log('[EuraFlow] 开始等待关键元素加载...');
      checkReady();
    });
  }

  /**
   * 初始化计算器
   */
  public async init(): Promise<void> {
    try {
      // 1. 第一时间预加载配置数据（后台并行）
      this.preloadConfigInBackground();

      // 2. 计算真实售价
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

      // 3. 提取商品ID
      const productId = extractProductId();
      if (!productId) {
        console.error('[EuraFlow] 无法提取商品ID');
        return;
      }

      // 4. 【先采集数据】（耗时操作，不等待 DOM）
      console.log('[EuraFlow] 开始采集商品数据...');

      const pageCookie = document.cookie;

      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_ALL_PRODUCT_DATA',
        data: {
          url: window.location.href,
          productId: productId,
          cookieString: pageCookie
        }
      });

      if (!response.success) {
        console.error('[EuraFlow] 数据获取失败:', response.error);
        return;
      }

      console.log('[EuraFlow] ✓ 数据采集完成');

      // 5. 【再等待 DOM 稳定】（此时配送日期应该已经加载好了）
      console.log('[EuraFlow] 等待 DOM 稳定...');
      const isReady = await this.waitForContainerReady();

      if (!isReady) {
        console.warn('[EuraFlow] ⚠️ DOM 未完全稳定，但数据已准备好，继续注入');
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

      console.log('[EuraFlow] ✓ 组件注入完成');
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
