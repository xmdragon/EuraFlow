/**
 * 商品列表增强组件
 *
 * 在商品列表页的每个商品卡片下注入增强信息组件
 * - 检测上品帮是否存在，存在则不注入
 * - 批量获取上品帮销售数据、佣金、跟卖数据
 * - 根据配置的字段显示数据
 * - 监听滚动加载新商品
 */

import { injectEuraflowStyles } from '../styles/injector';
import { getDataPanelConfig } from '../../shared/storage';
import { spbangApiProxy } from '../../shared/api/spbang-api';
import type { SpbSalesData } from '../../shared/api/spbang-api';
import { renderListItemComponent } from './renderer';

// 商品容器选择器（用于 MutationObserver）
const PRODUCT_CONTAINER_SELECTORS = [
  '#contentScrollPaginator',
  '[data-widget="searchResultsV2"]',
  '[data-widget="megaPaginator"]'
];

/**
 * 商品列表增强器
 */
export class ProductListEnhancer {
  private observer: MutationObserver | null = null;
  private processedSkus = new Set<string>();
  private pendingSkus: string[] = [];
  private pendingCards = new Map<string, HTMLElement>();
  private batchTimer: number | null = null;
  private visibleFields: string[] = [];
  private isInitialized = false;
  private scanInterval: number | null = null;
  // 缓存已处理的数据，用于重新注入
  private dataCache = new Map<string, any>();

  /**
   * 初始化增强器
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    // 1. 检测上品帮是否存在
    if (this.detectShangpinbang()) {
      if (__DEBUG__) {
        console.log('[ProductListEnhancer] 检测到上品帮插件，跳过初始化');
      }
      return;
    }

    // 2. 加载字段配置
    const config = await getDataPanelConfig();
    this.visibleFields = config.visibleFields;

    if (__DEBUG__) {
      console.log('[ProductListEnhancer] 初始化，显示字段:', this.visibleFields);
    }

    // 3. 注入样式
    injectEuraflowStyles();

    // 4. 等待页面稳定后处理初始商品
    await this.waitForPageReady();
    await this.processInitialProducts();

    // 5. 启动 MutationObserver 监听新商品
    this.startObserver();

    // 6. 启动定期扫描（捕获遗漏和重新注入）
    this.startPeriodicScan();

    this.isInitialized = true;
  }

  /**
   * 检测上品帮是否存在
   */
  private detectShangpinbang(): boolean {
    return document.querySelector('.ozon-bang-wrap') !== null;
  }

  /**
   * 等待页面准备就绪
   */
  private async waitForPageReady(): Promise<void> {
    return new Promise((resolve) => {
      const checkReady = () => {
        const cards = this.getAllProductCards();
        if (cards.length > 0) {
          // 等待一小段时间确保DOM稳定
          setTimeout(resolve, 300);
        } else {
          setTimeout(checkReady, 200);
        }
      };
      checkReady();
    });
  }

  /**
   * 处理初始商品
   */
  private async processInitialProducts(): Promise<void> {
    const cards = this.getAllProductCards();
    if (cards.length === 0) return;

    if (__DEBUG__) {
      console.log(`[ProductListEnhancer] 处理初始商品: ${cards.length} 个`);
    }

    // 收集所有SKU
    for (const card of cards) {
      const sku = this.extractSkuFromCard(card);
      if (sku && !this.processedSkus.has(sku)) {
        this.pendingSkus.push(sku);
        this.pendingCards.set(sku, card);
      }
    }

    // 立即处理第一批
    await this.processBatch();
  }

  /**
   * 获取所有商品卡片
   * 通过商品链接反向查找最外层 tile 容器，确保不重复
   */
  private getAllProductCards(): HTMLElement[] {
    const cardSet = new Set<HTMLElement>();
    const processedSkus = new Set<string>();

    // 通过商品链接反向查找卡片（最可靠的方式）
    const allProductLinks = document.querySelectorAll<HTMLAnchorElement>('a[href*="/product/"]');
    allProductLinks.forEach(link => {
      // 提取 SKU
      const sku = this.extractSkuFromLink(link);
      if (!sku) return;

      // 跳过已处理的 SKU（避免同一商品多个链接）
      if (processedSkus.has(sku)) return;
      processedSkus.add(sku);

      // 查找最外层的 tile 容器
      const card = this.findProductCardParent(link);
      if (card && !card.querySelector('[data-euraflow="true"]')) {
        cardSet.add(card);
      }
    });

    return Array.from(cardSet);
  }

  /**
   * 从链接提取 SKU
   */
  private extractSkuFromLink(link: HTMLAnchorElement): string | null {
    if (!link?.href) return null;

    const urlParts = link.href.split('/product/');
    if (urlParts.length < 2) return null;

    const pathPart = urlParts[1].split('?')[0].replace(/\/$/, '');
    const lastDashIndex = pathPart.lastIndexOf('-');
    if (lastDashIndex === -1) return null;

    const sku = pathPart.substring(lastDashIndex + 1);
    if (/^\d{6,}$/.test(sku)) {
      return sku;
    }
    return null;
  }

  /**
   * 从商品卡片提取SKU
   */
  private extractSkuFromCard(card: HTMLElement): string | null {
    const link = card.querySelector<HTMLAnchorElement>('a[href*="/product/"]');
    if (!link?.href) return null;

    // URL 格式: /product/xxx-123456789 或 /product/xxx-123456789/
    const urlParts = link.href.split('/product/');
    if (urlParts.length < 2) return null;

    const pathPart = urlParts[1].split('?')[0].replace(/\/$/, '');
    const lastDashIndex = pathPart.lastIndexOf('-');
    if (lastDashIndex === -1) return null;

    const sku = pathPart.substring(lastDashIndex + 1);
    // 验证SKU格式（至少6位数字）
    if (/^\d{6,}$/.test(sku)) {
      return sku;
    }
    return null;
  }

  /**
   * 收集SKU（防抖处理）
   */
  private collectSku(sku: string, card: HTMLElement): void {
    if (this.processedSkus.has(sku)) return;

    this.pendingSkus.push(sku);
    this.pendingCards.set(sku, card);

    // 防抖：200ms 收集一批
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.batchTimer = window.setTimeout(() => this.processBatch(), 200);
  }

  /**
   * 处理一批SKU（渐进式注入）
   * 1. 先获取销售数据并立即注入
   * 2. 异步获取佣金和跟卖数据，获取后更新组件
   */
  private async processBatch(): Promise<void> {
    const batch = this.pendingSkus.splice(0, 50);
    if (batch.length === 0) return;

    if (__DEBUG__) {
      console.log(`[ProductListEnhancer] 处理批次: ${batch.length} 个SKU`);
    }

    // 第一步：获取销售数据并立即注入
    let salesDataMap: Map<string, any>;
    try {
      salesDataMap = await spbangApiProxy.getSalesDataBatch(batch);
    } catch (error: any) {
      console.error('[ProductListEnhancer] 销售数据获取失败:', error.message);
      salesDataMap = new Map();
    }

    // 立即注入组件（使用销售数据，缺失字段显示 --）
    for (const sku of batch) {
      const card = this.pendingCards.get(sku);
      if (card) {
        const salesData = salesDataMap.get(sku) || {};
        // 缓存数据用于重新注入
        this.dataCache.set(sku, salesData);
        this.injectComponent(card, sku, salesData);
        this.processedSkus.add(sku);
        this.pendingCards.delete(sku);
      }
    }

    // 第二步：异步获取佣金和跟卖数据，获取后更新组件
    this.fetchAndUpdateAdditionalData(batch, salesDataMap);

    // 如果还有待处理的SKU，继续处理
    if (this.pendingSkus.length > 0) {
      this.batchTimer = window.setTimeout(() => this.processBatch(), 100);
    }
  }

  /**
   * 异步获取跟卖数据，并更新已注入的组件
   * 注意：佣金数据已在 getSalesDataBatch 中获取，无需额外请求
   */
  private async fetchAndUpdateAdditionalData(
    skus: string[],
    salesDataMap: Map<string, any>
  ): Promise<void> {
    // 检查需要补充跟卖数据的SKU
    const needFollowSellerSkus: string[] = [];
    salesDataMap.forEach((data, sku) => {
      if (data.competitorCount == null && !(data as any).followSellerPrices?.length) {
        needFollowSellerSkus.push(sku);
      }
    });

    // 获取跟卖数据
    const followSellerMap = await this.fetchFollowSellerData(needFollowSellerSkus);

    // 更新数据并刷新组件
    let updatedCount = 0;
    skus.forEach(sku => {
      const cachedData = this.dataCache.get(sku);
      if (!cachedData) return;

      let hasUpdate = false;

      // 合并跟卖数据
      const followSeller = followSellerMap.get(sku);
      if (followSeller) {
        cachedData.followSellerSkus = followSeller.skus ?? [];
        cachedData.followSellerPrices = followSeller.prices ?? [];

        // 跟卖数：优先用 count，否则用 prices 数组长度
        if (followSeller.count != null) {
          cachedData.competitorCount = followSeller.count;
        } else if (followSeller.prices?.length > 0) {
          cachedData.competitorCount = followSeller.prices.length;
        }

        // 最低价：从 prices 数组取最小值
        if (followSeller.prices?.length > 0) {
          cachedData.competitorMinPrice = Math.min(...followSeller.prices);
        }
        hasUpdate = true;
      }

      // 更新缓存并刷新组件
      if (hasUpdate) {
        this.dataCache.set(sku, cachedData);
        this.updateComponentContent(sku, cachedData);
        updatedCount++;
      }
    });

    if (__DEBUG__ && updatedCount > 0) {
      console.log(`[ProductListEnhancer] 更新了 ${updatedCount} 个商品的附加数据`);
    }
  }

  /**
   * 获取跟卖数据（通过页面上下文直接请求）
   */
  private async fetchFollowSellerData(productIds: string[]): Promise<Map<string, any>> {
    if (productIds.length === 0) return new Map();

    // 确保页面脚本已加载
    await this.ensurePageScriptLoaded();

    const result = new Map<string, any>();

    // 逐个获取（页面上下文请求）
    for (const productId of productIds) {
      try {
        const data = await this.fetchFollowSellerDataDirect(productId);
        if (data) {
          result.set(productId, data);
        }
      } catch (error: any) {
        if (__DEBUG__) {
          console.warn(`[ProductListEnhancer] SKU=${productId} 跟卖数据获取失败:`, error.message);
        }
      }
      // 请求间隔
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return result;
  }

  /**
   * 确保页面注入脚本已加载
   */
  private pageScriptLoaded = false;
  private async ensurePageScriptLoaded(): Promise<void> {
    if (this.pageScriptLoaded || (window as any).__EURAFLOW_PAGE_SCRIPT_LOADED__) {
      this.pageScriptLoaded = true;
      return;
    }

    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('assets/page-injected.js');
      script.onload = () => {
        this.pageScriptLoaded = true;
        resolve();
      };
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  }

  /**
   * 通过页面上下文直接获取单个商品的跟卖数据
   */
  private async fetchFollowSellerDataDirect(productId: string): Promise<any | null> {
    return new Promise((resolve) => {
      const requestId = `follow_seller_${productId}_${Date.now()}`;
      const encodedUrl = encodeURIComponent(`/modal/otherOffersFromSellers?product_id=${productId}&page_changed=true`);
      const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}`;
      let resolved = false;

      const handleResponse = (event: CustomEvent) => {
        if (event.detail?.requestId === requestId && !resolved) {
          resolved = true;
          window.removeEventListener('euraflow_page_response', handleResponse as EventListener);

          if (event.detail.success) {
            const data = this.parseFollowSellerResponse(event.detail.data);
            resolve(data);
          } else {
            resolve(null);
          }
        }
      };

      window.addEventListener('euraflow_page_response', handleResponse as EventListener);

      // 超时处理
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('euraflow_page_response', handleResponse as EventListener);
          resolve(null);
        }
      }, 10000);

      window.dispatchEvent(new CustomEvent('euraflow_page_request', {
        detail: { requestId, type: 'fetch', url: apiUrl }
      }));
    });
  }

  /**
   * 解析跟卖数据响应
   */
  private parseFollowSellerResponse(data: any): any | null {
    try {
      const widgetStates = data.widgetStates || {};
      const sellerListKey = Object.keys(widgetStates).find(key => key.includes('webSellerList'));

      if (!sellerListKey || !widgetStates[sellerListKey]) {
        return { count: 0, skus: [], prices: [] };
      }

      const sellerListData = JSON.parse(widgetStates[sellerListKey]);
      const sellers = sellerListData.sellers || [];

      if (sellers.length === 0) {
        return { count: 0, skus: [], prices: [] };
      }

      const prices: number[] = [];
      const skus: string[] = [];

      sellers.forEach((seller: any) => {
        if (seller.sku) skus.push(seller.sku);

        let priceStr = seller.price?.cardPrice?.price || seller.price?.price || '';
        priceStr = priceStr.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
        const price = parseFloat(priceStr);
        if (!isNaN(price) && price > 0) {
          prices.push(price);
        }
      });

      prices.sort((a, b) => a - b);

      return { count: sellers.length, skus, prices };
    } catch {
      return { count: 0, skus: [], prices: [] };
    }
  }

  /**
   * 更新已注入组件的内容
   */
  private updateComponentContent(sku: string, data: any): void {
    const component = document.querySelector(`[data-euraflow="true"][data-sku="${sku}"]`) as HTMLElement | null;
    if (!component) return;

    // 重新渲染内容
    component.innerHTML = renderListItemComponent(data, this.visibleFields);

    // 重新绑定 SKU 复制按钮事件
    this.bindSkuCopyEvent(component);
  }

  /**
   * 注入组件到商品卡片
   */
  private injectComponent(card: HTMLElement, sku: string, data: SpbSalesData | undefined): void {
    // 检查该卡片是否已注入
    if (card.querySelector('[data-euraflow="true"]')) return;

    // 检查整个文档中是否已存在该 SKU 的组件（防止重复注入）
    if (document.querySelector(`[data-euraflow="true"][data-sku="${sku}"]`)) return;

    // 创建组件容器
    const component = document.createElement('div');
    component.setAttribute('data-v-euraflow', '');
    component.className = 'euraflow-item';
    component.setAttribute('data-euraflow', 'true');
    component.setAttribute('data-sku', sku);

    // 渲染内容
    component.innerHTML = renderListItemComponent(data, this.visibleFields);

    // 注入到卡片末尾
    card.appendChild(component);

    // 绑定 SKU 复制按钮事件
    this.bindSkuCopyEvent(component);
  }

  /**
   * 绑定 SKU 复制按钮事件
   */
  private bindSkuCopyEvent(container: HTMLElement): void {
    const copyBtn = container.querySelector('.ef-copy-btn[data-sku]') as HTMLElement | null;
    if (!copyBtn) return;

    const sku = copyBtn.getAttribute('data-sku');
    if (!sku) return;

    // 悬停效果
    copyBtn.addEventListener('mouseenter', () => {
      copyBtn.style.opacity = '1';
    });
    copyBtn.addEventListener('mouseleave', () => {
      copyBtn.style.opacity = '0.6';
    });

    // 复制功能
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const copyIcon = copyBtn.querySelector('.ef-copy-icon') as HTMLElement | null;
      const checkIcon = copyBtn.querySelector('.ef-check-icon') as HTMLElement | null;

      try {
        await navigator.clipboard.writeText(sku);

        // 显示成功图标
        if (copyIcon) copyIcon.style.display = 'none';
        if (checkIcon) checkIcon.style.display = 'inline';
        copyBtn.style.opacity = '1';

        // 1秒后恢复
        setTimeout(() => {
          if (copyIcon) copyIcon.style.display = 'inline';
          if (checkIcon) checkIcon.style.display = 'none';
          copyBtn.style.opacity = '0.6';
        }, 1000);
      } catch {
        // 降级方案
        const textarea = document.createElement('textarea');
        textarea.value = sku;
        textarea.style.cssText = 'position: fixed; left: -9999px;';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);

        // 显示成功图标
        if (copyIcon) copyIcon.style.display = 'none';
        if (checkIcon) checkIcon.style.display = 'inline';
        copyBtn.style.opacity = '1';

        setTimeout(() => {
          if (copyIcon) copyIcon.style.display = 'inline';
          if (checkIcon) checkIcon.style.display = 'none';
          copyBtn.style.opacity = '0.6';
        }, 1000);
      }
    });
  }

  /**
   * 启动 MutationObserver
   */
  private startObserver(): void {
    // 查找商品容器
    let container: Element | null = null;
    for (const selector of PRODUCT_CONTAINER_SELECTORS) {
      container = document.querySelector(selector);
      if (container) break;
    }

    if (!container) {
      container = document.body;
    }

    this.observer = new MutationObserver((mutations) => {
      // 再次检测上品帮（可能延迟加载）
      if (this.detectShangpinbang()) {
        this.destroy();
        return;
      }

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            this.processNewNode(node);
          }
        }
      }
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true
    });

    if (__DEBUG__) {
      console.log('[ProductListEnhancer] MutationObserver 已启动');
    }
  }

  /**
   * 处理新增节点
   */
  private processNewNode(node: HTMLElement): void {
    // 检查节点本身是否是商品卡片
    if (this.isProductCard(node)) {
      const sku = this.extractSkuFromCard(node);
      if (sku && !this.processedSkus.has(sku)) {
        this.collectSku(sku, node);
      }
      return;
    }

    // 检查子节点中是否有商品卡片
    const cards = node.querySelectorAll<HTMLElement>('a[href*="/product/"]');
    cards.forEach(link => {
      const card = this.findProductCardParent(link);
      if (card && !card.querySelector('[data-euraflow="true"]')) {
        const sku = this.extractSkuFromCard(card);
        if (sku && !this.processedSkus.has(sku)) {
          this.collectSku(sku, card);
        }
      }
    });
  }

  /**
   * 检查元素是否是商品卡片
   */
  private isProductCard(element: HTMLElement): boolean {
    const className = element.className || '';
    return (
      className.includes('tile') &&
      element.querySelector('a[href*="/product/"]') !== null
    );
  }

  /**
   * 查找商品卡片父元素（找到最外层的 tile 容器）
   */
  private findProductCardParent(element: Element): HTMLElement | null {
    let current: Element | null = element;
    let lastTile: HTMLElement | null = null;

    // 向上遍历，找到最外层的 tile 容器
    while (current && current !== document.body) {
      if (current instanceof HTMLElement) {
        const className = current.className || '';
        if (className.includes('tile')) {
          lastTile = current;
        }
      }
      current = current.parentElement;
    }

    return lastTile;
  }

  private scrollTimer: number | null = null;

  /**
   * 启动定期扫描
   * 用于捕获 MutationObserver 遗漏的卡片和重新注入被移除的组件
   */
  private startPeriodicScan(): void {
    // 定期扫描（800ms 间隔）
    this.scanInterval = window.setInterval(() => {
      this.scanAndInject();
    }, 800);

    // 滚动停止后快速扫描
    window.addEventListener('scroll', this.handleScroll, { passive: true });
  }

  private handleScroll = (): void => {
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
    }
    // 滚动停止 200ms 后立即扫描
    this.scrollTimer = window.setTimeout(() => {
      this.scanAndInject();
    }, 200);
  };

  /**
   * 扫描并注入组件
   */
  private scanAndInject(): void {
    // 检测上品帮（可能延迟加载）
    if (this.detectShangpinbang()) {
      this.destroy();
      return;
    }

    let newCardsCount = 0;
    let reinjectedCount = 0;

    // 在商品容器范围内搜索
    let container: Element | null = null;
    for (const selector of PRODUCT_CONTAINER_SELECTORS) {
      container = document.querySelector(selector);
      if (container) break;
    }
    if (!container) container = document.body;

    // 扫描容器内所有没有组件的商品卡片
    const allProductLinks = container.querySelectorAll<HTMLAnchorElement>('a[href*="/product/"]');
    const processedCards = new Set<HTMLElement>();

    allProductLinks.forEach(link => {
      const sku = this.extractSkuFromLink(link);
      if (!sku) return;

      const card = this.findProductCardParent(link);
      if (!card || processedCards.has(card)) return;
      processedCards.add(card);

      // 检查卡片是否已有组件
      if (card.querySelector('[data-euraflow="true"]')) return;

      // 已有缓存数据，直接重新注入
      if (this.dataCache.has(sku)) {
        this.injectComponent(card, sku, this.dataCache.get(sku));
        reinjectedCount++;
      } else if (!this.processedSkus.has(sku)) {
        // 新 SKU，加入待处理队列
        this.collectSku(sku, card);
        newCardsCount++;
      }
    });

    if (__DEBUG__ && (newCardsCount > 0 || reinjectedCount > 0)) {
      console.log(`[ProductListEnhancer] 扫描: 新卡片=${newCardsCount}, 重注入=${reinjectedCount}`);
    }
  }

  /**
   * 销毁增强器
   */
  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }

    // 移除滚动监听器
    window.removeEventListener('scroll', this.handleScroll);

    // 移除所有已注入的组件
    document.querySelectorAll('[data-euraflow="true"]').forEach(el => el.remove());

    this.processedSkus.clear();
    this.pendingSkus = [];
    this.pendingCards.clear();
    this.dataCache.clear();
    this.isInitialized = false;

    if (__DEBUG__) {
      console.log('[ProductListEnhancer] 已销毁');
    }
  }
}
