/**
 * OZON 真实售价计算器 - 主类
 *
 * 在商品详情页自动计算并显示真实售价
 */

import { findPrices, calculateRealPrice } from './calculator';
import { injectCompleteDisplay } from './display';

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
   * 等待目标容器出现且稳定（Vue渲染完成）
   * 使用轮询+稳定性检查
   */
  private async waitForContainerReady(): Promise<boolean> {
    const MAX_ATTEMPTS = 50; // 最多等待5秒（50 * 100ms）
    const STABLE_CHECK_COUNT = 3; // 连续3次检查都存在才认为稳定

    let stableCount = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const container = document.querySelector('.container') as HTMLElement | null;

      if (container?.lastChild) {
        const rightSide = (container.lastChild as HTMLElement).lastChild as HTMLElement | null;

        if (rightSide && rightSide.children && rightSide.children.length > 0) {
          const targetContainer = (rightSide.children[0] as HTMLElement)?.firstChild as HTMLElement ||
                                  (rightSide.children[1] as HTMLElement)?.firstChild as HTMLElement;

          if (targetContainer) {
            stableCount++;

            // 连续3次都检测到容器，认为已稳定
            if (stableCount >= STABLE_CHECK_COUNT) {
              return true;
            }
          } else {
            stableCount = 0;
          }
        } else {
          stableCount = 0;
        }
      } else {
        stableCount = 0;
      }

      // 等待100ms后重试
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.warn('[EuraFlow] 等待目标容器超时');
    return false;
  }

  /**
   * 初始化计算器
   */
  public async init(): Promise<void> {
    try {
      // 1. 等待容器稳定
      console.log('[EuraFlow] 等待容器稳定...');
      const isReady = await this.waitForContainerReady();
      if (!isReady) {
        console.error('[EuraFlow] 容器未就绪');
        return;
      }

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

      // 4. 发送消息到 service worker，并发获取所有数据
      console.log('[EuraFlow] 并发获取所有商品数据...');
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_ALL_PRODUCT_DATA',
        data: {
          url: window.location.href,
          productId: productId
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

      // 5. 一次性注入完整组件
      await injectCompleteDisplay({
        message,
        price,
        ozonProduct,
        spbSales,
        dimensions,
        euraflowConfig
      });

      console.log('[EuraFlow] 组件注入完成');
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
