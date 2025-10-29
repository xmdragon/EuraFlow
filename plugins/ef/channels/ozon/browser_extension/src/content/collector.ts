import { DataFusionEngine } from './fusion/engine';
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
    private config: CollectorConfig
  ) {
    // 上传逻辑已移至 ControlPanel，collector 仅负责采集
  }

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

    // 【检测数据工具】必须安装上品帮或毛子ERP
    const availableParsers = this.fusionEngine.getAvailableParsers();

    if (availableParsers.length === 0) {
      const errorMsg = '❌ 未检测到上品帮或毛子ERP插件\n\n请先安装至少一个数据工具：\n- 上品帮 Chrome扩展\n- 毛子ERP Chrome扩展\n\n提示：安装后刷新OZON页面';
      this.progress.errors.push(errorMsg);
      throw new Error(errorMsg);
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
      // 初始扫描当前可见商品
      await this.collectVisibleProducts();
      onProgress?.(this.progress);

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

        // 【关键修复】先等待页面加载（对齐 Tampermonkey 版本）
        await this.sleep(this.config.scrollWaitTime);

        // 采集新商品（并行轮询）
        const beforeCount = this.collected.size;
        await this.collectVisibleProducts();
        const afterCount = this.collected.size;
        const actualNewCount = afterCount - beforeCount;

        this.progress.collected = this.collected.size;
        onProgress?.(this.progress);

        // 【智能重试机制】原版逻辑
        if (actualNewCount === 0) {
          this.noChangeCount++;

          if (afterCount === lastCollectedCount) {
            sameCountTimes++;

            // 强制滚到底部（最多3次）
            if (sameCountTimes >= 3 && afterCount < targetCount) {
              forceScrollCount++;

              if (forceScrollCount <= 3) {
                window.scrollTo(0, document.body.scrollHeight);
                await this.sleep(500);

                const newPageHeight = document.body.scrollHeight;
                if (newPageHeight > pageHeight) {
                  // 页面高度增加，重置计数器
                  sameCountTimes = 0;
                  this.noChangeCount = 0;
                  continue;
                }
              } else {
                // 强制滚动3次后仍无新增，停止采集
                if (afterCount > 0) {
                  break;
                }
              }
            }
          } else {
            sameCountTimes = 0;
          }

          // 无变化阈值检查
          if (this.noChangeCount >= noChangeThreshold * 2) {
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

      const products = Array.from(this.collected.values());

      // 上传数据（如果配置了自动上传）
      // 注意：自动上传由外部控制，这里不自动上传
      // 上传逻辑应该在 ControlPanel 的 stopCollection 中处理

      // 限制返回数量不超过目标数量
      return products.slice(0, targetCount);
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
   * 获取已采集的商品
   */
  getCollectedProducts(): ProductData[] {
    return Array.from(this.collected.values());
  }

  /**
   * 采集当前可见的商品（优化：按行分组并行处理）
   */
  private async collectVisibleProducts(): Promise<void> {
    const cards = this.getVisibleProductCards();

    // 参考用户脚本：按行分组处理（通常一行4个商品）
    const rowSize = 4;
    const rows: HTMLElement[][] = [];
    for (let i = 0; i < cards.length; i += rowSize) {
      rows.push(cards.slice(i, i + rowSize));
    }

    // 逐行采集（每行内并行处理）
    for (const row of rows) {
      if (!this.isRunning) {
        break;
      }

      // 等待整行数据就绪（关键优化：参考用户脚本）
      const isRowReady = await this.waitForRowData(row);
      if (!isRowReady) {
        console.warn(`[Collector] 行数据未就绪，跳过该行（${row.length}个商品）`);
        continue;
      }

      // 并行采集同一行的商品
      const rowPromises = row.map(async (card) => {
        try {
          const product = await this.fusionEngine.fuseProductData(card);

          // 去重：使用 SKU 作为唯一标识
          if (product.product_id && !this.collected.has(product.product_id)) {
            this.collected.set(product.product_id, product);
            return product;
          }
        } catch (error: any) {
          console.warn('[Collector] Failed to extract product:', error.message);
          this.progress.errors.push(error.message);
        }
        return null;
      });

      // 等待整行采集完成
      const rowResults = await Promise.all(rowPromises);

      // 统计本行成功采集的商品数
      const successCount = rowResults.filter(p => p !== null).length;
      if (successCount > 0) {
        console.log(`[Collector] 本行采集成功 ${successCount}/${row.length} 个商品`);
      }
    }
  }

  /**
   * 等待整行数据就绪（参考用户脚本逻辑）
   */
  private async waitForRowData(row: HTMLElement[], maxWait = 2000): Promise<boolean> {
    if (row.length === 0) return false;

    const startTime = Date.now();
    const interval = 200;

    // 检查最后一个商品的数据是否完整（上品帮按行注入数据）
    const lastCard = row[row.length - 1];

    while (Date.now() - startTime < maxWait) {
      // 上品帮的根容器选择器（注意：data-ozon-bang="true" 是关键标识）
      const bangElement = lastCard.querySelector('.ozon-bang-item[data-ozon-bang="true"]') as HTMLElement;

      if (bangElement) {
        const bangText = bangElement.textContent || '';
        const bangHtml = bangElement.innerHTML || '';

        // 数据完整性检查（与用户脚本保持一致）
        const hasContent = bangText.trim().length > 50;

        // 检查跟卖数据（支持多种格式）
        // 1. 跟卖最低价：xxx ¥
        const hasMinPrice = /跟卖最低价[：:]\s*[\d\s,．]+\s*[¥₽]/.test(bangText);
        // 2. 跟卖最低价：无跟卖
        const hasNoCompetitorPrice = /跟卖最低价[：:]\s*无跟卖/.test(bangText);
        // 3. 跟卖者：无跟卖
        const hasNoCompetitorSeller = /跟卖者[：:]\s*.*无跟卖/.test(bangText);
        // 4. 等X个卖家（HTML格式）
        const hasSellerCount = />(\d+)<\/span>\s*个卖家/.test(bangHtml) || /等\d+个卖家/.test(bangText);

        // 任何一种跟卖数据格式都算有效
        const hasCompetitorData = hasMinPrice || hasNoCompetitorPrice || hasNoCompetitorSeller || hasSellerCount;

        // 检查佣金数据（新格式：支持多个佣金段）
        const hasRFBSCommission = /rFBS佣金[：:]/.test(bangText) && /%/.test(bangText);
        const hasFBPCommission = /FBP佣金[：:]/.test(bangText) && /%/.test(bangText);

        // 数据就绪条件：内容充足 + 跟卖数据 + (rFBS或FBP至少一个)
        if (hasContent && hasCompetitorData && (hasRFBSCommission || hasFBPCommission)) {
          console.log('[Collector] 行数据就绪（上品帮）');
          return true;
        }
      }

      // 同时检查毛子ERP（data-mz-widget）
      const mzElement = lastCard.querySelector('[data-mz-widget]') as HTMLElement;
      if (mzElement) {
        const mzText = mzElement.textContent || '';
        const mzHtml = mzElement.innerHTML || '';

        // 毛子ERP的数据完整性检查
        const hasContent = mzText.trim().length > 50;

        // 检查跟卖数据（毛子ERP格式）
        // 1. 跟卖列表：无 或 等X个卖家
        const hasSellerList = /跟卖列表[：:]\s*无/.test(mzText) ||
                            /等\s*\d+\s*个\s*卖家/.test(mzText) ||
                            />(\d+)<\/span>\s*个?\s*卖家/.test(mzHtml);
        // 2. 跟卖最低价：无 或 数字
        const hasMinPrice = /跟卖最低价[：:]\s*无/.test(mzText) ||
                          /跟卖最低价[：:]\s*[\d\s,．]+/.test(mzText);

        const hasCompetitorData = hasSellerList || hasMinPrice;

        // 检查佣金数据
        const hasCommission = /rFBS佣金[：:]/.test(mzText) || /FBP佣金[：:]/.test(mzText);

        // 数据就绪条件：内容充足 + 跟卖数据 + 佣金数据
        if (hasContent && hasCompetitorData && hasCommission) {
          console.log('[Collector] 行数据就绪（毛子ERP）');
          return true;
        }
      }

      await this.sleep(interval);
    }

    return false;
  }

  /**
   * 获取当前可见的商品卡片
   * 【重要】仅返回有数据工具标记的商品（上品帮或毛子ERP）
   */
  private getVisibleProductCards(): HTMLElement[] {
    // 获取所有可能的商品卡片
    const selectors = [
      '[data-widget="searchResultsV2"] > div',
      '[data-widget="megaPaginator"] > div',
      '.tile-root',
      'div[class*="tile"]'
    ];

    let allCards: HTMLElement[] = [];
    for (const selector of selectors) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      if (elements.length > 0) {
        allCards = Array.from(elements);
        break;
      }
    }

    if (allCards.length === 0) {
      return [];
    }

    // 【关键过滤】只返回有数据工具标记的商品
    const filtered = allCards.filter(card => {
      // 检查是否有商品链接
      const hasProductLink = !!card.querySelector('a[href*="/product/"]');
      if (!hasProductLink) {
        return false;
      }

      // 检查上品帮标记
      const hasShangpinbang = card.getAttribute('data-ozon-bang') === 'true';

      // 检查毛子ERP标记
      const hasMaoziErp = !!card.querySelector('[data-mz-widget]');

      // 必须至少有一个数据工具标记
      return hasShangpinbang || hasMaoziErp;
    });

    return filtered;
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
