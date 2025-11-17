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
const DEBOUNCE_DELAY = 0;

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
  private containerObserver: MutationObserver | null = null;
  private debouncedCalculate: () => void;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessage: string | null = null;
  private lastPrice: number | null = null;
  private lastProductData: any = null;

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

      // 监听 pdp_as2 容器变化，防止组件被 OZON 重新渲染时移除
      this.setupContainerObserver();

      // 启动保活机制：每5秒检查一次，如果组件被移除则重新注入
      this.startKeepAlive();

      // 后台预加载配置数据（异步，不阻塞）
      this.preloadConfigInBackground();

      // 后台异步加载商品详情（只执行一次）
      this.loadProductDataInBackground(this.lastMessage, this.lastPrice);
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
      const ourElement = document.getElementById('euraflow-section');
      if (!ourElement && this.lastMessage) {
        console.log('[EuraFlow] 检测到组件被移除，重新注入');
        injectOrUpdateDisplay(this.lastMessage, this.lastPrice, this.lastProductData);
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

      // 如果商品数据已经加载过，直接使用缓存的数据
      if (this.lastProductData !== null) {
        // 更新变体的真实售价（价格可能变化）
        if (this.lastProductData.has_variants && this.lastProductData.variants) {
          this.lastProductData.variants = this.lastProductData.variants.map((variant: any) => ({
            ...variant,
            real_price: this.calculateVariantRealPrice(variant.price, variant.old_price)
          }));
        }
        // 直接更新显示，不重新采集数据
        injectOrUpdateDisplay(message, price, this.lastProductData);
        return;
      }

      // 首次加载时不注入，等商品数据准备好后再注入（避免被OZON移除）
      // injectOrUpdateDisplay(message, price, null);
    } catch (error) {
      console.error('[EuraFlow] Real Price Calculator error:', error);
    }
  }

  /**
   * 后台异步加载商品详情（不阻塞价格计算器显示）
   * 只在初始化时调用一次
   */
  private async loadProductDataInBackground(message: string | null, price: number | null): Promise<void> {
    try {
      const module = await import('../parsers/product-detail');
      const productData = await module.extractProductData();

      // 如果有商品数据，计算所有变体的真实售价
      if (productData && productData.has_variants && productData.variants) {
        productData.variants = productData.variants.map((variant: any) => ({
          ...variant,
          real_price: this.calculateVariantRealPrice(variant.price, variant.old_price)
        }));
      }

      // 保存商品数据（用于后续复用）
      this.lastProductData = productData;

      // 更新显示，启用"一键跟卖"按钮
      injectOrUpdateDisplay(message, price, productData);
    } catch (error) {
      console.error('[EuraFlow] 提取商品详情失败:', error);
      // 加载失败不影响价格显示，按钮保持禁用状态
      this.lastProductData = null;
    }
  }

  /**
   * 计算变体的真实售价
   */
  private calculateVariantRealPrice(currentPrice: number, oldPrice: number | null): number | null {
    if (oldPrice && oldPrice > currentPrice) {
      // 有划线价且大于当前价，计算折扣率
      const discount = 1 - (currentPrice / oldPrice);
      return currentPrice / (1 - discount);
    } else {
      // 没有划线价或当前价≥划线价，使用固定系数
      return currentPrice * CONFIG.FORMULA_MULTIPLIER;
    }
  }

  /**
   * 监听目标容器的变化，防止组件被 OZON 重新渲染时移除
   */
  private setupContainerObserver(): void {
    // 查找 OZON 商品详情页右侧容器
    const targetContainer = document.querySelector('div[data-widget="webPdpGrid"]');
    if (!targetContainer) {
      console.log('[EuraFlow] 未找到目标容器，无法监听');
      return;
    }

    console.log('[EuraFlow] 找到目标容器，开始监听');

    // 创建 MutationObserver 监听目标容器的子元素变化
    this.containerObserver = new MutationObserver(() => {
      // 检查我们的组件是否还存在
      const ourElement = document.getElementById('euraflow-section');
      if (!ourElement && this.lastMessage) {
        console.log('[EuraFlow] 检测到组件被移除，立即重新注入');
        injectOrUpdateDisplay(this.lastMessage, this.lastPrice, this.lastProductData);
      }
    });

    // 监听目标容器的子元素变化（包括子树）
    this.containerObserver.observe(targetContainer, {
      childList: true,
      subtree: true,
    });

    console.log('[EuraFlow] 已启动目标容器监听');
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
