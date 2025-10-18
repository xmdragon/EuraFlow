import { DataFusionEngine } from './fusion/engine';
import { ApiClient } from '../shared/api-client';
import type { ProductData, CollectionProgress, CollectorConfig } from '../shared/types';

/**
 * 商品采集器
 *
 * 负责：
 * 1. 遍历页面上的商品卡片
 * 2. 使用融合引擎提取数据
 * 3. 处理虚拟滚动
 * 4. 去重
 * 5. 上传数据到EuraFlow
 */
export class ProductCollector {
  private isRunning = false;
  private collected = new Map<string, ProductData>(); // SKU -> ProductData
  private progress: CollectionProgress = {
    collected: 0,
    target: 0,
    isRunning: false,
    errors: []
  };

  constructor(
    private fusionEngine: DataFusionEngine,
    private apiClient: ApiClient,
    private config: CollectorConfig
  ) {}

  /**
   * 开始采集
   */
  async startCollection(targetCount: number, onProgress?: (progress: CollectionProgress) => void): Promise<ProductData[]> {
    if (this.isRunning) {
      throw new Error('采集已在运行中');
    }

    this.isRunning = true;
    this.collected.clear();
    this.progress = {
      collected: 0,
      target: targetCount,
      isRunning: true,
      errors: []
    };

    try {
      let scrollAttempts = 0;
      const maxScrollAttempts = 200;
      let noChangeCount = 0;

      while (this.collected.size < targetCount && scrollAttempts < maxScrollAttempts) {
        // 1. 获取当前可见的商品卡片
        const cards = this.getVisibleProductCards();

        // 2. 采集新商品
        const previousCount = this.collected.size;

        for (const card of cards) {
          if (this.collected.size >= targetCount) {
            break;
          }

          try {
            const product = await this.fusionEngine.fuseProductData(card);

            // 去重：使用SKU作为唯一标识
            if (product.product_id && !this.collected.has(product.product_id)) {
              this.collected.set(product.product_id, product);

              this.progress.collected = this.collected.size;
              onProgress?.(this.progress);
            }
          } catch (error: any) {
            console.warn('[Collector] Failed to extract product:', error.message);
            this.progress.errors.push(error.message);
          }
        }

        // 3. 检查是否有新商品
        if (this.collected.size === previousCount) {
          noChangeCount++;
          if (noChangeCount >= 3) {
            console.log('[Collector] No new products after 3 scrolls, stopping');
            break;
          }
        } else {
          noChangeCount = 0;
        }

        // 4. 滚动加载更多
        if (this.collected.size < targetCount) {
          await this.scrollToLoadMore();
          scrollAttempts++;
        }
      }

      console.log(`[Collector] Collection completed: ${this.collected.size} products`);

      const products = Array.from(this.collected.values());

      // 5. 上传数据（如果配置了自动上传）
      if (this.config && products.length > 0) {
        try {
          await this.apiClient.uploadProducts(products);
          console.log('[Collector] Upload successful');
        } catch (error: any) {
          console.error('[Collector] Upload failed:', error);
          this.progress.errors.push(`上传失败: ${error.message}`);
        }
      }

      return products;
    } finally {
      this.isRunning = false;
      this.progress.isRunning = false;
      onProgress?.(this.progress);
    }
  }

  /**
   * 停止采集
   */
  stopCollection(): void {
    this.isRunning = false;
    this.progress.isRunning = false;
  }

  /**
   * 获取当前进度
   */
  getProgress(): CollectionProgress {
    return { ...this.progress };
  }

  /**
   * 获取当前可见的商品卡片
   */
  private getVisibleProductCards(): HTMLElement[] {
    // OZON商品卡片的选择器（可能需要根据实际情况调整）
    const selectors = [
      '[data-widget="searchResultsV2"] > div',
      '[data-widget="megaPaginator"] > div',
      'div[class*="tile"]',
      'div[class*="product"]'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      if (elements.length > 0) {
        // 过滤掉不包含商品链接的元素
        return Array.from(elements).filter(el =>
          el.querySelector('a[href*="/product/"]')
        );
      }
    }

    return [];
  }

  /**
   * 滚动以加载更多商品
   */
  private async scrollToLoadMore(): Promise<void> {
    // 滚动到页面底部
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: 'smooth'
    });

    // 等待内容加载
    await this.sleep(this.config.scrollWaitTime);

    // 额外延迟（防反爬虫）
    if (this.config.scrollDelay > 0) {
      await this.sleep(this.config.scrollDelay - this.config.scrollWaitTime);
    }
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
