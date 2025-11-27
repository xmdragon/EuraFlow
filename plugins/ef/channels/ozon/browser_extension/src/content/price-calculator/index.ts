/**
 * OZON 真实售价计算器 - 主类
 *
 * 在商品详情页自动计算并显示真实售价
 */

import { findPrices, calculateRealPrice } from './calculator';
import { injectCompleteDisplay } from './display';
import { configCache } from '../../shared/config-cache';
import { ApiClient } from '../../shared/api-client';
import { extractProductData } from '../parsers/product-detail';

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
        const apiClient = new ApiClient(result.apiUrl, result.apiKey);
        configCache.preload(apiClient)
          .then(() => {
            console.log('[EuraFlow] ✓ 配置数据预加载完成（店铺、仓库、水印已缓存）');
          })
          .catch((error) => {
            console.warn('[EuraFlow] ⚠ 配置数据预加载失败:', error.message);
          });
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
        const webSaleWidget = document.querySelector('div[data-widget="webSale"]');
        if (!webSaleWidget) return false;

        const deliveryContainer = webSaleWidget.querySelector('div[class*="pdp_fa"]');
        if (!deliveryContainer) return false;

        const hasSvg = deliveryContainer.querySelector('svg');
        return !hasSvg;
      };

      const checkReady = () => {
        checkCount++;
        const elapsed = Date.now() - startTime;

        if (elapsed > MAX_WAIT_TIME) {
          resolve(true);
          return;
        }

        if (checkKeyElements()) {
          setTimeout(() => resolve(true), 200);
        } else {
          setTimeout(checkReady, CHECK_INTERVAL);
        }
      };

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

      // 4. 【先提取变体数据】（必须在 content script 中调用 Modal API）
      let productDetail = null;
      try {
        productDetail = await extractProductData();
        console.log('[EuraFlow] ✅ 商品详情提取完成:', {
          标题: productDetail.title,
          变体数量: productDetail.variants?.length || 0,
          有变体: productDetail.has_variants
        });
      } catch (error: any) {
        console.error('[EuraFlow] ❌ 商品详情提取失败:', error);
        console.error('[EuraFlow] 错误堆栈:', error?.stack);
      }

      // 5. 【发送数据到 background】（包含已提取的变体数据）
      const pageCookie = document.cookie;
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_ALL_PRODUCT_DATA',
        data: {
          url: window.location.href,
          productSku: productId,
          cookieString: pageCookie,
          productDetail: productDetail  // 传递已提取的完整商品数据
        }
      });

      if (!response.success) {
        console.error('[EuraFlow] 数据获取失败:', response.error);
        return;
      }

      console.log('[EuraFlow] ✓ 数据采集完成');

      // 5. 【再等待 DOM 稳定】（此时配送日期应该已经加载好了）
      await this.waitForContainerReady();

      const { ozonProduct, spbSales, euraflowConfig } = response.data;

      // 6. 一次性注入完整组件
      await injectCompleteDisplay({
        message,
        price,
        ozonProduct,
        spbSales,
        euraflowConfig
      });
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
