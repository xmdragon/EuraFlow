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
 * 正在采集的商品数据（两阶段采集）
 */
interface CollectingProduct {
  data: ProductData;          // 商品数据（不断更新）
  isComplete: boolean;         // 关键数据是否完整
  checkCount: number;          // 检测轮数
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
      // 【新】初始扫描：边检测边采集
      await this.waitAndCollect(targetCount);
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

        // 【新】边检测边采集（50ms轮询，最多3秒）
        const actualNewCount = await this.waitAndCollect(targetCount);
        const afterCount = this.collected.size;

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
   * 采集当前可见的商品（两阶段采集 + SKU属性标记 + 轮询增强）
   *
   * @deprecated 已被 waitAndCollect 替代，保留此方法用于备用/调试
   *
   * 阶段1：快速采集所有已有数据（几百毫秒）
   * 阶段2：轮询增强关键数据（最多2秒）
   * 阶段3：存储到已采集集合
   */
  // @ts-ignore - 保留用于备用/调试
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async collectVisibleProducts(targetCount?: number): Promise<void> {
    const cards = this.getVisibleProductCards();

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG] 开始两阶段采集，可见商品: ${cards.length}个`);
    }

    // ====== 阶段1：快速采集所有已有数据 ======
    const tempMap = new Map<string, CollectingProduct>();

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];

      if (!this.isRunning) break;

      try {
        // 【优化】先快速提取 SKU，避免对重复商品做完整数据提取
        const sku = this.quickExtractSKU(card);
        if (!sku) {
          if (window.EURAFLOW_DEBUG) {
            console.log(`[DEBUG 阶段1] 第 ${i + 1} 个卡片无法提取SKU，跳过`);
          }
          continue;
        }

        // 跳过已采集或已上传的商品（基于 SKU 指纹）
        if (this.collected.has(sku) || this.uploadedFingerprints.has(sku)) {
          if (window.EURAFLOW_DEBUG) {
            console.log(`[DEBUG 阶段1] 跳过已采集商品: ${sku}`);
          }
          continue;
        }

        // 【修复】在跳过重复商品之后再检查目标数量
        if (targetCount && (tempMap.size + this.collected.size) >= targetCount) {
          if (window.EURAFLOW_DEBUG) {
            console.log(`[DEBUG 阶段1] 已达目标数量，停止采集 (tempMap=${tempMap.size}, collected=${this.collected.size}, target=${targetCount})`);
          }
          break;
        }

        // 【关键】给卡片添加 data-sku 属性，方便后续定位
        card.setAttribute('data-sku', sku);

        // 立即采集完整数据（不等待）
        const product = await this.fusionEngine.fuseProductDataImmediate(card);

        if (product.product_id) {

          tempMap.set(product.product_id, {
            data: product,
            isComplete: this.isProductComplete(product),
            checkCount: 0
          });

          if (window.EURAFLOW_DEBUG) {
            // 【增强】更清晰地显示重量值（区分undefined、0和数字）
            const weightDisplay = product.package_weight === undefined
              ? 'undefined(未加载)'
              : (product.package_weight === 0 ? '0(无数据)' : `${product.package_weight}g`);

            console.log(`[DEBUG 阶段1] 采集 ${tempMap.size}/${targetCount || '∞'}: ${product.product_id}`, {
              完整: this.isProductComplete(product),
              'rFBS(高/中/低)': `${product.rfbs_commission_high}/${product.rfbs_commission_mid}/${product.rfbs_commission_low}`,
              重量: weightDisplay,
              跟卖: product.competitor_count
            });
          }
        }
      } catch (error: any) {
        this.progress.errors.push(error.message);
        if (window.EURAFLOW_DEBUG) {
          console.log(`[DEBUG 阶段1] 第 ${i + 1} 个卡片采集失败:`, error.message);
        }
      }
    }

    // 更新进度
    this.progress.collected = tempMap.size;
    const completeCount = Array.from(tempMap.values()).filter(p => p.isComplete).length;
    this.progress.status = `快速采集完成: ${completeCount}/${tempMap.size} 完整`;
    this.onProgressCallback?.(this.progress);

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG 阶段1] 完成，已采集 ${tempMap.size} 个商品，其中 ${completeCount} 个数据完整`);
    }

    // ====== 阶段2：轮询增强关键数据 ======
    const maxRounds = 40;  // 最多40轮 × 50ms = 2秒
    let round = 0;

    while (this.hasIncompleteProducts(tempMap) && round < maxRounds && this.isRunning) {
      await this.sleep(50);
      round++;

      let enhancedCount = 0;

      for (const [sku, item] of tempMap) {
        if (item.isComplete) continue;

        // 【关键】通过 data-sku 属性快速定位卡片
        const card = document.querySelector(`[data-sku="${sku}"]`) as HTMLElement;
        if (!card) {
          if (window.EURAFLOW_DEBUG) {
            console.warn(`[DEBUG] 找不到卡片 [data-sku="${sku}"]，可能已被移除`);
          }
          continue;
        }

        try {
          // 重新提取数据（不等待）
          const updated = await this.fusionEngine.fuseProductDataImmediate(card);

          // 【优化】智能合并：只更新从undefined变为有值的字段
          const beforeData = { ...item.data };
          this.smartMerge(item.data, updated);
          const wasComplete = item.isComplete;
          item.isComplete = this.isProductComplete(item.data);
          item.checkCount++;

          // DEBUG：仅在有新字段被填充时打印
          if (window.EURAFLOW_DEBUG) {
            const newlyFilledFields = this.getNewlyFilledFields(beforeData, item.data);
            if (newlyFilledFields.length > 0) {
              console.log(`[DEBUG 阶段2] SKU=${sku} 新填充字段:`, newlyFilledFields);
            }
          }

          // 数据从不完整变为完整
          if (!wasComplete && item.isComplete) {
            enhancedCount++;
            if (window.EURAFLOW_DEBUG) {
              console.log(`[DEBUG 阶段2] 数据完整 (第${round}轮): ${sku}`, {
                'rFBS(高/中/低)': `${item.data.rfbs_commission_high}/${item.data.rfbs_commission_mid}/${item.data.rfbs_commission_low}`,
                重量: item.data.package_weight,
                跟卖: item.data.competitor_count
              });
            }
          }
        } catch (error: any) {
          // 轮询增强失败不影响已有数据
          if (window.EURAFLOW_DEBUG) {
            console.warn(`[DEBUG 阶段2] SKU ${sku} 增强失败:`, error.message);
          }
        }
      }

      // 更新进度
      const newCompleteCount = Array.from(tempMap.values()).filter(p => p.isComplete).length;
      this.progress.status = `增强中 (第${round}轮)... ${newCompleteCount}/${tempMap.size} 完整`;
      this.onProgressCallback?.(this.progress);

      if (window.EURAFLOW_DEBUG && enhancedCount > 0) {
        console.log(`[DEBUG 阶段2] 第${round}轮：${enhancedCount} 个商品数据完整`);
      }
    }

    // 轮询结束统计
    const finalCompleteCount = Array.from(tempMap.values()).filter(p => p.isComplete).length;
    const incompleteCount = tempMap.size - finalCompleteCount;

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG 阶段2] 完成，共${round}轮，完整 ${finalCompleteCount}/${tempMap.size}`);
      if (incompleteCount > 0) {
        console.warn(`[DEBUG] 仍有 ${incompleteCount} 个商品数据不完整`);
        // 输出不完整的商品SKU
        const incompleteSKUs = Array.from(tempMap.entries())
          .filter(([, item]) => !item.isComplete)
          .map(([sku]) => sku);
        console.warn('[DEBUG] 不完整商品SKU:', incompleteSKUs);
      }
    }

    // ====== 阶段3：移动到已采集集合 ======
    for (const [sku, item] of tempMap) {
      if (!this.collected.has(sku) && !this.uploadedFingerprints.has(sku)) {
        this.collected.set(sku, item.data);

        if (window.EURAFLOW_DEBUG) {
          const weightDisplay = item.data.package_weight !== undefined
            ? (item.data.package_weight === 0 ? '无数据' : item.data.package_weight)
            : '✗';

          console.log(`[DEBUG 阶段3] 存储: ${sku}`, {
            完整: item.isComplete,
            检测轮数: item.checkCount,
            'rFBS(高/中/低)': `${item.data.rfbs_commission_high || '✗'}/${item.data.rfbs_commission_mid || '✗'}/${item.data.rfbs_commission_low || '✗'}`,
            重量: weightDisplay,
            跟卖: item.data.competitor_count !== undefined ? '✓' : '✗'
          });
        }
      }
    }

    // 最终进度
    this.progress.collected = this.collected.size;
    this.progress.status = incompleteCount > 0
      ? `完成 (${incompleteCount}个不完整)`
      : '完成';
    this.onProgressCallback?.(this.progress);
  }

  /**
   * 判断商品数据是否完整（关键数据都已加载）
   *
   * 关键数据：rFBS佣金、包装重量、跟卖数据
   *
   * 【修正】数据状态：
   * - undefined = 未加载（上品帮还在渲染，页面显示"-"）
   * - "无数据" = 已加载完成（上品帮确认无数据）
   * - 实际值 = 已加载完成（有数据）
   */
  private isProductComplete(product: Partial<ProductData>): boolean {
    if (!product.product_id) return false;

    // 【修正】数据状态说明：
    // - undefined = 未加载（上品帮还在渲染，显示"-"）
    // - "无数据" = 已加载完成（上品帮确认无数据）
    // - 数字/字符串 = 已加载完成（有实际数据）

    // 关键数据1：rFBS佣金（三个档位至少有一个不是 undefined）
    const hasRFBS = product.rfbs_commission_high !== undefined ||
                    product.rfbs_commission_mid !== undefined ||
                    product.rfbs_commission_low !== undefined;

    // 关键数据2：包装重量
    const hasWeight = product.package_weight !== undefined;

    // 关键数据3：跟卖数据（数量或价格至少有一个不是 undefined）
    const hasCompetitor = product.competitor_count !== undefined ||
                          product.competitor_min_price !== undefined;

    return hasRFBS && hasWeight && hasCompetitor;
  }

  /**
   * 检查是否还有不完整的商品
   */
  private hasIncompleteProducts(map: Map<string, CollectingProduct>): boolean {
    return Array.from(map.values()).some(p => !p.isComplete);
  }

  /**
   * 智能合并：只更新目标对象中值为 undefined 的字段
   *
   * @param target 目标对象（会被修改）
   * @param source 源对象（提供新值）
   */
  private smartMerge(target: Partial<ProductData>, source: Partial<ProductData>): void {
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        const targetValue = target[key as keyof ProductData];
        const sourceValue = source[key as keyof ProductData];

        // 只有当目标字段是 undefined 且源字段有值时，才更新
        if (targetValue === undefined && sourceValue !== undefined) {
          (target as any)[key] = sourceValue;
        }
      }
    }
  }

  /**
   * 获取从 undefined 变为有值的字段列表
   *
   * @param before 更新前的数据
   * @param after 更新后的数据
   * @returns 新填充的字段名列表
   */
  private getNewlyFilledFields(before: Partial<ProductData>, after: Partial<ProductData>): string[] {
    const filled: string[] = [];

    for (const key in after) {
      if (after.hasOwnProperty(key)) {
        const beforeValue = before[key as keyof ProductData];
        const afterValue = after[key as keyof ProductData];

        // 字段从 undefined 变为有值（包括 "无数据"、0、空字符串等）
        if (beforeValue === undefined && afterValue !== undefined) {
          filled.push(key);
        }
      }
    }

    return filled;
  }

  /**
   * 等待上品帮数据注入（优化：等待新商品注入完成）
   *
   * @deprecated 已被 waitAndCollect 内部逻辑替代，保留此方法用于备用/调试
   */
  // @ts-ignore - 保留用于备用/调试
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async waitForShangpinbangData(maxAttempts: number): Promise<void> {
    const interval = 100;

    // 获取所有商品卡片（不管有没有标记）
    const allCardsSelector = '[data-widget="searchResultsV2"] > div, [data-widget="megaPaginator"] > div, .tile-root, div[class*="tile"]';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const allCards = Array.from(document.querySelectorAll<HTMLElement>(allCardsSelector))
        .filter(card => !!card.querySelector('a[href*="/product/"]')); // 有商品链接的卡片

      if (allCards.length === 0) {
        await this.sleep(interval);
        continue;
      }

      // 检查所有商品卡片中有多少已被注入数据
      const markedCount = allCards.filter(card => {
        const hasShangpinbang = card.getAttribute('data-ozon-bang') === 'true';
        const hasMaoziErp = !!card.querySelector('[data-mz-widget]');
        return hasShangpinbang || hasMaoziErp;
      }).length;

      const ratio = markedCount / allCards.length;

      if (window.EURAFLOW_DEBUG && attempt % 5 === 0) {
        console.log(`[DEBUG] 等待数据注入（尝试 ${attempt + 1}/${maxAttempts}）: ${markedCount}/${allCards.length} (${(ratio * 100).toFixed(0)}%)`);
      }

      // 如果80%以上的商品都已注入数据，认为可以开始采集
      if (ratio >= 0.8) {
        if (window.EURAFLOW_DEBUG) {
          console.log(`[DEBUG] 数据注入就绪: ${markedCount}/${allCards.length} 个商品已标记`);
        }
        return;
      }

      await this.sleep(interval);
    }

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG] 上品帮数据等待超时（${maxAttempts * interval}ms）`);
    }
  }

  /**
   * 获取所有商品卡片（不管有没有数据标记）
   * @returns 所有商品卡片数组
   */
  private getAllProductCards(): HTMLElement[] {
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

    // 只返回有商品链接的卡片
    return allCards.filter(card => !!card.querySelector('a[href*="/product/"]'));
  }

  /**
   * 边检测边采集（核心方法）
   * 每50ms检测一次，发现新注入数据的商品就立即采集
   * @param targetCount 目标采集数量
   * @returns 本轮新采集的商品数量
   */
  private async waitAndCollect(targetCount: number): Promise<number> {
    const maxRounds = 60;  // 60轮 × 50ms = 3秒
    const alreadyProcessed = new Set<string>(); // 已处理的SKU（包括跳过的）
    let newCollectedCount = 0;

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG waitAndCollect] 开始边检测边采集，目标=${targetCount}, 当前已采集=${this.collected.size}`);
    }

    for (let round = 0; round < maxRounds; round++) {
      if (!this.isRunning) break;

      // 检查是否达到目标
      if (this.collected.size >= targetCount) {
        if (window.EURAFLOW_DEBUG) {
          console.log(`[DEBUG waitAndCollect] 已达目标数量，结束`);
        }
        break;
      }

      // 1. 获取所有商品卡片
      const allCards = this.getAllProductCards();

      if (allCards.length === 0) {
        await this.sleep(50);
        continue;
      }

      // 2. 筛选出：有数据注入 + 未处理过 + 未达目标数的商品
      const newReadyCards: Array<{ card: HTMLElement; sku: string }> = [];

      for (const card of allCards) {
        const sku = this.quickExtractSKU(card);
        if (!sku) continue;

        // 已经处理过（成功或失败）
        if (alreadyProcessed.has(sku)) continue;

        // 已采集或已上传
        if (this.collected.has(sku) || this.uploadedFingerprints.has(sku)) {
          alreadyProcessed.add(sku);
          continue;
        }

        // 检查是否有数据工具标记（已注入数据）
        const hasShangpinbang = card.getAttribute('data-ozon-bang') === 'true';
        const hasMaoziErp = !!card.querySelector('[data-mz-widget]');

        if (hasShangpinbang || hasMaoziErp) {
          newReadyCards.push({ card, sku });
        }
      }

      // 3. 立即采集这些新就绪的商品
      for (const { card, sku } of newReadyCards) {
        if (!this.isRunning) break;
        if (this.collected.size >= targetCount) break;

        alreadyProcessed.add(sku);

        if (window.EURAFLOW_DEBUG) {
          console.log(`[DEBUG waitAndCollect] 第${round}轮 发现新商品 ${sku}，开始采集...`);
        }

        // 采集单个商品（包括轮询增强）
        const product = await this.collectSingleProduct(card, sku);

        if (product) {
          this.collected.set(sku, product);
          newCollectedCount++;

          // 更新进度
          this.progress.collected = this.collected.size;
          this.onProgressCallback?.(this.progress);

          if (window.EURAFLOW_DEBUG) {
            console.log(`[DEBUG waitAndCollect] ✓ 采集成功 ${sku} (${this.collected.size}/${targetCount})`);
          }
        } else {
          if (window.EURAFLOW_DEBUG) {
            console.warn(`[DEBUG waitAndCollect] ✗ 采集失败 ${sku}`);
          }
        }
      }

      // 4. 检查是否所有商品都已处理
      if (alreadyProcessed.size >= allCards.length) {
        if (window.EURAFLOW_DEBUG) {
          console.log(`[DEBUG waitAndCollect] 所有商品已处理完毕 (${alreadyProcessed.size}/${allCards.length})`);
        }
        break;
      }

      // 5. 等待 50ms 进行下一轮检测
      await this.sleep(50);

      // DEBUG：每5轮输出一次进度
      if (window.EURAFLOW_DEBUG && round % 5 === 0 && round > 0) {
        const ratio = alreadyProcessed.size / allCards.length;
        console.log(`[DEBUG waitAndCollect] 第${round}轮 已处理=${alreadyProcessed.size}/${allCards.length} (${(ratio * 100).toFixed(0)}%), 新采集=${newCollectedCount}`);
      }
    }

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG waitAndCollect] 完成，本轮新采集 ${newCollectedCount} 个商品`);
    }

    return newCollectedCount;
  }

  /**
   * 采集单个商品（包括轮询增强）
   * @param card 商品卡片元素
   * @param sku 商品SKU
   * @returns 商品数据或null
   */
  private async collectSingleProduct(card: HTMLElement, sku: string): Promise<ProductData | null> {
    try {
      // 1. 给卡片添加 data-sku 属性，方便后续定位
      card.setAttribute('data-sku', sku);

      // 2. 快速提取数据
      const product = await this.fusionEngine.fuseProductDataImmediate(card);

      if (!product.product_id) {
        return null;
      }

      if (window.EURAFLOW_DEBUG) {
        const weightDisplay = product.package_weight === undefined
          ? 'undefined(未加载)'
          : (product.package_weight === 0 ? '0(无数据)' : `${product.package_weight}g`);

        console.log(`[DEBUG 即时采集] ${sku}`, {
          完整: this.isProductComplete(product),
          'rFBS(高/中/低)': `${product.rfbs_commission_high}/${product.rfbs_commission_mid}/${product.rfbs_commission_low}`,
          重量: weightDisplay,
          跟卖: product.competitor_count
        });
      }

      // 3. 如果数据不完整，轮询增强（最多2秒）
      const maxRounds = 40;  // 40轮 × 50ms = 2秒
      let round = 0;

      while (!this.isProductComplete(product) && round < maxRounds && this.isRunning) {
        await this.sleep(50);
        round++;

        // 通过 data-sku 属性定位卡片
        const cardNow = document.querySelector(`[data-sku="${sku}"]`) as HTMLElement;
        if (!cardNow) {
          if (window.EURAFLOW_DEBUG) {
            console.warn(`[DEBUG 轮询增强] SKU=${sku} 卡片已移除`);
          }
          break;
        }

        // 重新提取数据
        const updated = await this.fusionEngine.fuseProductDataImmediate(cardNow);
        const beforeData = { ...product };
        this.smartMerge(product, updated);

        // DEBUG：仅在有新字段被填充时打印
        if (window.EURAFLOW_DEBUG) {
          const newlyFilledFields = this.getNewlyFilledFields(beforeData, product);
          if (newlyFilledFields.length > 0) {
            console.log(`[DEBUG 轮询增强] SKU=${sku} 第${round}轮 新填充:`, newlyFilledFields);
          }
        }

        // 数据完整，结束轮询
        if (this.isProductComplete(product)) {
          if (window.EURAFLOW_DEBUG) {
            console.log(`[DEBUG 轮询增强] SKU=${sku} 数据完整 (第${round}轮)`);
          }
          break;
        }
      }

      return product;
    } catch (error: any) {
      if (window.EURAFLOW_DEBUG) {
        console.error(`[DEBUG 采集失败] SKU=${sku}:`, error.message);
      }
      return null;
    }
  }

  /**
   * 快速提取商品卡片的 SKU（用于去重判断）
   * @param card 商品卡片元素
   * @returns SKU 或 undefined
   */
  private quickExtractSKU(card: HTMLElement): string | undefined {
    const link = card.querySelector<HTMLAnchorElement>('a[href*="/product/"]');
    if (!link || !link.href) {
      return undefined;
    }

    // 从URL末尾提取SKU（格式：/product/name-SKU/或/product/name-SKU?params）
    const urlParts = link.href.split('/product/');
    if (urlParts.length <= 1) {
      return undefined;
    }

    // 提取路径部分，去除查询参数
    const pathPart = urlParts[1].split('?')[0].replace(/\/$/, '');

    // 提取最后的数字SKU（通常在最后一个连字符后）
    const lastDashIndex = pathPart.lastIndexOf('-');
    if (lastDashIndex === -1) {
      return undefined;
    }

    const potentialSKU = pathPart.substring(lastDashIndex + 1);

    // 验证是否为纯数字且长度合理（通常6位以上）
    if (/^\d{6,}$/.test(potentialSKU)) {
      return potentialSKU;
    }

    return undefined;
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
