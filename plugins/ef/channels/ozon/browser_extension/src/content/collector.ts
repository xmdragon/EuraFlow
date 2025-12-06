import { DataFusionEngine } from './fusion/engine';
import { spbangApiProxy } from '../shared/api';
import { FilterEngine } from './filter';
import { getRateLimitConfig } from '../shared/storage';
import type { ProductData, CollectionProgress, RateLimitConfig } from '../shared/types';
import type { ProductBasicInfo } from '../shared/api/ozon-buyer-api';

// 标记页面注入脚本是否已加载
let pageScriptInjected = false;

/**
 * 确保页面注入脚本已加载
 */
function ensurePageScriptLoaded(): Promise<void> {
  return new Promise((resolve) => {
    if (pageScriptInjected || (window as any).__EURAFLOW_PAGE_SCRIPT_LOADED__) {
      pageScriptInjected = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('assets/page-injected.js');
    script.onload = () => {
      pageScriptInjected = true;
      resolve();
    };
    script.onerror = () => {
      console.error('[EuraFlow] 页面注入脚本加载失败');
      resolve();  // 即使失败也继续
    };
    document.head.appendChild(script);
  });
}

/**
 * 在页面上下文中执行商品列表 API 请求
 * 【关键】通过外部脚本注入到页面中执行，绕过 CSP 和反爬虫检测
 */
async function fetchProductsPageDirect(pageUrl: string, page: number): Promise<ProductBasicInfo[]> {
  // 确保页面脚本已加载
  await ensurePageScriptLoaded();

  return new Promise((resolve) => {
    const requestId = `products_page_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const encodedUrl = encodeURIComponent(pageUrl);
    const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}&page=${page}`;
    let resolved = false;  // 防止重复 resolve

    if (__DEBUG__) {
      console.log(`[API] fetchProductsPageDirect 请求:`, { url: apiUrl, pageUrl, page });
    }

    // 监听页面返回的结果
    const handleResponse = (event: CustomEvent) => {
      if (event.detail?.requestId === requestId && !resolved) {
        resolved = true;
        window.removeEventListener('euraflow_page_response', handleResponse as EventListener);

        if (event.detail.success) {
          const products = parseProductsResponse(event.detail.data);
          if (__DEBUG__) {
            console.log(`[API] fetchProductsPageDirect 返回:`, { page, count: products.length });
          }
          resolve(products);
        } else {
          console.error(`[API] fetchProductsPageDirect 失败:`, event.detail.error);
          resolve([]);
        }
      }
    };

    window.addEventListener('euraflow_page_response', handleResponse as EventListener);

    // 超时处理（15秒）
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        window.removeEventListener('euraflow_page_response', handleResponse as EventListener);
        console.error('[API] fetchProductsPageDirect 超时');
        resolve([]);
      }
    }, 15000);

    // 发送请求到页面上下文
    window.dispatchEvent(new CustomEvent('euraflow_page_request', {
      detail: { requestId, type: 'fetch', url: apiUrl }
    }));
  });
}

/**
 * 解析商品列表响应
 */
function parseProductsResponse(result: any): ProductBasicInfo[] {
  const widgetStates = result.widgetStates || {};

  // 查找包含商品列表的 widget
  const productListKey = Object.keys(widgetStates).find(key =>
    key.includes('tileGridDesktop') || key.includes('searchResultsV2')
  );

  if (!productListKey) {
    return [];
  }

  // 解析 widget 数据
  let widgetData: any;
  try {
    widgetData = typeof widgetStates[productListKey] === 'string'
      ? JSON.parse(widgetStates[productListKey])
      : widgetStates[productListKey];
  } catch {
    return [];
  }

  const items = widgetData.items || widgetData.products || [];
  if (items.length === 0) {
    return [];
  }

  // 转换为标准格式
  return items.map((item: any) => parseProductItem(item))
    .filter((p: ProductBasicInfo) => p.sku);
}

/**
 * 解析单个商品项
 */
function parseProductItem(item: any): ProductBasicInfo {
  // 提取 SKU
  let sku = String(item.sku || item.id || '');
  if (!sku && item.action?.link) {
    const skuMatch = item.action.link.match(/-(\d{6,})(?:\/|\?|$)/);
    if (skuMatch) {
      sku = skuMatch[1];
    }
  }

  // 提取价格
  let price: number | null = null;
  let originalPrice: number | null = null;

  // 1. priceV2 格式（新版）
  if (item.priceV2) {
    const priceText = item.priceV2.price?.[0]?.text || item.priceV2.price || '';
    price = parseOzonPrice(priceText);
    const originalText = item.priceV2.originalPrice?.[0]?.text || item.priceV2.originalPrice || '';
    originalPrice = parseOzonPrice(originalText);
  }

  // 2. mainState 中的价格
  if (price === null && item.mainState) {
    for (const state of item.mainState) {
      if (state.type === 'priceV2' && state.priceV2?.price) {
        const priceItems = state.priceV2.price;
        if (Array.isArray(priceItems)) {
          const priceItem = priceItems.find((p: any) => p.textStyle === 'PRICE');
          if (priceItem?.text) {
            price = parseOzonPrice(priceItem.text);
          }
          const originalItem = priceItems.find((p: any) => p.textStyle === 'ORIGINAL_PRICE');
          if (originalItem?.text) {
            originalPrice = parseOzonPrice(originalItem.text);
          }
        }
        break;
      }
      if (state.price) {
        price = parseOzonPrice(state.price);
        break;
      }
      if (state.atom?.price) {
        price = parseOzonPrice(state.atom.price);
        break;
      }
    }
  }

  // 3. 直接 price 字段
  if (price === null && item.price) {
    price = typeof item.price === 'number' ? item.price : parseOzonPrice(item.price);
  }

  // 4. atom.price 格式
  if (price === null && item.atom?.price) {
    price = parseOzonPrice(item.atom.price);
  }

  // 5. cardPrice 格式
  if (price === null && item.cardPrice) {
    price = parseOzonPrice(item.cardPrice);
  }

  // 提取评分
  let rating: number | null = null;
  let reviewCount: number | null = null;

  if (item.rating) {
    rating = typeof item.rating === 'number' ? item.rating : parseFloat(item.rating);
  }
  if (item.reviewCount || item.reviews) {
    const countStr = String(item.reviewCount || item.reviews || '');
    reviewCount = parseInt(countStr.replace(/\D/g, ''), 10) || null;
  }

  // 提取标题（多种格式兼容）
  let title = item.title || item.name || '';
  if (!title && item.mainState) {
    for (const state of item.mainState) {
      // 1. textAtom 类型且 id="name"（最常见格式）
      if (state.type === 'textAtom' && state.id === 'name' && state.textAtom?.text) {
        title = state.textAtom.text;
        break;
      }
      // 2. textAtom 类型（无 id）
      if (state.type === 'textAtom' && state.textAtom?.text && !title) {
        title = state.textAtom.text;
        // 不 break，继续找更精确的匹配
      }
      // 3. textSmall 类型
      if (state.type === 'textSmall' && state.text) {
        title = state.text;
        break;
      }
      // 4. atom.textAtom 格式
      if (state.atom?.textAtom?.text) {
        title = state.atom.textAtom.text;
        break;
      }
      // 5. title 类型
      if (state.type === 'title' && state.title) {
        title = state.title;
        break;
      }
    }
  }
  // tileState 中的标题
  if (!title && item.tileState?.title) {
    title = item.tileState.title;
  }

  // 提取图片（多种格式兼容）
  let imageUrl = item.image || item.mainImage || item.images?.[0] || null;
  // 1. tileImage.items 格式（最常见）
  if (!imageUrl && item.tileImage?.items?.length > 0) {
    const firstImage = item.tileImage.items[0];
    if (firstImage?.type === 'image' && firstImage?.image?.link) {
      imageUrl = firstImage.image.link;
    }
  }
  // 2. mainState 中的图片
  if (!imageUrl && item.mainState) {
    for (const state of item.mainState) {
      if (state.type === 'image' && state.image) {
        imageUrl = state.image;
        break;
      }
      if (state.atom?.image) {
        imageUrl = state.atom.image;
        break;
      }
    }
  }
  // 3. tileState 中的图片
  if (!imageUrl && item.tileState?.image) {
    imageUrl = item.tileState.image;
  }

  return {
    sku,
    link: item.action?.link || item.link || '',
    title,
    price,
    originalPrice,
    rating,
    reviewCount,
    imageUrl
  };
}

/**
 * 解析 OZON 价格字符串
 */
function parseOzonPrice(priceStr: string): number | null {
  if (!priceStr || typeof priceStr !== 'string') {
    return null;
  }

  // 移除货币符号和空格
  let cleaned = priceStr.replace(/[₽¥$€\s]/g, '');

  // 处理欧洲格式：移除千位分隔符（空格），将逗号替换为点
  cleaned = cleaned.replace(/\s/g, '').replace(',', '.');

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * 从 URL 提取路径部分
 */
function extractPagePath(fullUrl: string): string {
  try {
    const url = new URL(fullUrl);
    return url.pathname;
  } catch {
    const match = fullUrl.match(/ozon\.ru(\/[^?#]*)/);
    return match ? match[1] : '/';
  }
}

interface CollectingProduct {
  data: ProductData;
  isComplete: boolean;
  checkCount: number;
}

export class ProductCollector {
  public isRunning = false;
  private collected = new Map<string, ProductData>();
  private uploadedFingerprints = new Set<string>();
  private progress: CollectionProgress = {
    collected: 0,
    target: 0,
    isRunning: false,
    errors: []
  };

  private onProgressCallback?: (progress: CollectionProgress) => void;

  // 过滤相关
  private filterEngine?: FilterEngine;
  private scanCount = 0;          // 已扫描总数（DOM采集）
  private filteredOutCount = 0;   // 被过滤掉的数量

  // 频率限制配置
  private rateLimitConfig?: RateLimitConfig;

  constructor(private fusionEngine: DataFusionEngine) {}

  /**
   * 设置过滤引擎
   */
  setFilterEngine(engine: FilterEngine): void {
    this.filterEngine = engine;
  }

  /**
   * 获取过滤引擎
   */
  getFilterEngine(): FilterEngine | undefined {
    return this.filterEngine;
  }

  /**
   * 获取过滤统计
   */
  getFilterStats(): { scanned: number; filteredOut: number; passed: number } {
    return {
      scanned: this.scanCount,
      filteredOut: this.filteredOutCount,
      passed: this.collected.size
    };
  }

  async startCollection(
    targetCount: number,
    onProgress?: (progress: CollectionProgress) => void
  ): Promise<ProductData[]> {
    if (this.isRunning) {
      throw new Error('采集已在运行中');
    }

    this.onProgressCallback = onProgress;
    this.isRunning = true;
    this.collected.clear();

    // 重置过滤统计
    this.scanCount = 0;
    this.filteredOutCount = 0;

    this.progress = {
      collected: 0,
      target: targetCount,
      isRunning: true,
      errors: [],
      scanned: 0,
      filteredOut: 0
    };

    // 加载频率限制配置
    this.rateLimitConfig = await getRateLimitConfig();
    if (__DEBUG__) {
      console.log('[采集] 频率限制配置:', this.rateLimitConfig);
    }

    // 刷新 seller.ozon.ru 标签页（确保 session 有效，避免 "商品不存在" 错误）
    this.progress.status = '刷新卖家后台...';
    onProgress?.(this.progress);
    try {
      const refreshResult = await chrome.runtime.sendMessage({ type: 'REFRESH_SELLER_TAB' });
      if (__DEBUG__) {
        console.log('[采集] Seller 标签页刷新结果:', refreshResult);
      }
    } catch (e) {
      if (__DEBUG__) {
        console.warn('[采集] Seller 标签页刷新失败:', e);
      }
    }

    try {
      // 使用 API 分页采集（替代滚动检测）
      return await this.startCollectionWithApi(targetCount, onProgress);
    } finally {
      this.isRunning = false;
      this.progress.isRunning = false;
      onProgress?.(this.progress);
    }
  }

  /**
   * 使用 API 分页进行采集（主动获取商品数据，不依赖滚动）
   */
  private async startCollectionWithApi(
    targetCount: number,
    onProgress?: (progress: CollectionProgress) => void
  ): Promise<ProductData[]> {
    const passedProducts: ProductData[] = [];
    const processedSKUs = new Set<string>();

    // 提取当前页面路径
    const pageUrl = extractPagePath(window.location.href);

    if (__DEBUG__) {
      console.log(`[API采集] 开始采集，页面路径: ${pageUrl}，目标: ${targetCount}`);
    }

    let page = 1;
    let consecutiveEmptyPages = 0;
    const maxPages = 100;  // 最大页数限制

    while (this.isRunning && passedProducts.length < targetCount && page <= maxPages) {
      const pageStartTime = Date.now();

      // 1. 获取当前页的商品列表（直接请求，不经过 Service Worker）
      this.progress.status = `获取第 ${page} 页商品列表...`;
      onProgress?.(this.progress);

      const pageProducts = await fetchProductsPageDirect(pageUrl, page);
      const pageEndTime = Date.now();

      if (__DEBUG__) {
        console.log(`[API采集] 第 ${page} 页获取 ${pageProducts.length} 个商品 (耗时 ${pageEndTime - pageStartTime}ms)`);
      }

      // 2. 检查是否到底
      if (pageProducts.length === 0) {
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= 2) {
          if (__DEBUG__) {
            console.log(`[API采集] 连续 2 个空页，采集结束`);
          }
          break;
        }
        page++;
        continue;
      } else {
        consecutiveEmptyPages = 0;
      }

      // 3. 转换为 ProductData 格式并添加到 collected
      const newProducts: ProductData[] = [];
      let duplicateCount = 0;
      let priceFilteredCount = 0;

      for (const apiProduct of pageProducts) {
        // 跳过已处理的商品
        if (processedSKUs.has(apiProduct.sku)) {
          duplicateCount++;
          continue;
        }
        processedSKUs.add(apiProduct.sku);
        this.scanCount++;

        // 转换为 ProductData 格式
        const product: ProductData = {
          product_id: apiProduct.sku,
          product_name_ru: apiProduct.title,
          ozon_link: apiProduct.link ? `https://www.ozon.ru${apiProduct.link}` : '',
          current_price: apiProduct.price ?? undefined,
          original_price: apiProduct.originalPrice ?? undefined,
          rating: apiProduct.rating ?? undefined,
          review_count: apiProduct.reviewCount ?? undefined,
          image_url: apiProduct.imageUrl ?? undefined,
        };

        // 4. 阶段1过滤：价格过滤（API 数据已包含价格）
        if (this.filterEngine?.needsPriceFilter()) {
          const priceResult = this.filterEngine.filterByPrice(product);
          if (!priceResult.passed) {
            this.filteredOutCount++;
            priceFilteredCount++;
            if (__DEBUG__) {
              console.log(`[过滤-价格] SKU=${apiProduct.sku} 失败: ${priceResult.failedReason}`);
            }
            continue;
          }
        }

        // 通过价格过滤，加入待处理列表
        newProducts.push(product);
        this.collected.set(apiProduct.sku, product);
      }

      // 输出过滤统计
      if (__DEBUG__) {
        if (duplicateCount > 0) {
          console.log(`[过滤-重复] 重复SKU，过滤 ${duplicateCount} 个`);
        }
        if (priceFilteredCount > 0) {
          console.log(`[过滤-价格] 价格不符合条件，过滤 ${priceFilteredCount} 个`);
        }
      }

      // 更新进度
      this.progress.scanned = this.scanCount;
      this.progress.filteredOut = this.filteredOutCount;
      onProgress?.(this.progress);

      // 5. 批量处理新商品（上品帮数据 + 跟卖数据 + 过滤）
      if (newProducts.length > 0) {
        await this.processNewProductsFromApi(newProducts, passedProducts, targetCount, onProgress);

        // 检查是否已达目标
        if (passedProducts.length >= targetCount) {
          if (__DEBUG__) {
            console.log(`[API采集] 已有 ${passedProducts.length} 个商品通过过滤，达到目标 ${targetCount}，停止采集`);
          }
          break;
        }
      }

      page++;

      // 页间延迟（使用频率限制配置）
      const delay = this.getConfiguredDelay();
      await this.sleep(delay);
    }

    this.progress.status = `采集完成 (扫描:${this.scanCount} 过滤:${this.filteredOutCount} 通过:${passedProducts.length})`;
    this.progress.collected = passedProducts.length;
    onProgress?.(this.progress);

    return passedProducts.slice(0, targetCount);
  }

  /**
   * 处理从 API 获取的新商品（上品帮数据 + 跟卖数据 + 过滤）
   */
  private async processNewProductsFromApi(
    newProducts: ProductData[],
    passedProducts: ProductData[],
    targetCount: number,
    onProgress?: (progress: CollectionProgress) => void
  ): Promise<void> {
    if (newProducts.length === 0) {
      return;
    }

    try {
      // 2.1 获取销售数据（上品帮批量API）
      this.progress.status = `获取销售数据 (${newProducts.length}个)...`;
      onProgress?.(this.progress);
      await this.getSalesDataForBatch(newProducts);

      // 2.2 补充缺失的包装尺寸（OZON Seller API）
      this.progress.status = `补充包装尺寸...`;
      onProgress?.(this.progress);
      await this.fillMissingDimensionsForBatch(newProducts);

      // 2.3 佣金数据已在 getSalesDataForBatch 中获取，无需额外请求

      // 【阶段2过滤】应用上品帮数据过滤（月销量、重量、上架时间、发货模式）
      const spbPassedBatch: ProductData[] = [];
      if (this.filterEngine?.needsSpbFilter()) {
        if (__DEBUG__) {
          console.log(`[过滤-SPB] 开始过滤 ${newProducts.length} 个商品`);
        }
        for (const product of newProducts) {
          const result = this.filterEngine.filterBySpbData(product);
          if (!result.passed) {
            this.filteredOutCount++;
            this.collected.delete(product.product_id);
            if (__DEBUG__) {
              console.log(`[过滤-SPB] SKU=${product.product_id} 失败: ${result.failedReason}`);
            }
          } else {
            spbPassedBatch.push(product);
            if (__DEBUG__) {
              console.log(`[过滤-SPB] SKU=${product.product_id} 通过`, {
                listing_date: product.listing_date,
                monthly_sales: product.monthly_sales_volume,
                weight: product.weight
              });
            }
          }
        }
        if (__DEBUG__) {
          console.log(`[过滤-SPB] 完成: ${spbPassedBatch.length}/${newProducts.length} 通过`);
        }
      } else {
        spbPassedBatch.push(...newProducts);
        if (__DEBUG__) {
          console.log(`[过滤-SPB] 无SPB过滤条件，${newProducts.length}个商品直接通过`);
        }
      }

      // 只对通过上品帮过滤的商品获取跟卖数据
      if (spbPassedBatch.length > 0) {
        // 2.4 获取跟卖数据（OZON批量API）
        this.progress.status = `获取跟卖数据 (${spbPassedBatch.length}个)...`;
        onProgress?.(this.progress);
        await this.getFollowSellerDataForBatch(spbPassedBatch);

        // 【阶段3过滤】应用跟卖数据过滤
        if (this.filterEngine?.needsFollowSellerFilter()) {
          for (const product of spbPassedBatch) {
            const result = this.filterEngine.filterByFollowSeller(product);
            if (!result.passed) {
              this.filteredOutCount++;
              this.collected.delete(product.product_id);
              if (__DEBUG__) {
                console.log(`[过滤-跟卖] SKU=${product.product_id} 失败: ${result.failedReason}`);
              }
            } else {
              passedProducts.push(product);
              if (__DEBUG__) {
                console.log(`[过滤-跟卖] SKU=${product.product_id} 通过: 跟卖数=${product.competitor_count}`);
              }
            }
          }
        } else {
          passedProducts.push(...spbPassedBatch);
          if (__DEBUG__) {
            console.log(`[过滤-跟卖] 无跟卖过滤条件，${spbPassedBatch.length}个商品直接通过`);
          }
        }
      }

      // 更新进度（显示过滤后的数量）
      this.progress.collected = passedProducts.length;
      this.progress.scanned = this.scanCount;
      this.progress.filteredOut = this.filteredOutCount;
      this.progress.status = `扫描:${this.scanCount} | 通过:${passedProducts.length}/${targetCount}`;
      onProgress?.(this.progress);

    } catch (error: any) {
      // 检查是否是验证码错误
      if (error.message?.startsWith('CAPTCHA_PENDING')) {
        console.error('[EuraFlow] 触发反爬虫拦截，采集已暂停');
        this.progress.status = '⚠️ 需要完成人机验证';
        this.progress.errors.push(error.message);
        this.isRunning = false;
        onProgress?.(this.progress);
      } else {
        console.error('[EuraFlow] 批量处理失败:', error);
        throw error;
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

    if (__DEBUG__) {
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
          if (__DEBUG__) {
            console.log(`[DEBUG 阶段1] 第 ${i + 1} 个卡片无法提取SKU，跳过`);
          }
          continue;
        }

        // 跳过已采集或已上传的商品（基于 SKU 指纹）
        if (this.collected.has(sku) || this.uploadedFingerprints.has(sku)) {
          if (__DEBUG__) {
            console.log(`[DEBUG 阶段1] 跳过已采集商品: ${sku}`);
          }
          continue;
        }

        if (targetCount && (tempMap.size + this.collected.size) >= targetCount) {
          if (__DEBUG__) {
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

          if (__DEBUG__) {
            // 【增强】更清晰地显示重量值（区分undefined、0和数字）
            const weightDisplay = product.weight === undefined
              ? 'undefined(未加载)'
              : (product.weight === 0 ? '0(无数据)' : `${product.weight}g`);

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
        if (__DEBUG__) {
          console.log(`[DEBUG 阶段1] 第 ${i + 1} 个卡片采集失败:`, error.message);
        }
      }
    }

    // 更新进度
    this.progress.collected = tempMap.size;
    const completeCount = Array.from(tempMap.values()).filter(p => p.isComplete).length;
    this.progress.status = `快速采集完成: ${completeCount}/${tempMap.size} 完整`;
    this.onProgressCallback?.(this.progress);

    if (__DEBUG__) {
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
          if (__DEBUG__) {
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
          if (__DEBUG__) {
            const newlyFilledFields = this.getNewlyFilledFields(beforeData, item.data);
            if (newlyFilledFields.length > 0) {
              console.log(`[DEBUG 阶段2] SKU=${sku} 新填充字段:`, newlyFilledFields);
            }
          }

          // 数据从不完整变为完整
          if (!wasComplete && item.isComplete) {
            enhancedCount++;
            if (__DEBUG__) {
              console.log(`[DEBUG 阶段2] 数据完整 (第${round}轮): ${sku}`, {
                'rFBS(高/中/低)': `${item.data.rfbs_commission_high}/${item.data.rfbs_commission_mid}/${item.data.rfbs_commission_low}`,
                重量: item.data.weight,
                跟卖: item.data.competitor_count
              });
            }
          }
        } catch (error: any) {
          // 轮询增强失败不影响已有数据
          if (__DEBUG__) {
            console.warn(`[DEBUG 阶段2] SKU ${sku} 增强失败:`, error.message);
          }
        }
      }

      // 更新进度
      const newCompleteCount = Array.from(tempMap.values()).filter(p => p.isComplete).length;
      this.progress.status = `增强中 (第${round}轮)... ${newCompleteCount}/${tempMap.size} 完整`;
      this.onProgressCallback?.(this.progress);

      if (__DEBUG__ && enhancedCount > 0) {
        console.log(`[DEBUG 阶段2] 第${round}轮：${enhancedCount} 个商品数据完整`);
      }
    }

    // 轮询结束统计
    const finalCompleteCount = Array.from(tempMap.values()).filter(p => p.isComplete).length;
    const incompleteCount = tempMap.size - finalCompleteCount;

    if (__DEBUG__) {
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

        if (__DEBUG__) {
          const weightDisplay = item.data.weight !== undefined
            ? (item.data.weight === 0 ? '无数据' : item.data.weight)
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
    const hasWeight = product.weight !== undefined;

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
        return hasShangpinbang;
      }).length;

      const ratio = markedCount / allCards.length;

      if (__DEBUG__ && attempt % 5 === 0) {
        console.log(`[DEBUG] 等待数据注入（尝试 ${attempt + 1}/${maxAttempts}）: ${markedCount}/${allCards.length} (${(ratio * 100).toFixed(0)}%)`);
      }

      // 如果80%以上的商品都已注入数据，认为可以开始采集
      if (ratio >= 0.8) {
        if (__DEBUG__) {
          console.log(`[DEBUG] 数据注入就绪: ${markedCount}/${allCards.length} 个商品已标记`);
        }
        return;
      }

      await this.sleep(interval);
    }

    if (__DEBUG__) {
      console.log(`[DEBUG] 上品帮数据等待超时（${maxAttempts * interval}ms）`);
    }
  }

  /**
   * 获取所有商品卡片（不管有没有数据标记）
   * @returns 所有商品卡片数组
   */
  private getAllProductCards(): HTMLElement[] {
    const selectors = [
      '#contentScrollPaginator div[class*="tile"]',      // 主容器中所有tile（后代选择器）
      '[data-widget="searchResultsV2"] div[class*="tile"]',
      '[data-widget="megaPaginator"] div[class*="tile"]',
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
   * 边检测边采集（Legacy - 已被 API 分页替代）
   * 每100ms检测一次，发现新商品就立即采集
   * @param targetCount 目标采集数量
   * @returns 本轮新采集的商品数量
   * @deprecated 使用 startCollectionWithApi 替代
   */
  // @ts-expect-error - Legacy method, kept for reference
  private async _waitAndCollect(targetCount: number): Promise<number> {
    const maxRounds = 50;  // 50轮 × 100ms = 5秒
    const noNewCardThreshold = 10;  // 连续10轮没有新商品卡片就退出（1秒）
    const alreadyProcessed = new Set<string>(); // 已处理的SKU（包括跳过的）
    let newCollectedCount = 0;
    let lastCardCount = 0;
    let previousCardCount = 0;
    let noNewCardRounds = 0;

    for (let round = 0; round < maxRounds; round++) {
      if (!this.isRunning) break;

      if (this.collected.size >= targetCount) {
        break;
      }

      // 1. 获取所有商品卡片
      const allCards = this.getAllProductCards();
      lastCardCount = allCards.length;

      // 检查页面是否加载了新的商品卡片
      if (allCards.length <= previousCardCount && round > 0) {
        noNewCardRounds++;
        if (noNewCardRounds >= noNewCardThreshold) {
          if (__DEBUG__) {
            console.log(`[waitAndCollect] 连续${noNewCardThreshold}轮无新卡片，退出 (页面${lastCardCount}个)`);
          }
          break;
        }
      } else {
        noNewCardRounds = 0;
      }
      previousCardCount = allCards.length;

      if (allCards.length === 0) {
        await this.sleep(100);
        continue;
      }

      // 2. 第一轮：严格按DOM顺序采集；后续轮：按数据就绪速度采集
      if (round === 0) {
        // 【第一轮】按DOM顺序逐个检查和采集
        for (const card of allCards) {
          if (!this.isRunning) break;
          if (this.collected.size >= targetCount) break;

          const sku = this.quickExtractSKU(card);
          if (!sku) continue;

          // 已处理过的跳过
          if (alreadyProcessed.has(sku)) continue;
          if (this.collected.has(sku) || this.uploadedFingerprints.has(sku)) {
            alreadyProcessed.add(sku);
            continue;
          }

          // 立即采集OZON原生数据（不等待上品帮标记）
          alreadyProcessed.add(sku);

          // 采集单个商品（仅OZON原生数据）
          const product = await this.collectSingleProduct(card, sku);

          if (product) {
            // 更新扫描计数
            this.scanCount++;

            // 【阶段1过滤】价格过滤（DOM数据）
            if (this.filterEngine?.needsPriceFilter()) {
              const priceResult = this.filterEngine.filterByPrice(product);
              if (!priceResult.passed) {
                this.filteredOutCount++;
                if (__DEBUG__) {
                  console.log(`[过滤-价格] SKU=${sku} 失败: ${priceResult.failedReason}`);
                }
                // 不加入 collected，继续下一个
                continue;
              }
            }

            this.collected.set(sku, product);
            newCollectedCount++;

            // if (__DEBUG__) {
            //   console.log(`[DEBUG waitAndCollect] ✓ 采集成功 ${sku} (${this.collected.size}/${targetCount})`);
            // }
          } else {
            if (__DEBUG__) {
              console.warn(`[DEBUG waitAndCollect] ✗ 采集失败 ${sku}`);
            }
          }
        }
      } else {
        // 【后续轮】按数据就绪速度采集（不按DOM顺序）
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

          // 立即采集（不等待上品帮标记）
          newReadyCards.push({ card, sku });
        }

        // 立即采集这些新商品
        for (const { card, sku } of newReadyCards) {
          if (!this.isRunning) break;
          if (this.collected.size >= targetCount) break;

          alreadyProcessed.add(sku);

          if (__DEBUG__) {
            console.log(`[DEBUG waitAndCollect] 第${round}轮 发现新商品 ${sku}，开始采集...`);
          }

          // 采集单个商品（仅OZON原生数据）
          const product = await this.collectSingleProduct(card, sku);

          if (product) {
            // 更新扫描计数
            this.scanCount++;

            // 【阶段1过滤】价格过滤（DOM数据）
            if (this.filterEngine?.needsPriceFilter()) {
              const priceResult = this.filterEngine.filterByPrice(product);
              if (!priceResult.passed) {
                this.filteredOutCount++;
                if (__DEBUG__) {
                  console.log(`[过滤-价格] SKU=${sku} 失败: ${priceResult.failedReason}`);
                }
                // 不加入 collected，继续下一个
                continue;
              }
            }

            this.collected.set(sku, product);
            newCollectedCount++;

            // if (__DEBUG__) {
            //   console.log(`[DEBUG waitAndCollect] ✓ 采集成功 ${sku} (${this.collected.size}/${targetCount})`);
            // }
          } else {
            if (__DEBUG__) {
              console.warn(`[DEBUG waitAndCollect] ✗ 采集失败 ${sku}`);
            }
          }
        }
      }

      // 4. 等待 100ms 进行下一轮检测
      await this.sleep(100);
    }

    if (__DEBUG__) {
      console.log(`[采集] 页面${lastCardCount}个 → 新采集${newCollectedCount}个 (累计${this.collected.size})`);
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

      // if (__DEBUG__) {
      //   console.log(`[DEBUG 采集OZON数据] ${sku}`, {
      //     标题: product.product_name_ru,
      //     当前价格: product.current_price,
      //     原价: product.original_price,
      //     评分: product.rating,
      //     评论数: product.review_count
      //   });
      // }

      return product;
    } catch (error: any) {
      if (__DEBUG__) {
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
   * 【重要】仅返回有数据工具标记的商品（上品帮）
   */
  private getVisibleProductCards(): HTMLElement[] {
    // 获取所有可能的商品卡片
    const selectors = [
      '#contentScrollPaginator div[class*="tile"]',      // 主容器中所有tile（后代选择器）
      '[data-widget="searchResultsV2"] div[class*="tile"]',
      '[data-widget="megaPaginator"] div[class*="tile"]',
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

      // 必须有上品帮标记
      return hasShangpinbang;
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
   * 根据频率限制配置获取延迟时间
   */
  private getConfiguredDelay(): number {
    if (!this.rateLimitConfig || !this.rateLimitConfig.enabled) {
      return 300; // 默认 300ms
    }

    if (this.rateLimitConfig.mode === 'fixed') {
      return this.rateLimitConfig.fixedDelay;
    } else {
      // 随机模式：在 min 和 max 之间随机
      const min = this.rateLimitConfig.randomDelayMin;
      const max = this.rateLimitConfig.randomDelayMax;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
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
   * 处理新采集的商品（Legacy - 已被 processNewProductsFromApi 替代）
   * 只处理尚未处理过的商品（不在 processedSKUs 中的）
   * @deprecated 使用 processNewProductsFromApi 替代
   */
  // @ts-expect-error - Legacy method, kept for reference
  private async _processNewProducts(
    passedProducts: ProductData[],
    processedSKUs: Set<string>,
    targetCount: number,
    onProgress?: (progress: CollectionProgress) => void
  ): Promise<void> {
    // 获取所有未处理的商品
    const unprocessedProducts: ProductData[] = [];
    for (const [sku, product] of this.collected) {
      if (!processedSKUs.has(sku)) {
        unprocessedProducts.push(product);
        processedSKUs.add(sku);
      }
    }

    if (unprocessedProducts.length === 0) {
      return;
    }

    try {
      // 2.1 获取销售数据（上品帮批量API）
      this.progress.status = `获取销售数据 (${unprocessedProducts.length}个)...`;
      onProgress?.(this.progress);
      await this.getSalesDataForBatch(unprocessedProducts);

      // 2.2 补充缺失的包装尺寸（OZON Seller API）
      this.progress.status = `补充包装尺寸...`;
      onProgress?.(this.progress);
      await this.fillMissingDimensionsForBatch(unprocessedProducts);

      // 2.3 佣金数据已在 getSalesDataForBatch 中获取，无需额外请求

      // 【阶段2过滤】应用上品帮数据过滤（月销量、重量、上架时间、发货模式）
      const spbPassedBatch: ProductData[] = [];
      if (this.filterEngine?.needsSpbFilter()) {
        if (__DEBUG__) {
          console.log(`[过滤-SPB] 开始过滤 ${unprocessedProducts.length} 个商品`);
        }
        for (const product of unprocessedProducts) {
          const result = this.filterEngine.filterBySpbData(product);
          if (!result.passed) {
            this.filteredOutCount++;
            this.collected.delete(product.product_id);
            if (__DEBUG__) {
              console.log(`[过滤-SPB] SKU=${product.product_id} 失败: ${result.failedReason}`);
            }
          } else {
            spbPassedBatch.push(product);
            if (__DEBUG__) {
              console.log(`[过滤-SPB] SKU=${product.product_id} 通过`, {
                listing_date: product.listing_date,
                monthly_sales: product.monthly_sales_volume,
                weight: product.weight
              });
            }
          }
        }
        if (__DEBUG__) {
          console.log(`[过滤-SPB] 完成: ${spbPassedBatch.length}/${unprocessedProducts.length} 通过`);
        }
      } else {
        spbPassedBatch.push(...unprocessedProducts);
        if (__DEBUG__) {
          console.log(`[过滤-SPB] 无SPB过滤条件，${unprocessedProducts.length}个商品直接通过`);
        }
      }

      // 只对通过上品帮过滤的商品获取跟卖数据
      if (spbPassedBatch.length > 0) {
        // 2.4 获取跟卖数据（OZON批量API）
        this.progress.status = `获取跟卖数据 (${spbPassedBatch.length}个)...`;
        onProgress?.(this.progress);
        await this.getFollowSellerDataForBatch(spbPassedBatch);

        // 【阶段3过滤】应用跟卖数据过滤
        if (this.filterEngine?.needsFollowSellerFilter()) {
          for (const product of spbPassedBatch) {
            const result = this.filterEngine.filterByFollowSeller(product);
            if (!result.passed) {
              this.filteredOutCount++;
              this.collected.delete(product.product_id);
              if (__DEBUG__) {
                console.log(`[过滤-跟卖] SKU=${product.product_id} 失败: ${result.failedReason}`);
              }
            } else {
              passedProducts.push(product);
              if (__DEBUG__) {
                console.log(`[过滤-跟卖] SKU=${product.product_id} 通过: 跟卖数=${product.competitor_count}`);
              }
            }
          }
        } else {
          passedProducts.push(...spbPassedBatch);
          if (__DEBUG__) {
            console.log(`[过滤-跟卖] 无跟卖过滤条件，${spbPassedBatch.length}个商品直接通过`);
          }
        }
      }

      // 更新进度（显示过滤后的数量）
      this.progress.collected = passedProducts.length;
      this.progress.scanned = this.scanCount;
      this.progress.filteredOut = this.filteredOutCount;
      this.progress.status = `扫描:${this.scanCount} | 通过:${passedProducts.length}/${targetCount}`;
      onProgress?.(this.progress);

    } catch (error: any) {
      // 检查是否是验证码错误
      if (error.message?.startsWith('CAPTCHA_PENDING')) {
        console.error('[EuraFlow] 触发反爬虫拦截，采集已暂停');
        this.progress.status = '⚠️ 需要完成人机验证';
        this.progress.errors.push(error.message);
        this.isRunning = false;
        onProgress?.(this.progress);
      } else {
        console.error('[EuraFlow] 批量处理失败:', error);
        throw error;
      }
    }
  }

  /**
   * 批量获取销售数据（上品帮批量API）
   */
  private async getSalesDataForBatch(batch: ProductData[]): Promise<void> {
    try {
      const skus = batch.map(p => p.product_id);
      const spbDataMap = await spbangApiProxy.getSalesDataInBatches(skus);

      // 合并数据（需要字段名映射：SpbSalesData camelCase → ProductData snake_case）
      let successCount = 0;
      batch.forEach((product) => {
        const spbData = spbDataMap.get(product.product_id);
        if (spbData) {
          // 字段名映射
          const mappedData: Partial<ProductData> = {
            // 销售数据
            monthly_sales_volume: spbData.monthlySales ?? undefined,
            monthly_sales_revenue: spbData.monthlySalesAmount ?? undefined,
            daily_sales_volume: spbData.dailySales ?? undefined,
            daily_sales_revenue: spbData.dailySalesAmount ?? undefined,
            sales_dynamic_percent: spbData.salesDynamic ?? undefined,
            conversion_rate: spbData.transactionRate ?? undefined,
            // 营销数据
            card_views: spbData.cardViews ?? undefined,
            card_add_to_cart_rate: spbData.cardAddToCartRate ?? undefined,
            search_views: spbData.searchViews ?? undefined,
            search_add_to_cart_rate: spbData.searchAddToCartRate ?? undefined,
            click_through_rate: spbData.clickThroughRate ?? undefined,
            promo_days: spbData.promoDays ?? undefined,
            promo_discount_percent: spbData.promoDiscount ?? undefined,
            promo_conversion_rate: spbData.promoConversion ?? undefined,
            paid_promo_days: spbData.paidPromoDays ?? undefined,
            ad_cost_share: spbData.adShare ?? undefined,
            return_cancel_rate: spbData.returnCancelRate ?? undefined,
            // 佣金数据（从销售数据 API 提取，避免重复调用佣金 API）
            rfbs_commission_low: spbData.rfbsCommissionLow ?? undefined,
            rfbs_commission_mid: spbData.rfbsCommissionMid ?? undefined,
            rfbs_commission_high: spbData.rfbsCommissionHigh ?? undefined,
            fbp_commission_low: spbData.fbpCommissionLow ?? undefined,
            fbp_commission_mid: spbData.fbpCommissionMid ?? undefined,
            fbp_commission_high: spbData.fbpCommissionHigh ?? undefined,
            // 商品信息
            avg_price: spbData.avgPrice ?? undefined,
            weight: spbData.weight ?? undefined,
            depth: spbData.depth ?? undefined,
            width: spbData.width ?? undefined,
            height: spbData.height ?? undefined,
            competitor_count: spbData.competitorCount ?? undefined,
            competitor_min_price: spbData.competitorMinPrice ?? undefined,
            listing_date: spbData.listingDate ? new Date(spbData.listingDate) : undefined,
            listing_days: spbData.listingDays ?? undefined,
            seller_mode: spbData.sellerMode ?? undefined,
            // 类目和品牌
            category_path: spbData.category ?? undefined,
            brand: spbData.brand ?? undefined,
            // 评分
            rating: spbData.rating ?? undefined,
            review_count: spbData.reviewCount ?? undefined,
          };

          // 提取类目层级
          if (spbData.category) {
            const parts = spbData.category.split(' > ');
            if (parts.length >= 1) mappedData.category_level_1 = parts[0];
            if (parts.length >= 2) mappedData.category_level_2 = parts[1];
          }

          Object.assign(product, mappedData);

          // 同步更新 this.collected 中的数据
          const collectedProduct = this.collected.get(product.product_id);
          if (collectedProduct) {
            Object.assign(collectedProduct, mappedData);
          }

          // 品牌标准化
          if (spbData.brand && !product.brand_normalized) {
            product.brand_normalized = spbData.brand.toUpperCase().replace(/\s+/g, '_');
          }

          // 补充图片（如果原来没有，且上品帮返回了 photo）
          if (!product.image_url && spbData.photo) {
            product.image_url = spbData.photo;
            if (collectedProduct) {
              collectedProduct.image_url = spbData.photo;
            }
          }

          successCount++;
        }
      });
    } catch (error: any) {
      console.error('[销售数据] 批量获取失败:', error.message);
    }
  }

  /**
   * 批量补充缺失的包装尺寸（OZON Seller API 降级方案）
   */
  private async fillMissingDimensionsForBatch(batch: ProductData[]): Promise<void> {
    const productsWithoutDimensions = batch.filter(p =>
      !p.weight || !p.depth || !p.width || !p.height
    );

    if (productsWithoutDimensions.length === 0) {
      return;
    }

    let successCount = 0;
    for (const product of productsWithoutDimensions) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_OZON_PRODUCT_DETAIL',
          data: {
            productSku: product.product_id,
            cookieString: document.cookie
          }
        });

        if (response.success && response.data?.dimensions) {
          const dim = response.data.dimensions;
          if (!product.weight && dim.weight) product.weight = parseFloat(dim.weight);
          if (!product.depth && dim.depth) product.depth = parseFloat(dim.depth);
          if (!product.width && dim.width) product.width = parseFloat(dim.width);
          if (!product.height && dim.height) product.height = parseFloat(dim.height);

          // 同步到 this.collected
          const collectedProduct = this.collected.get(product.product_id);
          if (collectedProduct) {
            if (!collectedProduct.weight && product.weight) collectedProduct.weight = product.weight;
            if (!collectedProduct.depth && product.depth) collectedProduct.depth = product.depth;
            if (!collectedProduct.width && product.width) collectedProduct.width = product.width;
            if (!collectedProduct.height && product.height) collectedProduct.height = product.height;
          }

          successCount++;
        }
      } catch (error: any) {
        console.warn(`[包装尺寸] SKU=${product.product_id} 失败:`, error.message);
      }
    }
  }

  /**
   * 批量获取跟卖数据（OZON买家端API）
   * 优化：只对缺失跟卖数据的商品调用 API（上品帮销售数据可能已包含跟卖信息）
   *
   * 【重要】通过页面上下文直接请求，避免 Service Worker 的 403 问题
   */
  private async getFollowSellerDataForBatch(batch: ProductData[]): Promise<void> {
    // 过滤出缺少跟卖数据的商品（competitor_count 为 null 或 undefined）
    const productsWithoutFollowSeller = batch.filter(p => p.competitor_count == null);

    if (productsWithoutFollowSeller.length === 0) {
      if (__DEBUG__) {
        console.log('[跟卖数据] 所有商品已有跟卖数据，跳过 OZON API 调用');
      }
      return;
    }

    if (__DEBUG__) {
      console.log(`[跟卖数据] ${productsWithoutFollowSeller.length}/${batch.length} 个商品缺少跟卖数据，调用 OZON API 补充`);
    }

    // 确保页面脚本已加载
    await ensurePageScriptLoaded();

    // 逐个获取跟卖数据（通过页面上下文直接请求）
    for (const product of productsWithoutFollowSeller) {
      try {
        const followSellerData = await this.fetchFollowSellerDataDirect(product.product_id);

        if (followSellerData) {
          Object.assign(product, followSellerData);

          // 同步更新 this.collected 中的数据
          const collectedProduct = this.collected.get(product.product_id);
          if (collectedProduct) {
            Object.assign(collectedProduct, followSellerData);
          }
        }
      } catch (error: any) {
        if (__DEBUG__) {
          console.warn(`[跟卖数据] SKU=${product.product_id} 获取失败:`, error.message);
        }
      }

      // 请求间隔，避免触发限流
      await this.sleep(100);
    }
  }

  /**
   * 通过页面上下文直接获取单个商品的跟卖数据
   * 【关键】在页面上下文中执行 fetch，绕过 CSP 和反爬虫检测
   */
  private async fetchFollowSellerDataDirect(productId: string): Promise<Partial<ProductData> | null> {
    return new Promise((resolve) => {
      const requestId = `follow_seller_${productId}_${Date.now()}`;
      const encodedUrl = encodeURIComponent(`/modal/otherOffersFromSellers?product_id=${productId}&page_changed=true`);
      const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}`;
      let resolved = false;

      if (__DEBUG__) {
        console.log(`[跟卖数据] 页面上下文请求: SKU=${productId}`);
      }

      // 监听页面返回的结果
      const handleResponse = (event: CustomEvent) => {
        if (event.detail?.requestId === requestId && !resolved) {
          resolved = true;
          window.removeEventListener('euraflow_page_response', handleResponse as EventListener);

          if (event.detail.success) {
            const data = this.parseFollowSellerResponse(event.detail.data);
            resolve(data);
          } else {
            if (__DEBUG__) {
              console.warn(`[跟卖数据] SKU=${productId} 请求失败:`, event.detail.error);
            }
            resolve(null);
          }
        }
      };

      window.addEventListener('euraflow_page_response', handleResponse as EventListener);

      // 超时处理（10秒）
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('euraflow_page_response', handleResponse as EventListener);
          if (__DEBUG__) {
            console.warn(`[跟卖数据] SKU=${productId} 请求超时`);
          }
          resolve(null);
        }
      }, 10000);

      // 发送请求到页面上下文
      window.dispatchEvent(new CustomEvent('euraflow_page_request', {
        detail: { requestId, type: 'fetch', url: apiUrl }
      }));
    });
  }

  /**
   * 解析跟卖数据响应
   */
  private parseFollowSellerResponse(data: any): Partial<ProductData> | null {
    try {
      const widgetStates = data.widgetStates || {};

      // 查找包含 "webSellerList" 的 key
      const sellerListKey = Object.keys(widgetStates).find(key =>
        key.includes('webSellerList')
      );

      if (!sellerListKey || !widgetStates[sellerListKey]) {
        return { competitor_count: 0 };
      }

      const sellerListData = JSON.parse(widgetStates[sellerListKey]);
      const sellers = sellerListData.sellers || [];

      if (sellers.length === 0) {
        return { competitor_count: 0 };
      }

      // 提取跟卖价格
      const prices: number[] = [];
      sellers.forEach((seller: any) => {
        let priceStr = seller.price?.cardPrice?.price || seller.price?.price || '';
        priceStr = priceStr.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
        const price = parseFloat(priceStr);
        if (!isNaN(price) && price > 0) {
          prices.push(price);
        }
      });

      prices.sort((a, b) => a - b);

      return {
        competitor_count: sellers.length,
        competitor_min_price: prices.length > 0 ? prices[0] : undefined,
      };
    } catch (error) {
      return { competitor_count: 0 };
    }
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
