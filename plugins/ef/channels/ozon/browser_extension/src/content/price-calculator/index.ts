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
   * 监听关键元素的出现，而不是依赖时间
   * 关键元素：配送日期 或 "Добавить в корзину" 按钮
   */
  private async waitForContainerReady(): Promise<boolean> {
    const MAX_WAIT_TIME = 20000; // 最多等待20秒
    const CHECK_INTERVAL = 200;  // 每200ms检查一次

    return new Promise((resolve) => {
      const startTime = Date.now();
      let checkCount = 0;

      // 查找 OZON 右侧粘性容器（这是我们要注入的位置）
      const findStickyColumn = (): HTMLElement | null => {
        return document.querySelector('div[data-widget="webStickyColumn"]') as HTMLElement | null;
      };

      // 检查关键元素是否已加载（Vue hydration 完成的标志）
      const checkKeyElements = (container: HTMLElement): boolean => {
        // 关键元素1：配送日期（包含俄语月份文本，如 "7 декабря"）
        // 这是 Vue hydration 最后才渲染的元素之一
        const deliveryDateElements = container.querySelectorAll('span');
        for (const span of deliveryDateElements) {
          const text = span.textContent || '';
          // 检查是否包含俄语月份关键词
          if (text.includes('января') || text.includes('февраля') || text.includes('марта') ||
              text.includes('апреля') || text.includes('мая') || text.includes('июня') ||
              text.includes('июля') || text.includes('августа') || text.includes('сентября') ||
              text.includes('октября') || text.includes('ноября') || text.includes('декабря')) {
            console.log('[EuraFlow] ✓ 检测到配送日期元素:', text.trim());
            return true;
          }
        }

        // 关键元素2："Добавить в корзину" 按钮
        const addToCartButton = container.querySelector('button');
        if (addToCartButton) {
          const buttonText = addToCartButton.textContent || '';
          if (buttonText.includes('Добавить в корзину')) {
            console.log('[EuraFlow] ✓ 检测到"添加到购物车"按钮');
            return true;
          }
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

        // 查找容器
        const stickyColumn = findStickyColumn();
        if (!stickyColumn) {
          // 容器不存在，继续等待
          setTimeout(checkReady, CHECK_INTERVAL);
          return;
        }

        // 容器存在，检查关键元素
        if (checkKeyElements(stickyColumn)) {
          console.log(`[EuraFlow] ✓ DOM 已稳定（用时 ${elapsed}ms，检查了 ${checkCount} 次）`);
          // 额外延迟300ms，确保 Vue 完全完成
          setTimeout(() => resolve(true), 300);
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
