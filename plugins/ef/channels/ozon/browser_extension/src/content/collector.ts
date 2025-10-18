import { DataFusionEngine } from './fusion/engine';
import { ApiClient } from '../shared/api-client';
import type { ProductData, CollectionProgress, CollectorConfig } from '../shared/types';

/**
 * 商品采集器（完全对齐原 Tampermonkey 版本）
 *
 * 核心特性：
 * 1. 渐进式滚动（半屏滚动，适配虚拟滚动）
 * 2. 智能重试机制（noChangeThreshold、forceScrollThreshold）
 * 3. 动态速度调整（根据新增商品数量）
 * 4. 防反爬虫延迟
 */
export class ProductCollector {
  public isRunning = false;
  private collected = new Map<string, ProductData>(); // SKU -> ProductData
  private progress: CollectionProgress = {
    collected: 0,
    target: 0,
    isRunning: false,
    errors: []
  };

  // 滚动控制参数（原版配置）
  private scrollStepSize = 0.5;  // 每次滚动视口倍数（0.5 = 半屏）
  private scrollCount = 0;
  private noChangeCount = 0;

  constructor(
    private fusionEngine: DataFusionEngine,
    private apiClient: ApiClient,
    private config: CollectorConfig
  ) {}

  /**
   * 开始采集（完全对齐原版）
   */
  async startCollection(
    targetCount: number,
    onProgress?: (progress: CollectionProgress) => void
  ): Promise<ProductData[]> {
    if (this.isRunning) {
      throw new Error('采集已在运行中');
    }

    this.isRunning = true;
    this.collected.clear();
    this.scrollCount = 0;
    this.noChangeCount = 0;
    this.scrollStepSize = 0.5;

    this.progress = {
      collected: 0,
      target: targetCount,
      isRunning: true,
      errors: []
    };

    try {
      // 【条件性初始扫描】仅在页面顶部时才进行初始扫描
      if (window.scrollY === 0) {
        await this.collectVisibleProducts();
        onProgress?.(this.progress);
        console.log(`[Collector] Initial scan: ${this.collected.size} products`);
      } else {
        console.log(`[Collector] Skip initial scan, scroll position: ${window.scrollY}px`);
      }

      let lastCollectedCount = this.collected.size;
      let sameCountTimes = 0;
      let forceScrollCount = 0;
      const maxScrollAttempts = 200;
      const noChangeThreshold = 5;

      // 自动滚动采集（原版逻辑）
      while (this.isRunning && this.scrollCount < maxScrollAttempts) {
        this.scrollCount++;

        // 检查是否达到目标
        if (this.collected.size >= targetCount) {
          console.log(`[Collector] Target reached: ${this.collected.size} products`);
          break;
        }

        // 获取当前页面状态
        const currentScroll = window.scrollY;
        const pageHeight = document.body.scrollHeight;
        const viewportHeight = window.innerHeight;
        const isNearBottom = currentScroll + viewportHeight >= pageHeight - 100;

        // 【智能滚动策略】原版逻辑
        let scrollDistance;
        if (isNearBottom) {
          // 接近底部：滚到最底部
          scrollDistance = pageHeight - currentScroll;
        } else {
          // 渐进式滚动：半屏或更少
          scrollDistance = viewportHeight * this.scrollStepSize;
        }

        // 执行滚动
        window.scrollTo({
          top: currentScroll + scrollDistance,
          behavior: 'smooth'
        });

        // 采集新商品（并行轮询）
        const beforeCount = this.collected.size;
        await this.collectVisibleProducts();
        const afterCount = this.collected.size;
        const actualNewCount = afterCount - beforeCount;

        this.progress.collected = this.collected.size;
        onProgress?.(this.progress);

        console.log(`[Collector] Scroll ${this.scrollCount}: ${actualNewCount} new, ${afterCount} total`);

        // 【智能重试机制】原版逻辑
        if (actualNewCount === 0) {
          this.noChangeCount++;

          if (afterCount === lastCollectedCount) {
            sameCountTimes++;

            // 强制滚到底部（最多3次）
            if (sameCountTimes >= 3 && afterCount < targetCount) {
              forceScrollCount++;

              if (forceScrollCount <= 3) {
                console.log(`[Collector] Force scroll to bottom (${forceScrollCount}/3)`);
                window.scrollTo(0, document.body.scrollHeight);
                await this.sleep(500);

                const newPageHeight = document.body.scrollHeight;
                if (newPageHeight > pageHeight) {
                  // 页面高度增加，重置计数器
                  sameCountTimes = 0;
                  this.noChangeCount = 0;
                  console.log('[Collector] Page height increased, continue');
                  continue;
                }
              } else {
                // 强制滚动3次后仍无新增，停止采集
                if (afterCount > 0) {
                  console.log(`[Collector] Force scroll exhausted, stop at ${afterCount} products`);
                  break;
                }
              }
            }
          } else {
            sameCountTimes = 0;
          }

          // 无变化阈值检查
          if (this.noChangeCount >= noChangeThreshold * 2) {
            console.log(`[Collector] No change threshold reached, stop at ${afterCount} products`);
            break;
          }
        } else {
          // 有新增：重置所有计数器
          this.noChangeCount = 0;
          sameCountTimes = 0;
          forceScrollCount = 0;
          lastCollectedCount = afterCount;

          // 【动态调整滚动速度】原版逻辑
          if (actualNewCount > 5) {
            // 新增较多：加速
            this.scrollStepSize = Math.min(this.scrollStepSize * 1.1, 2);
          } else if (actualNewCount === 0) {
            // 无新增：减速
            this.scrollStepSize = Math.max(this.scrollStepSize * 0.9, 0.8);
          }
        }

        // 【滚动延迟】防反爬虫
        if (this.config.scrollDelay > 0) {
          await this.sleep(this.config.scrollDelay);
        }
      }

      console.log(`[Collector] Collection completed: ${this.collected.size} products`);

      const products = Array.from(this.collected.values());

      // 上传数据（如果配置了自动上传）
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
   * 采集当前可见的商品
   */
  private async collectVisibleProducts(): Promise<void> {
    const cards = this.getVisibleProductCards();

    for (const card of cards) {
      if (!this.isRunning) {
        break;
      }

      try {
        const product = await this.fusionEngine.fuseProductData(card);

        // 去重：使用 SKU 作为唯一标识
        if (product.product_id && !this.collected.has(product.product_id)) {
          this.collected.set(product.product_id, product);
        }
      } catch (error: any) {
        console.warn('[Collector] Failed to extract product:', error.message);
        this.progress.errors.push(error.message);
      }
    }

    // 等待内容加载
    await this.sleep(this.config.scrollWaitTime);
  }

  /**
   * 获取当前可见的商品卡片
   */
  private getVisibleProductCards(): HTMLElement[] {
    // OZON 商品卡片的选择器
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
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
