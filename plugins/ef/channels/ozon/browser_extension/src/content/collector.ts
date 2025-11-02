import { DataFusionEngine } from './fusion/engine';
import type { ProductData, CollectionProgress } from '../shared/types';

// 全局DEBUG变量，可在控制台修改: window.EURAFLOW_DEBUG = true
declare global {
  interface Window {
    EURAFLOW_DEBUG: boolean;
  }
}

// 初始化DEBUG为false
if (typeof window.EURAFLOW_DEBUG === 'undefined') {
  window.EURAFLOW_DEBUG = false;
}

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
  private uploadedFingerprints = new Set<string>(); // 已上传商品的SKU集合（页面级生命周期）
  private progress: CollectionProgress = {
    collected: 0,
    target: 0,
    isRunning: false,
    errors: []
  };

  // 滚动控制参数
  private scrollStepSize = 0.5;  // 每次滚动视口倍数（0.5 = 半屏）
  private scrollCount = 0;
  private noChangeCount = 0;

  // 进度更新回调
  private onProgressCallback?: (progress: CollectionProgress) => void;

  constructor(
    private fusionEngine: DataFusionEngine
  ) {
    // 上传逻辑已移至 ControlPanel，collector 仅负责采集
  }

  /**
   * 开始采集
   */
  async startCollection(
    targetCount: number,
    onProgress?: (progress: CollectionProgress) => void
  ): Promise<ProductData[]> {
    if (this.isRunning) {
      throw new Error('采集已在运行中');
    }

    // 保存进度回调
    this.onProgressCallback = onProgress;

    // 【同步 DEBUG 状态】从 localStorage 读取（解决 content script 隔离环境问题）
    const debugFlag = localStorage.getItem('EURAFLOW_DEBUG');
    if (debugFlag === 'true' || debugFlag === '1') {
      window.EURAFLOW_DEBUG = true;
      console.log('[EuraFlow] 🐞 调试模式已启用');
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

    if (window.EURAFLOW_DEBUG) {
      console.log('[DEBUG] 开始采集，目标数量:', targetCount);
      console.log('[DEBUG] 已上传指纹集大小:', this.uploadedFingerprints.size);
    }

    try {
      // 初始扫描当前可见商品
      await this.collectVisibleProducts(targetCount);
      onProgress?.(this.progress);

      let lastCollectedCount = this.collected.size;
      let sameCountTimes = 0;
      let forceScrollCount = 0;
      const maxScrollAttempts = 200;
      const noChangeThreshold = 5;

      // 自动滚动采集
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

        // 【智能滚动策略】
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

        // 【优化等待1】轮询检测上品帮数据（100ms × 最多15次 = 1500ms）
        await this.waitForShangpinbangData(15);

        // 采集新商品（并行轮询）
        const beforeCount = this.collected.size;
        await this.collectVisibleProducts(targetCount);
        const afterCount = this.collected.size;
        const actualNewCount = afterCount - beforeCount;

        this.progress.collected = this.collected.size;
        onProgress?.(this.progress);

        if (window.EURAFLOW_DEBUG) {
          console.log('[DEBUG] 滚动次数:', this.scrollCount);
          console.log('[DEBUG] 新增商品数:', actualNewCount);
          console.log('[DEBUG] 当前采集总数:', afterCount, '/', targetCount);
          console.log('[DEBUG] 进度更新:', this.progress);
        }

        // 【智能重试机制】
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

          // 【动态调整滚动速度】.
          if (actualNewCount > 5) {
            // 新增较多：加速
            this.scrollStepSize = Math.min(this.scrollStepSize * 1.1, 2);
          } else if (actualNewCount === 0) {
            // 无新增：减速
            this.scrollStepSize = Math.max(this.scrollStepSize * 0.9, 0.8);
          }
        }

        // 【优化等待3】随机延迟（100-500ms），模拟真人浏览
        const randomDelay = Math.floor(Math.random() * 400) + 100; // 100-500ms
        await this.sleep(randomDelay);
      }

      const products = Array.from(this.collected.values());

      if (window.EURAFLOW_DEBUG) {
        console.log('[DEBUG] 采集完成！');
        console.log('[DEBUG] 总采集数:', products.length);
        console.log('[DEBUG] 目标数量:', targetCount);
        console.log('[DEBUG] 滚动次数:', this.scrollCount);
      }

      // 上传数据（如果配置了自动上传）
      // 注意：自动上传由外部控制，这里不自动上传
      // 上传逻辑应该在 ControlPanel 的 stopCollection 中处理

      // 限制返回数量不超过目标数量
      return products.slice(0, targetCount);
    } finally {
      this.isRunning = false;
      this.progress.isRunning = false;
      onProgress?.(this.progress);

      if (window.EURAFLOW_DEBUG) {
        console.log('[DEBUG] 采集器已停止');
      }
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
  private async collectVisibleProducts(targetCount?: number): Promise<void> {
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

      // 如果已经达到目标数量，停止采集
      if (targetCount && this.collected.size >= targetCount) {
        break;
      }

      // 等待整行数据就绪（关键优化：参考用户脚本）
      // 更新进度状态，让用户知道正在等待
      this.progress.status = `数据加载...`;
      const isRowReady = await this.waitForRowData(row);
      if (!isRowReady) {
        continue;
      }
      this.progress.status = '正在采集...';

      // 并行采集同一行的商品
      const rowPromises = row.map(async (card) => {
        try {
          const product = await this.fusionEngine.fuseProductData(card);

          // 去重：使用 SKU 作为唯一标识
          if (product.product_id &&
              !this.collected.has(product.product_id) &&
              !this.uploadedFingerprints.has(product.product_id)) {
            // 只有不在已采集集合且不在已上传指纹集中的商品才采集
            this.collected.set(product.product_id, product);
            // 实时更新进度（每个商品采集成功就更新）
            this.progress.collected = this.collected.size;

            if (window.EURAFLOW_DEBUG) {
              console.log('[DEBUG] 采集到新商品:', product.product_id, '当前总数:', this.collected.size);
              console.log('  [SKU]', product.product_id);
              console.log('  [rFBS佣金]',
                product.rfbs_commission_high ? `高=${product.rfbs_commission_high}% 中=${product.rfbs_commission_mid}% 低=${product.rfbs_commission_low}%` : '无数据'
              );
              console.log('  [包装重量]', product.package_weight || '无数据');
              console.log('  [跟卖者]',
                product.competitor_count !== undefined ? `${product.competitor_count}个` : '无数据',
                '跟卖最低价:',
                product.competitor_min_price || '无数据'
              );
            }

            return product;
          }
        } catch (error: any) {
          this.progress.errors.push(error.message);
        }
        return null;
      });

      // 等待整行采集完成
      const rowResults = await Promise.all(rowPromises);

      // 统计本行成功采集的商品数
      const successCount = rowResults.filter(p => p !== null).length;
      if (successCount > 0) {
        // 每行采集完成后立即更新UI进度
        this.onProgressCallback?.(this.progress);
      }
    }
  }

  /**
   * 等待上品帮数据注入（优化：100ms × maxAttempts）
   */
  private async waitForShangpinbangData(maxAttempts: number): Promise<void> {
    const interval = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // 检查是否有上品帮标记的商品
      const markedCards = document.querySelectorAll('[data-ozon-bang="true"]');

      if (markedCards.length > 0) {
        if (window.EURAFLOW_DEBUG) {
          console.log(`[DEBUG] 检测到上品帮数据（尝试 ${attempt + 1}/${maxAttempts}），找到 ${markedCards.length} 个已标记商品`);
        }
        return; // 有数据就立即进入下一流程
      }

      await this.sleep(interval);
    }

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG] 上品帮数据等待超时（${maxAttempts * interval}ms）`);
    }
  }

  /**
   * 等待整行数据就绪（优化：100ms × 20次 = 2000ms）
   */
  private async waitForRowData(row: HTMLElement[], maxAttempts = 20): Promise<boolean> {
    if (row.length === 0) return false;

    const interval = 100;

    // 检查最后一个商品的数据是否完整（上品帮按行注入数据）
    const lastCard = row[row.length - 1];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // 先尝试多种上品帮选择器
      let bangElement = lastCard.querySelector('.ozon-bang-item[data-ozon-bang="true"]') as HTMLElement;
      if (!bangElement) {
        // 备用选择器：可能没有 data-ozon-bang 属性
        bangElement = lastCard.querySelector('.ozon-bang-item') as HTMLElement;
      }

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

        // 检查包装重量是否已加载完成（值不是"-"就算加载完成，可以是"无数据"或实际值）
        // 三种状态：1) "-" 加载中  2) "无数据" 已加载  3) "100 g" 已加载
        const packageWeightMatch = bangText.match(/包装重量[：:]\s*([^\n<]+)/);
        const hasPackageWeightLoaded = packageWeightMatch && packageWeightMatch[1].trim() !== '-';

        // 【修复】检查佣金数据是否已加载（上品帮分步加载：先包装重量，后佣金）
        let hasRFBSLoaded = true; // 默认认为已加载
        if (bangText.includes('rFBS佣金')) {
          // 如果页面有 rFBS 佣金字段，检查其加载状态
          // 匹配 "rFBS佣金：" 后面的内容，直到遇到换行或下一个字段
          const rfbsMatch = bangText.match(/rFBS佣金[：:]\s*([^\n]+?)(?=\s*(?:FBP|包装|类目|品牌|月销|日销|跟卖|$))/);
          if (rfbsMatch) {
            const rfbsValue = rfbsMatch[1].trim();
            hasRFBSLoaded = rfbsValue !== '-'; // 值不是"-"就算加载完成

            if (window.EURAFLOW_DEBUG) {
              console.log(`[DEBUG waitForRowData] rFBS佣金值="${rfbsValue}" 已加载=${hasRFBSLoaded}`);
            }
          }
        }

        // 【修复】数据就绪条件：内容充足 + 跟卖数据 + 包装重量已加载 + 佣金已加载
        if (hasContent && hasCompetitorData && hasPackageWeightLoaded && hasRFBSLoaded) {
          if (window.EURAFLOW_DEBUG) {
            console.log('[DEBUG waitForRowData] 数据就绪，尝试次数:', attempt + 1);
          }
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

  /**
   * 更新指纹集（用于精确数量控制）
   * @param uploaded 已上传的商品SKU列表
   * @param notUploaded 未上传的商品SKU列表（需要从指纹集移除）
   */
  updateFingerprints(uploaded: string[], notUploaded: string[]): void {
    // 添加已上传的商品到指纹集
    uploaded.forEach(sku => this.uploadedFingerprints.add(sku));
    // 移除未上传的商品（确保下次能重新采集）
    notUploaded.forEach(sku => this.uploadedFingerprints.delete(sku));
  }

  /**
   * 获取累计采集统计
   */
  getCumulativeStats(): { totalUploaded: number; currentBatch: number } {
    return {
      totalUploaded: this.uploadedFingerprints.size,
      currentBatch: this.collected.size
    };
  }

  /**
   * 重置采集器（清空所有数据）
   * 注意：这个方法一般不需要调用，因为页面刷新/跳转时会自动重置
   */
  reset(): void {
    this.collected.clear();
    this.uploadedFingerprints.clear();
    this.progress = {
      collected: 0,
      target: 0,
      isRunning: false,
      errors: []
    };
  }
}
