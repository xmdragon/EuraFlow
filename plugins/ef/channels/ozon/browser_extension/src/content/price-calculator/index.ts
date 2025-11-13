/**
 * OZON 真实售价计算器 - 主类
 *
 * 在商品详情页自动计算并显示真实售价
 */

import { findPrices, calculateRealPrice, CONFIG } from './calculator';
import { injectOrUpdateDisplay } from './display';
import { ApiClient } from '../../shared/api-client';
import { configCache } from '../../shared/config-cache';
import { getApiConfig } from '../../shared/storage';

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
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessage: string | null = null;
  private lastPrice: number | null = null;

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
      // 延迟2秒注入，避免被其他扩展（如上品帮）覆盖
      setTimeout(() => {
        console.log('[EuraFlow] 延迟注入组件（2秒后）');
        // 首次执行计算和显示
        this.calculateAndDisplay();

        // 设置动态监听
        this.setupDynamicListener();

        // 启动保活机制：每5秒检查一次，如果组件被移除则重新注入
        this.startKeepAlive();
      }, 2000);

      // 后台预加载配置数据（异步，不阻塞）
      this.preloadConfigInBackground();
    } catch (error) {
      console.error('[EuraFlow] Real Price Calculator initialization error:', error);
    }
  }

  /**
   * 启动保活机制：定期检查组件是否存在，不存在则重新注入
   */
  private startKeepAlive(): void {
    this.keepAliveTimer = setInterval(() => {
      // 检查我们的组件是否还存在
      const ourElement = document.getElementById('euraflow-real-price');
      if (!ourElement && this.lastMessage) {
        console.log('[EuraFlow] 检测到组件被移除，重新注入');
        injectOrUpdateDisplay(this.lastMessage, this.lastPrice);
      }
    }, 5000); // 每5秒检查一次
  }

  /**
   * 后台预加载配置数据（店铺、仓库、水印）
   * 异步执行，不阻塞页面渲染
   */
  private async preloadConfigInBackground(): Promise<void> {
    try {
      const config = await getApiConfig();
      if (!config.apiUrl || !config.apiKey) {
        console.log('[EuraFlow] API未配置，跳过预加载');
        return;
      }

      const apiClient = new ApiClient(config.apiUrl, config.apiKey);
      await configCache.preload(apiClient);
    } catch (error) {
      console.error('[EuraFlow] 预加载配置失败:', error);
      // 预加载失败不影响页面功能
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

      // 保存最后的消息和价格（用于保活机制）
      this.lastMessage = message;
      this.lastPrice = price;

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
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}
