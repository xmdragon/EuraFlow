/**
 * OZON 真实售价计算器 - 主类
 *
 * 在商品详情页自动计算并显示真实售价
 */

import { findPrices, calculateRealPrice, CONFIG } from './calculator';
import { injectOrUpdateDisplay } from './display';

/**
 * 防抖延迟（毫秒）
 */
const DEBOUNCE_DELAY = 500;

/**
 * 防抖函数
 */
function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * 真实售价计算器主类
 */
export class RealPriceCalculator {
  private observer: MutationObserver | null = null;
  private debouncedCalculate: () => void;

  constructor() {
    this.debouncedCalculate = debounce(
      this.calculateAndDisplay.bind(this),
      DEBOUNCE_DELAY
    );
  }

  /**
   * 初始化计算器
   */
  public init(): void {
    try {
      // 首次执行计算和显示
      this.calculateAndDisplay();

      // 设置动态监听
      this.setupDynamicListener();
    } catch (error) {
      console.error('[EuraFlow] Real Price Calculator initialization error:', error);
    }
  }

  /**
   * 主执行函数：计算并显示真实售价
   */
  private calculateAndDisplay(): void {
    try {
      // 查找价格
      const { greenPrice, blackPrice, currency } = findPrices();

      // 如果没有找到任何价格，静默失败
      if (blackPrice === null && greenPrice === null) {
        return;
      }

      // 计算真实售价
      const { message, price } = calculateRealPrice(
        greenPrice,
        blackPrice,
        currency
      );

      // 注入或更新显示（传递价格数值用于"一键跟卖"按钮）
      injectOrUpdateDisplay(message, price);
    } catch (error) {
      console.error('[EuraFlow] Real Price Calculator error:', error);
    }
  }

  /**
   * 设置动态监听（使用 MutationObserver）
   */
  private setupDynamicListener(): void {
    // 创建 MutationObserver
    this.observer = new MutationObserver((mutations) => {
      // 检查是否有相关元素变化
      let shouldUpdate = false;

      for (const mutation of mutations) {
        // 检查是否影响价格区域
        if (mutation.target instanceof Element) {
          const target = mutation.target;
          if (
            target.closest(CONFIG.SELECTORS.priceWidget) ||
            target.querySelector(CONFIG.SELECTORS.priceWidget)
          ) {
            shouldUpdate = true;
            break;
          }
        }
      }

      if (shouldUpdate) {
        this.debouncedCalculate();
      }
    });

    // 监听整个文档的子树变化
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-widget'],
    });
  }

  /**
   * 销毁计算器，清理资源
   */
  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
