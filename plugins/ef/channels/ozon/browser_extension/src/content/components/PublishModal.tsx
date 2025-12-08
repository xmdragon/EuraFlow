/**
 * 一键跟卖配置弹窗（支持变体）
 *
 * 原生DOM实现（无React依赖）
 * 完全重构以支持多变体、批量定价、配置预加载
 */

import type { ProductDetailData } from '../parsers/product-detail';
import { createEuraflowApiProxy, type EuraflowApiProxy } from '../../shared/api';
import { getApiConfig } from '../../shared/storage';
import { calculateRealPriceCore } from '../price-calculator/calculator';
import { configCache } from '../../shared/config-cache';
import type { Shop, Warehouse, Watermark, QuickPublishVariant } from '../../shared/types';
import { injectEuraflowStyles } from '../styles/injector';

// ========== 工具函数 ==========

/**
 * 将OZON图片URL转换为指定尺寸的wc格式，加速图片加载
 * @param url 原始图片URL
 * @param size wc尺寸（如80、50）
 * @returns 转换后的URL
 */
function toWcImageUrl(url: string | undefined | null, size: number): string {
  if (!url) return '';
  // 如果已经有wc格式，先移除再添加新的
  const cleanUrl = url.replace(/\/wc\d+\//, '/');
  // 在最后一个斜杠前插入 /wcXX/
  const lastSlashIndex = cleanUrl.lastIndexOf('/');
  if (lastSlashIndex === -1) return cleanUrl;
  return cleanUrl.slice(0, lastSlashIndex) + `/wc${size}` + cleanUrl.slice(lastSlashIndex);
}

/**
 * 显示右上角 Toast 通知（5秒后自动消失）
 */
function showToast(message: string, type: 'success' | 'error' | 'info' = 'success'): void {
  const existingToast = document.getElementById('euraflow-toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.id = 'euraflow-toast';

  const colors = {
    success: { bg: '#10b981', icon: '✓' },
    error: { bg: '#ef4444', icon: '✕' },
    info: { bg: '#3b82f6', icon: 'ℹ' }
  };
  const { bg, icon } = colors[type];

  toast.style.cssText = `
    position: fixed; top: 20px; right: 20px;
    background: ${bg}; color: white;
    padding: 12px 20px; border-radius: 8px;
    font-size: 14px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 2147483647;
    display: flex; align-items: center; gap: 8px;
    animation: euraflow-toast-in 0.3s ease-out;
    max-width: 400px;
  `;
  toast.innerHTML = `<span style="font-size: 16px;">${icon}</span><span>${message}</span>`;

  if (!document.getElementById('euraflow-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'euraflow-toast-styles';
    style.textContent = `
      @keyframes euraflow-toast-in { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes euraflow-toast-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100px); } }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'euraflow-toast-out 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

/**
 * 获取缓存的降价百分比（默认1%）
 */
function getCachedDiscountPercent(): number {
  try {
    const cached = localStorage.getItem('EURAFLOW_DISCOUNT_PERCENT');
    if (cached) {
      const percent = parseFloat(cached);
      if (!isNaN(percent) && percent >= 1 && percent <= 99) {
        return percent;
      }
    }
  } catch {
    // ignore
  }
  return 1; // 默认1%
}

/**
 * 缓存降价百分比
 */
function setCachedDiscountPercent(percent: number): void {
  try {
    localStorage.setItem('EURAFLOW_DISCOUNT_PERCENT', percent.toString());
  } catch {
    // ignore
  }
}

/**
 * 检测描述中是否包含外链（<a>标签）
 * @param description 商品描述
 * @returns 是否包含外链
 */
function hasExternalLinks(description: string | undefined | null): boolean {
  if (!description) return false;
  // 检测 <a 标签（不区分大小写）
  return /<a\s/i.test(description);
}

// ========== 类型定义 ==========

/**
 * 变体编辑数据
 */
interface VariantEditData {
  variant_id: string;           // 变体ID
  name?: string;               // 商品名称（可选，从product-detail.ts提取）
  specifications: string;       // 规格描述（如 "白色,M"）
  spec_details?: Record<string, string>; // 规格详情（如 { color: "白色", size: "M" }）
  image_url: string;           // 变体主图
  images?: string[];           // 变体独立的附加图片URL列表（不同变体可能有不同的附加图）
  original_price: number;      // 原价格（元）- 真实售价
  original_old_price?: number; // 原划线价（元）
  min_follow_price?: number;   // 最低跟卖价（元）- 从商品详情获取
  custom_price: number;        // 用户自定义价格（元）
  custom_old_price?: number;   // 用户自定义划线价（元）
  offer_id: string;            // 商家SKU
  stock: number;               // 库存
  enabled: boolean;            // 是否启用（勾选）
  available: boolean;          // 是否可用（OZON原始状态）
}

/**
 * 定价策略类型
 * - discount_original: 基于原价（真实售价）降价
 * - discount_min_follow: 基于最低跟卖价降价
 * - fixed_price: 自定义固定价格
 * - original_price: 使用原价（不调整）
 */
type PricingStrategy = 'discount_original' | 'discount_min_follow' | 'fixed_price' | 'original_price';

/**
 * 批量定价配置
 */
interface BatchPricingConfig {
  strategy: PricingStrategy;
  discountPercent?: number; // 降价百分比（1-99），用于 discount_original 和 discount_min_follow
  fixedPrice?: number; // 固定价格（元），用于 fixed_price
}

/**
 * 生成Offer ID（货号）
 * 格式：ef_{13位时间戳}{3位随机数}
 */
function generateOfferId(): string {
  const timestamp = Date.now().toString(); // 13位时间戳
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0'); // 3位随机数
  return `ef_${timestamp}${random}`;
}

/**
 * 批量生成所有变体的Offer ID
 */
function batchGenerateOfferIds(): void {
  variants.forEach((variant, index) => {
    if (index > 0) {
      // 为确保唯一性，后续变体使用时间戳+索引
      const timestamp = Date.now().toString();
      const random = (Math.floor(Math.random() * 900) + index).toString().padStart(3, '0');
      variant.offer_id = `ef_${timestamp}${random}`;
    } else {
      variant.offer_id = generateOfferId();
    }
  });

  // 重新渲染表格
  renderMainModal();
}


// ========== 全局状态 ==========

let currentModal: HTMLElement | null = null;
let apiClient: EuraflowApiProxy | null = null;
let productData: ProductDetailData | null = null;

// 配置数据（从缓存加载）
let shops: Shop[] = [];
let warehouses: Warehouse[] = [];
let watermarks: Watermark[] = [];

// 用户选择
let selectedShopId: number | null = null;
let selectedWarehouseIds: number[] = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let selectedWatermarkId: number | null = null; // 未来功能：水印支持

// 用户选择缓存 key
const SELECTION_CACHE_KEY = 'euraflow_publish_selection';

// 缓存用户选择
interface SelectionCache {
  shopId: number;
  warehouseId: number;
  watermarkId: number | null;
}

async function saveSelectionCache(): Promise<void> {
  if (selectedShopId && selectedWarehouseIds.length > 0) {
    const cache: SelectionCache = {
      shopId: selectedShopId,
      warehouseId: selectedWarehouseIds[0],
      watermarkId: selectedWatermarkId,
    };
    try {
      await chrome.storage.local.set({ [SELECTION_CACHE_KEY]: cache });
    } catch {
      // 忽略缓存失败
    }
  }
}

async function loadSelectionCache(): Promise<SelectionCache | null> {
  try {
    const result = await chrome.storage.local.get(SELECTION_CACHE_KEY);
    return result[SELECTION_CACHE_KEY] || null;
  } catch {
    return null;
  }
}

// 变体数据
let variants: VariantEditData[] = [];

// 采购信息（可选）
let purchaseUrl: string = '';
let purchasePrice: number | null = null;
let purchaseNote: string = '';

// 编辑后的描述（当检测到外链时允许用户编辑）
let editedDescription: string = '';

// ========== 主函数 ==========

/**
 * 显示上架配置弹窗（入口）
 * @param product 商品详情数据（包括变体价格信息）
 * @param currentRealPrice 当前页面显示的真实售价
 * @param minFollowPrice 最低跟卖价（可选）
 */
export async function showPublishModal(product: any = null, currentRealPrice: number | null = null, minFollowPrice: number | null = null): Promise<void> {
  // 注入 EuraFlow 样式（仅注入一次）
  injectEuraflowStyles();

  // 关闭已有弹窗
  if (currentModal) {
    currentModal.remove();
    currentModal = null;
  }

  // 初始化 API 客户端
  const config = await getApiConfig();
  if (!config || !config.apiUrl || !config.apiKey) {
    alert('请先在扩展弹窗中配置 API 地址和密钥');
    return;
  }

  apiClient = createEuraflowApiProxy(config.apiUrl, config.apiKey);

  // 显示加载提示
  showLoadingModal('正在加载配置数据...');

  try {
    // 1. 验证并保存商品数据到全局变量
    if (!product || !product.title) {
      throw new Error('数据加载中，请稍后重试');
    }

    // 赋值给全局变量（避免参数遮蔽）
    productData = product;

    // 2. 加载配置数据（从缓存）
    updateLoadingMessage('正在加载配置数据...');
    await loadConfigData();

    // 3. 初始化变体数据（传递当前页面显示的真实售价和最低跟卖价）
    updateLoadingMessage('正在处理变体数据...');
    initializeVariants(currentRealPrice, minFollowPrice);

    // 4. 渲染主弹窗（仅关闭加载弹窗，不重置数据）
    closeModalElement();
    renderMainModal();
  } catch (error) {
    console.error('[PublishModal] 初始化失败:', error);
    closeModal();
    alert('初始化失败：' + (error as Error).message);
  }
}

// ========== 数据加载 ==========

/**
 * 加载配置数据（优先使用缓存）
 */
async function loadConfigData(): Promise<void> {
  if (!apiClient) throw new Error('API客户端未初始化');

  // 加载用户上次的选择
  const selectionCache = await loadSelectionCache();

  // 尝试从缓存获取配置
  const cached = configCache.getCached();

  if (cached) {
    shops = cached.shops;
    watermarks = cached.watermarks;

    if (shops.length > 0) {
      // 优先使用缓存的选择，否则使用第一个
      if (selectionCache && shops.some(s => s.id === selectionCache.shopId)) {
        selectedShopId = selectionCache.shopId;
        warehouses = cached.warehouses.get(selectedShopId) || [];
        // 优先使用缓存的仓库选择
        if (warehouses.some(w => w.id === selectionCache.warehouseId)) {
          selectedWarehouseIds = [selectionCache.warehouseId];
        } else if (warehouses.length > 0) {
          selectedWarehouseIds = [warehouses[0].id];
        }
        // 恢复水印选择
        if (selectionCache.watermarkId && watermarks.some(w => w.id === selectionCache.watermarkId)) {
          selectedWatermarkId = selectionCache.watermarkId;
        }
      } else {
        selectedShopId = shops[0].id;
        warehouses = cached.warehouses.get(selectedShopId) || [];
        if (warehouses.length > 0) {
          selectedWarehouseIds = [warehouses[0].id];
        }
      }
    }
    return;
  }

  // 缓存未命中，手动加载
  shops = await configCache.getShops(apiClient);
  watermarks = await configCache.getWatermarks(apiClient);

  if (shops.length > 0) {
    // 优先使用缓存的选择
    if (selectionCache && shops.some(s => s.id === selectionCache.shopId)) {
      selectedShopId = selectionCache.shopId;
      warehouses = await configCache.getWarehouses(apiClient, selectedShopId);
      if (warehouses.some(w => w.id === selectionCache.warehouseId)) {
        selectedWarehouseIds = [selectionCache.warehouseId];
      } else if (warehouses.length > 0) {
        selectedWarehouseIds = [warehouses[0].id];
      }
      if (selectionCache.watermarkId && watermarks.some(w => w.id === selectionCache.watermarkId)) {
        selectedWatermarkId = selectionCache.watermarkId;
      }
    } else {
      selectedShopId = shops[0].id;
      warehouses = await configCache.getWarehouses(apiClient, selectedShopId);
      if (warehouses.length > 0) {
        selectedWarehouseIds = [warehouses[0].id];
      }
    }
  }
}

/**
 * 加载指定店铺的仓库列表
 */
async function loadWarehouses(shopId: number): Promise<void> {
  if (!apiClient) return;

  warehouses = await configCache.getWarehouses(apiClient, shopId);

  // 默认选择第一个仓库
  if (warehouses.length > 0) {
    selectedWarehouseIds = [warehouses[0].id];
  } else {
    selectedWarehouseIds = [];
  }
}

/**
 * 初始化变体数据
 * @param pageRealPrice 当前页面显示的真实售价（从DOM提取，最新）
 * @param minFollowPrice 最低跟卖价（可选）
 */
function initializeVariants(pageRealPrice: number | null = null, minFollowPrice: number | null = null): void {
  variants = [];

  if (!productData) return;

  const product = productData;

  // 情况1: 商品有变体
  if (product.has_variants && product.variants && product.variants.length > 0) {
    product.variants.forEach((variant: any, index: number) => {
      // 解析价格（可能是字符串）
      const parsePrice = (raw: any): number => {
        if (typeof raw === 'string') {
          return parseFloat(raw.replace(/\s/g, '').replace(',', '.')) || 0;
        } else if (typeof raw === 'number') {
          return raw;
        }
        return 0;
      };

      // OZON 变体数据：price = 绿色价格，original_price = 划线价
      // 变体没有黑色价格，无法用公式计算真实售价，直接使用绿色价格
      const variantPrice = parsePrice(variant.price);
      const variantOldPrice = parsePrice(variant.original_price);

      // 初始化使用绿色价格，用户可通过"批量定价"手动调整
      const customPrice = variantPrice;

      // 提取变体主图URL（可能是对象或字符串）
      let variantImageUrl = '';
      if (variant.image_url) {
        if (typeof variant.image_url === 'string') {
          variantImageUrl = variant.image_url;
        } else {
          const imgObj = variant.image_url as any;
          variantImageUrl = imgObj.url || imgObj.link || imgObj.src || '';
        }
      }

      // 提取变体独立的附加图片URL列表
      let variantImages: string[] = [];
      if (variant.images && Array.isArray(variant.images)) {
        variantImages = variant.images
          .map((img: any) => {
            if (typeof img === 'string') return img;
            return img?.url || img?.link || img?.src || '';
          })
          .filter((url: string) => url && url.length > 0);
      }

      variants.push({
        variant_id: variant.variant_id,
        specifications: variant.specifications || `变体 ${index + 1}`,
        spec_details: variant.spec_details,
        image_url: variantImageUrl,
        images: variantImages.length > 0 ? variantImages : undefined, // 变体独立的附加图片
        original_price: variantPrice, // 绿色价格（变体无法计算真实售价）
        original_old_price: variantOldPrice, // 原划线价
        min_follow_price: minFollowPrice || undefined, // 最低跟卖价
        custom_price: customPrice, // 自定义价格（初始为真实售价）
        custom_old_price: customPrice * 1.6, // 划线价 = 自定义价格 × 1.6
        offer_id: generateOfferId(), // 使用生成函数
        stock: 9, // 默认库存改为9
        enabled: variant.available, // 默认勾选可用的变体
        available: variant.available,
      });
    });
  }
  // 情况2: 单品（无变体）
  else {
    // product.cardPrice = 绿色价格（Ozon卡价）
    // product.price = 黑色价格（普通价格）
    // product.realPrice = 真实售价（由 display.ts 传入，优先使用）
    // product.original_price = 划线价（不参与真实售价计算）
    const greenPrice = product.cardPrice || 0;
    const blackPrice = product.price || 0;

    // 优先级：pageRealPrice > product.realPrice > 公式计算
    let realPrice: number;
    if (pageRealPrice !== null && pageRealPrice > 0) {
      realPrice = pageRealPrice;
    } else if (product.realPrice !== null && product.realPrice !== undefined && product.realPrice > 0) {
      realPrice = product.realPrice;
    } else {
      realPrice = calculateRealPriceCore(greenPrice, blackPrice);
    }

    // 初始化使用原价，用户可通过"批量定价"手动调整
    const customPrice = realPrice;

    // 提取单品主图URL（第一张图）和附加图片列表
    let singleImageUrl = '';
    const singleImages: string[] = [];

    if (product.images && product.images.length > 0) {
      product.images.forEach((img: any, index: number) => {
        let imgUrl = '';
        if (typeof img === 'string') {
          imgUrl = img;
        } else {
          imgUrl = img?.url || img?.link || img?.src || '';
        }
        if (imgUrl) {
          if (index === 0) {
            singleImageUrl = imgUrl; // 第一张作为主图
          } else {
            singleImages.push(imgUrl); // 其余作为附加图片
          }
        }
      });
    }

    variants.push({
      variant_id: product.ozon_product_id || 'single',
      specifications: '单品',
      spec_details: undefined,
      image_url: singleImageUrl,
      images: singleImages.length > 0 ? singleImages : undefined, // 附加图片
      original_price: realPrice, // 原价格显示真实售价
      original_old_price: blackPrice,
      min_follow_price: minFollowPrice || undefined, // 最低跟卖价
      custom_price: customPrice, // 改后售价应用降价策略
      custom_old_price: customPrice * 1.6, // 划线价 = 改后售价 × 1.6（比例 0.625:1）
      offer_id: generateOfferId(),
      stock: 9, // 默认库存改为9
      enabled: true,
      available: true,
    });
  }
}

// ========== UI 渲染 ==========

/**
 * 显示加载中弹窗
 */
function showLoadingModal(message: string): void {
  const overlay = createOverlay();
  const modal = createModalContainer('480px');

  modal.innerHTML = `
    <div class="ef-loading-modal">
      <div id="loading-message" class="ef-loading-modal__message">${message}</div>
      <div class="ef-loading-modal__hint">请稍候...</div>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  currentModal = overlay;
}

/**
 * 更新加载消息
 */
function updateLoadingMessage(message: string): void {
  const messageEl = document.getElementById('loading-message');
  if (messageEl) {
    messageEl.textContent = message;
  }
}

/**
 * 渲染主弹窗
 */
function renderMainModal(): void {
  if (currentModal) {
    currentModal.remove();
  }

  const overlay = createOverlay();
  const modal = createModalContainer('920px'); // 更宽以容纳表格

  // 弹窗内容
  modal.innerHTML = `
    <div class="ef-modal-header">
      <h2 class="ef-modal-header__title">商品跟卖</h2>
    </div>

    <!-- 商品预览 -->
    ${renderProductPreview()}

    <!-- 操作栏：店铺/仓库/水印/库存/批量定价 -->
    <div class="ef-operations-bar">
      <div class="ef-operations-bar__field">
        <label class="ef-operations-bar__label ef-operations-bar__label--required">店铺</label>
        ${renderShopSelect()}
      </div>
      <div class="ef-operations-bar__field">
        <label class="ef-operations-bar__label ef-operations-bar__label--required">仓库</label>
        ${renderWarehouseSelect()}
      </div>
      <div class="ef-operations-bar__field">
        <label class="ef-operations-bar__label">水印</label>
        ${renderWatermarkSelect()}
      </div>
      <div class="ef-operations-bar__field ef-operations-bar__field--narrow">
        <label class="ef-operations-bar__label">默认库存</label>
        <input type="number" id="default-stock" value="9" min="1" class="ef-operations-bar__input">
      </div>
      <div class="ef-operations-bar__field">
        <button id="batch-pricing-btn" class="ef-operations-bar__button">批量定价</button>
      </div>
    </div>

    <!-- 变体列表表格 -->
    <div class="ef-variants-table-container">
      <table class="ef-variants-table">
        <thead class="ef-variants-table__head">
          <tr>
            <th class="ef-variants-table__th ef-variants-table__th--center ef-variants-table__th--checkbox">
              <input type="checkbox" id="select-all" checked class="ef-variants-table__checkbox">
            </th>
            <th class="ef-variants-table__th ef-variants-table__th--left ef-variants-table__th--image">图片</th>
            <th class="ef-variants-table__th ef-variants-table__th--left">规格</th>
            <th class="ef-variants-table__th ef-variants-table__th--left ef-variants-table__th--offerid">
              货号
              <button id="batch-generate-offerid-btn" class="ef-operations-bar__button ef-operations-bar__button--small">批量生成</button>
            </th>
            <th class="ef-variants-table__th ef-variants-table__th--right ef-variants-table__th--price">价格</th>
            <th class="ef-variants-table__th ef-variants-table__th--right ef-variants-table__th--custom-price">自定义价格</th>
            <th class="ef-variants-table__th ef-variants-table__th--right ef-variants-table__th--old-price">划线价</th>
            <th class="ef-variants-table__th ef-variants-table__th--right ef-variants-table__th--stock">库存</th>
          </tr>
        </thead>
        <tbody>
          ${renderVariantRows()}
        </tbody>
      </table>
    </div>

    <!-- 描述警告（当检测到外链时显示） -->
    ${renderDescriptionWarning()}

    <!-- 采购信息（可选） -->
    <div class="ef-purchase-info">
      <div class="ef-purchase-info__field">
        <label class="ef-purchase-info__label">采购地址</label>
        <input type="text" id="purchase-url" placeholder="可选，例如：1688商品链接" class="ef-purchase-info__input" value="${purchaseUrl}">
      </div>
      <div class="ef-purchase-info__field">
        <label class="ef-purchase-info__label">采购价</label>
        <input type="number" id="purchase-price" placeholder="可选，单位：元" step="0.01" min="0" class="ef-purchase-info__input ef-purchase-info__input--narrow" value="${purchasePrice !== null ? purchasePrice : ''}">
      </div>
      <div class="ef-purchase-info__field">
        <label class="ef-purchase-info__label">采购备注</label>
        <input type="text" id="purchase-note" placeholder="可选" class="ef-purchase-info__input" value="${purchaseNote}">
      </div>
    </div>

    <!-- 底部按钮 -->
    <div class="ef-modal-footer">
      <div id="selected-count" class="ef-modal-footer__count">已选择 ${variants.filter(v => v.enabled).length} 个变体</div>
      <button id="cancel-btn" class="ef-modal-footer__button ef-modal-footer__button--cancel">取消</button>
      <button id="follow-pdp-btn" class="ef-modal-footer__button ef-modal-footer__button--primary">跟卖</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  currentModal = overlay;

  // 绑定事件
  bindMainModalEvents();
}

/**
 * 渲染商品预览
 */
function renderProductPreview(): string {
  if (!productData) return '';

  // 使用第一张图片作为预览
  const imageUrl = productData.images?.[0]?.url || '';

  const title = productData.title || '未知商品';
  const variantCount = variants.length;

  // 获取真实售价（从第一个变体的 original_price）
  const realPrice = variants.length > 0 ? variants[0].original_price : 0;
  const priceText = realPrice > 0 ? ` (真实售价：¥${realPrice.toFixed(2)})` : '';

  // 使用wc80格式加速主图加载
  const wcImageUrl = toWcImageUrl(imageUrl, 80);

  return `
    <div class="ef-product-preview">
      ${wcImageUrl ? `<img src="${wcImageUrl}" class="ef-product-preview__image">` : ''}
      <div class="ef-product-preview__info">
        <div class="ef-product-preview__name">${title}${priceText}</div>
        <div class="ef-product-preview__variant-count">
          ${variantCount > 1 ? `${variantCount} 个变体` : '单品（无变体）'}
        </div>
      </div>
    </div>
  `;
}

/**
 * 渲染店铺下拉选择
 */
function renderShopSelect(): string {
  if (shops.length === 0) {
    return '<div class="ef-operations-bar__error">未找到店铺配置</div>';
  }

  const options = shops
    .map(shop => {
      // 显示格式：俄文名 [中文名]，与前端 ShopSelector 保持一致
      const displayName = shop.shop_name + (shop.shop_name_cn ? ` [${shop.shop_name_cn}]` : '');
      return `<option value="${shop.id}" ${shop.id === selectedShopId ? 'selected' : ''}>${displayName}</option>`;
    })
    .join('');

  return `<select id="shop-select" class="ef-operations-bar__select">${options}</select>`;
}

/**
 * 渲染仓库下拉选择
 */
function renderWarehouseSelect(): string {
  if (warehouses.length === 0) {
    return '<div class="ef-operations-bar__hint">请选择店铺</div>';
  }

  const options = warehouses
    .map(wh => `<option value="${wh.id}" ${selectedWarehouseIds.includes(wh.id) ? 'selected' : ''}>${wh.name}</option>`)
    .join('');

  return `<select id="warehouse-select" class="ef-operations-bar__select">${options}</select>`;
}

/**
 * 渲染水印下拉选择
 */
function renderWatermarkSelect(): string {
  if (watermarks.length === 0) {
    return '<div class="ef-operations-bar__hint">无可用水印</div>';
  }

  const options = watermarks
    .map(wm => `<option value="${wm.id}" ${wm.id === selectedWatermarkId ? 'selected' : ''}>${wm.name}</option>`)
    .join('');

  return `<select id="watermark-select" class="ef-operations-bar__select">
    <option value="">不使用水印</option>
    ${options}
  </select>`;
}

/**
 * 渲染描述警告区域（当检测到外链时显示）
 */
function renderDescriptionWarning(): string {
  const description = productData?.description || '';

  // 如果没有外链，不显示
  if (!hasExternalLinks(description)) {
    return '';
  }

  // 初始化编辑后的描述
  if (!editedDescription) {
    editedDescription = description;
  }

  // 转义HTML用于显示在textarea中
  const escapedDescription = editedDescription
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `
    <div class="ef-description-warning">
      <div class="ef-description-warning__field">
        <label class="ef-description-warning__label">商品描述</label>
        <textarea id="description-edit" class="ef-description-warning__textarea" placeholder="商品描述...">${escapedDescription}</textarea>
      </div>
      <div class="ef-description-warning__hint">
        提示：⚠️ 描述中有外链，请检查，建议删除或修改描述中的 &lt;a&gt; 标签。
      </div>
    </div>
  `;
}

/**
 * 渲染变体行
 */
function renderVariantRows(): string {
  if (variants.length === 0) {
    return '<tr><td colspan="8" class="ef-variants-table__td--empty">未检测到变体数据</td></tr>';
  }

  return variants.map((variant, index) => `
    <tr data-index="${index}" class="ef-variants-table__tr ${!variant.available ? 'ef-variants-table__tr--unavailable' : ''}">
      <td class="ef-variants-table__td ef-variants-table__td--center">
        <input type="checkbox" class="variant-checkbox ef-variants-table__checkbox" data-index="${index}" ${variant.enabled ? 'checked' : ''} ${!variant.available ? 'disabled' : ''}>
      </td>
      <td class="ef-variants-table__td">
        ${variant.image_url ? `<img src="${toWcImageUrl(variant.image_url, 50)}" class="ef-variants-table__image">` : '<div class="ef-variants-table__image-placeholder">无图</div>'}
      </td>
      <td class="ef-variants-table__td">
        <span class="ef-variants-table__spec">${variant.specifications}</span>
        ${!variant.available ? '<span class="ef-variants-table__unavailable-label">(不可用)</span>' : ''}
      </td>
      <td class="ef-variants-table__td">
        <input type="text" class="offer-id-input ef-variants-table__input" data-index="${index}" value="${variant.offer_id}" ${!variant.enabled ? 'disabled' : ''}>
      </td>
      <td class="ef-variants-table__td ef-variants-table__td--right">
        ¥${variant.original_price.toFixed(2)}
      </td>
      <td class="ef-variants-table__td">
        <input type="number" class="custom-price-input ef-variants-table__input ef-variants-table__input--right" data-index="${index}" value="${variant.custom_price.toFixed(2)}" step="0.01" min="0" ${!variant.enabled ? 'disabled' : ''}>
      </td>
      <td class="ef-variants-table__td">
        <input type="number" class="custom-old-price-input ef-variants-table__input ef-variants-table__input--right" data-index="${index}" value="${variant.custom_old_price?.toFixed(2) || ''}" step="0.01" min="0" placeholder="可选" ${!variant.enabled ? 'disabled' : ''}>
      </td>
      <td class="ef-variants-table__td">
        <input type="number" class="stock-input ef-variants-table__input ef-variants-table__input--right" data-index="${index}" value="${variant.stock}" min="1" ${!variant.enabled ? 'disabled' : ''}>
      </td>
    </tr>
  `).join('');
}

// ========== 事件处理 ==========

/**
 * 绑定主弹窗事件
 */
function bindMainModalEvents(): void {
  // 取消按钮
  const cancelBtn = document.getElementById('cancel-btn');
  cancelBtn?.addEventListener('click', closeModal);

  // 跟卖按钮
  const followPdpBtn = document.getElementById('follow-pdp-btn');
  followPdpBtn?.addEventListener('click', handleFollowPdp);

  // 店铺切换
  const shopSelect = document.getElementById('shop-select') as HTMLSelectElement;
  shopSelect?.addEventListener('change', async (e) => {
    const shopId = parseInt((e.target as HTMLSelectElement).value);
    selectedShopId = shopId;
    await loadWarehouses(shopId);
    rerenderWarehouseSelect();
  });

  // 仓库选择
  const warehouseSelect = document.getElementById('warehouse-select') as HTMLSelectElement;
  warehouseSelect?.addEventListener('change', (e) => {
    const warehouseId = parseInt((e.target as HTMLSelectElement).value);
    selectedWarehouseIds = [warehouseId];
  });

  // 水印选择
  const watermarkSelect = document.getElementById('watermark-select') as HTMLSelectElement;
  watermarkSelect?.addEventListener('change', (e) => {
    const value = (e.target as HTMLSelectElement).value;
    selectedWatermarkId = value ? parseInt(value) : null;
  });

  // 全选/取消全选
  const selectAllCheckbox = document.getElementById('select-all') as HTMLInputElement;
  selectAllCheckbox?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    variants.forEach((variant, index) => {
      if (variant.available) {
        variant.enabled = checked;
        const checkbox = document.querySelector(`.variant-checkbox[data-index="${index}"]`) as HTMLInputElement;
        if (checkbox) checkbox.checked = checked;
        toggleVariantInputs(index, checked);
      }
    });
    updateSelectedCount();
  });

  // 变体勾选
  document.querySelectorAll('.variant-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', (e) => {
      const index = parseInt((e.target as HTMLInputElement).getAttribute('data-index') || '0');
      const checked = (e.target as HTMLInputElement).checked;
      variants[index].enabled = checked;
      toggleVariantInputs(index, checked);
      updateSelectedCount();
    });
  });

  // 输入框变化同步到数据
  document.querySelectorAll('.offer-id-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const index = parseInt((e.target as HTMLInputElement).getAttribute('data-index') || '0');
      variants[index].offer_id = (e.target as HTMLInputElement).value;
    });
  });

  document.querySelectorAll('.custom-price-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const index = parseInt((e.target as HTMLInputElement).getAttribute('data-index') || '0');
      variants[index].custom_price = parseFloat((e.target as HTMLInputElement).value) || 0;
    });
  });

  document.querySelectorAll('.custom-old-price-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const index = parseInt((e.target as HTMLInputElement).getAttribute('data-index') || '0');
      const value = (e.target as HTMLInputElement).value;
      variants[index].custom_old_price = value ? parseFloat(value) : undefined;
    });
  });

  document.querySelectorAll('.stock-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const index = parseInt((e.target as HTMLInputElement).getAttribute('data-index') || '0');
      variants[index].stock = parseInt((e.target as HTMLInputElement).value) || 0;
    });
  });

  // 默认库存同步到所有变体
  const defaultStockInput = document.getElementById('default-stock') as HTMLInputElement;
  defaultStockInput?.addEventListener('input', (e) => {
    const defaultStock = parseInt((e.target as HTMLInputElement).value) || 1;

    // 同步到所有变体数据
    variants.forEach((variant, index) => {
      variant.stock = defaultStock;

      // 同步更新UI中的库存输入框
      const stockInput = document.querySelector(`.stock-input[data-index="${index}"]`) as HTMLInputElement;
      if (stockInput) {
        stockInput.value = defaultStock.toString();
      }
    });
  });

  // 批量生成Offer ID按钮
  const batchGenerateBtn = document.getElementById('batch-generate-offerid-btn');
  batchGenerateBtn?.addEventListener('click', () => {
    batchGenerateOfferIds();
  });

  // 批量定价按钮
  const batchPricingBtn = document.getElementById('batch-pricing-btn');
  batchPricingBtn?.addEventListener('click', showBatchPricingModal);

  // 采购信息输入
  const purchaseUrlInput = document.getElementById('purchase-url') as HTMLInputElement;
  purchaseUrlInput?.addEventListener('input', (e) => {
    purchaseUrl = (e.target as HTMLInputElement).value;
  });

  const purchasePriceInput = document.getElementById('purchase-price') as HTMLInputElement;
  purchasePriceInput?.addEventListener('input', (e) => {
    const value = (e.target as HTMLInputElement).value;
    purchasePrice = value ? parseFloat(value) : null;
  });

  const purchaseNoteInput = document.getElementById('purchase-note') as HTMLInputElement;
  purchaseNoteInput?.addEventListener('input', (e) => {
    purchaseNote = (e.target as HTMLInputElement).value;
  });

  // 描述编辑框（仅当检测到外链时存在）
  const descriptionEditInput = document.getElementById('description-edit') as HTMLTextAreaElement;
  descriptionEditInput?.addEventListener('input', (e) => {
    editedDescription = (e.target as HTMLTextAreaElement).value;
  });
}

/**
 * 切换变体输入框的启用状态
 */
function toggleVariantInputs(index: number, enabled: boolean): void {
  const selectors = [
    `.offer-id-input[data-index="${index}"]`,
    `.custom-price-input[data-index="${index}"]`,
    `.custom-old-price-input[data-index="${index}"]`,
    `.stock-input[data-index="${index}"]`,
  ];

  selectors.forEach((selector) => {
    const input = document.querySelector(selector) as HTMLInputElement;
    if (input) {
      input.disabled = !enabled;
    }
  });
}

/**
 * 更新已选择数量显示
 */
function updateSelectedCount(): void {
  const count = variants.filter(v => v.enabled).length;
  const countEl = document.getElementById('selected-count');
  if (countEl) {
    countEl.textContent = `已选择 ${count} 个变体`;
  }
}

/**
 * 重新渲染仓库下拉框
 */
function rerenderWarehouseSelect(): void {
  const warehouseSelect = document.getElementById('warehouse-select');
  if (warehouseSelect) {
    warehouseSelect.outerHTML = renderWarehouseSelect();
    // 重新绑定事件
    const newSelect = document.getElementById('warehouse-select') as HTMLSelectElement;
    newSelect?.addEventListener('change', (e) => {
      const warehouseId = parseInt((e.target as HTMLSelectElement).value);
      selectedWarehouseIds = [warehouseId];
    });
  }
}

// ========== 批量定价弹窗 ==========

/**
 * 显示批量定价弹窗
 */
function showBatchPricingModal(): void {
  const enabledCount = variants.filter(v => v.enabled).length;
  if (enabledCount === 0) {
    alert('请先勾选要定价的变体');
    return;
  }

  // 获取缓存的降价百分比
  const cachedDiscountPercent = getCachedDiscountPercent();

  // 创建批量定价弹窗
  const overlay = createOverlay();
  const modal = createModalContainer('500px');

  // 检查是否有最低跟卖价
  const hasMinFollowPrice = variants.some(v => v.min_follow_price && v.min_follow_price > 0);
  const sampleMinFollowPrice = variants.find(v => v.min_follow_price)?.min_follow_price || 0;
  const sampleOriginalPrice = variants[0]?.original_price || 100;

  modal.innerHTML = `
    <div class="ef-batch-pricing-header">
      <h3 class="ef-batch-pricing-header__title">批量定价</h3>
      <div class="ef-batch-pricing-header__desc">将应用到已选择的 ${enabledCount} 个变体</div>
    </div>

    <div class="ef-batch-pricing-options">
      <!-- 策略1: 基于原价降价 -->
      <label class="ef-batch-pricing-option ef-batch-pricing-option--selected" id="strategy-discount-original-label">
        <input type="radio" name="batch-strategy" value="discount_original" checked class="ef-batch-pricing-option__radio">
        <div class="ef-batch-pricing-option__content">
          <div class="ef-batch-pricing-option__title">基于原价降价</div>
          <div class="ef-batch-pricing-option__desc">在真实售价基础上降价指定百分比</div>
        </div>
      </label>

      <div id="discount-original-input-container" class="ef-batch-pricing-discount">
        <label class="ef-batch-pricing-discount__label">
          <span class="ef-batch-pricing-discount__text">降价</span>
          <input type="number" id="discount-original-percent" value="${cachedDiscountPercent}" min="1" max="99" step="1" class="ef-batch-pricing-discount__input">
          <span class="ef-batch-pricing-discount__text">%</span>
          <span class="ef-batch-pricing-discount__hint">（例：¥${sampleOriginalPrice.toFixed(0)} × ${100 - cachedDiscountPercent}% = ¥${(sampleOriginalPrice * (1 - cachedDiscountPercent / 100)).toFixed(0)}）</span>
        </label>
      </div>

      <!-- 策略2: 基于最低跟卖价降价 -->
      <label class="ef-batch-pricing-option ${!hasMinFollowPrice ? 'ef-batch-pricing-option--disabled' : ''}" id="strategy-discount-min-follow-label">
        <input type="radio" name="batch-strategy" value="discount_min_follow" class="ef-batch-pricing-option__radio" ${!hasMinFollowPrice ? 'disabled' : ''}>
        <div class="ef-batch-pricing-option__content">
          <div class="ef-batch-pricing-option__title">基于最低跟卖价降价</div>
          <div class="ef-batch-pricing-option__desc">${hasMinFollowPrice ? `最低跟卖价 ¥${sampleMinFollowPrice.toFixed(2)}` : '当前商品无最低跟卖价数据'}</div>
        </div>
      </label>

      <div id="discount-min-follow-input-container" class="ef-batch-pricing-discount" style="display: none;">
        <label class="ef-batch-pricing-discount__label">
          <span class="ef-batch-pricing-discount__text">降价</span>
          <input type="number" id="discount-min-follow-percent" value="${cachedDiscountPercent}" min="1" max="99" step="1" class="ef-batch-pricing-discount__input">
          <span class="ef-batch-pricing-discount__text">%</span>
          <span class="ef-batch-pricing-discount__hint">（例：¥${sampleMinFollowPrice.toFixed(0)} × ${100 - cachedDiscountPercent}% = ¥${(sampleMinFollowPrice * (1 - cachedDiscountPercent / 100)).toFixed(0)}）</span>
        </label>
      </div>

      <!-- 策略3: 自定义固定价格 -->
      <label class="ef-batch-pricing-option" id="strategy-fixed-price-label">
        <input type="radio" name="batch-strategy" value="fixed_price" class="ef-batch-pricing-option__radio">
        <div class="ef-batch-pricing-option__content">
          <div class="ef-batch-pricing-option__title">自定义固定价格</div>
          <div class="ef-batch-pricing-option__desc">为所有变体设置统一价格</div>
        </div>
      </label>

      <div id="fixed-price-input-container" class="ef-batch-pricing-discount" style="display: none;">
        <label class="ef-batch-pricing-discount__label">
          <span class="ef-batch-pricing-discount__text">价格</span>
          <input type="number" id="fixed-price-value" value="${sampleOriginalPrice.toFixed(2)}" min="0.01" step="0.01" class="ef-batch-pricing-discount__input" style="width: 100px;">
          <span class="ef-batch-pricing-discount__text">元</span>
        </label>
      </div>

      <!-- 策略4: 使用原价 -->
      <label class="ef-batch-pricing-option" id="strategy-original-price-label">
        <input type="radio" name="batch-strategy" value="original_price" class="ef-batch-pricing-option__radio">
        <div class="ef-batch-pricing-option__content">
          <div class="ef-batch-pricing-option__title">使用原价</div>
          <div class="ef-batch-pricing-option__desc">直接使用 OZON 真实售价，不调整</div>
        </div>
      </label>
    </div>

    <div class="ef-modal-footer">
      <button id="batch-cancel-btn" class="ef-modal-footer__button ef-modal-footer__button--cancel">取消</button>
      <button id="batch-apply-btn" class="ef-modal-footer__button ef-modal-footer__button--primary">应用</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // 阻止点击弹窗时关闭
  modal.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // 绑定批量定价弹窗事件
  bindBatchPricingEvents(overlay);
}

/**
 * 绑定批量定价弹窗事件
 */
function bindBatchPricingEvents(batchOverlay: HTMLElement): void {
  // 策略选择
  const strategyRadios = batchOverlay.querySelectorAll('input[name="batch-strategy"]');
  const discountOriginalContainer = batchOverlay.querySelector('#discount-original-input-container') as HTMLElement;
  const discountMinFollowContainer = batchOverlay.querySelector('#discount-min-follow-input-container') as HTMLElement;
  const fixedPriceContainer = batchOverlay.querySelector('#fixed-price-input-container') as HTMLElement;

  strategyRadios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const value = (e.target as HTMLInputElement).value;
      // 隐藏所有输入容器
      discountOriginalContainer.style.display = 'none';
      discountMinFollowContainer.style.display = 'none';
      fixedPriceContainer.style.display = 'none';

      // 根据选择显示对应的输入容器
      if (value === 'discount_original') {
        discountOriginalContainer.style.display = 'block';
      } else if (value === 'discount_min_follow') {
        discountMinFollowContainer.style.display = 'block';
      } else if (value === 'fixed_price') {
        fixedPriceContainer.style.display = 'block';
      }
      // original_price 不需要额外输入
    });
  });

  // 取消按钮
  const cancelBtn = batchOverlay.querySelector('#batch-cancel-btn');
  cancelBtn?.addEventListener('click', () => {
    batchOverlay.remove();
  });

  // 应用按钮
  const applyBtn = batchOverlay.querySelector('#batch-apply-btn');
  applyBtn?.addEventListener('click', () => {
    const selectedStrategy = batchOverlay.querySelector('input[name="batch-strategy"]:checked') as HTMLInputElement;
    const strategy = selectedStrategy?.value as PricingStrategy;

    if (strategy === 'discount_original') {
      const discountInput = batchOverlay.querySelector('#discount-original-percent') as HTMLInputElement;
      const discountPercent = parseFloat(discountInput.value) || 0;
      if (discountPercent <= 0 || discountPercent >= 100) {
        alert('降价百分比必须在 1-99 之间');
        return;
      }
      applyBatchPricing({ strategy: 'discount_original', discountPercent });
    } else if (strategy === 'discount_min_follow') {
      const discountInput = batchOverlay.querySelector('#discount-min-follow-percent') as HTMLInputElement;
      const discountPercent = parseFloat(discountInput.value) || 0;
      if (discountPercent <= 0 || discountPercent >= 100) {
        alert('降价百分比必须在 1-99 之间');
        return;
      }
      applyBatchPricing({ strategy: 'discount_min_follow', discountPercent });
    } else if (strategy === 'fixed_price') {
      const fixedPriceInput = batchOverlay.querySelector('#fixed-price-value') as HTMLInputElement;
      const fixedPrice = parseFloat(fixedPriceInput.value) || 0;
      if (fixedPrice <= 0) {
        alert('请输入有效的价格（大于0）');
        return;
      }
      applyBatchPricing({ strategy: 'fixed_price', fixedPrice });
    } else if (strategy === 'original_price') {
      applyBatchPricing({ strategy: 'original_price' });
    }

    batchOverlay.remove();
  });
}

/**
 * 应用批量定价
 */
function applyBatchPricing(config: BatchPricingConfig): void {
  variants.forEach((variant, index) => {
    if (!variant.enabled) return;

    let newPrice: number;

    if (config.strategy === 'original_price') {
      // 使用原价策略：直接使用 OZON 真实售价（original_price）
      newPrice = variant.original_price;
    } else if (config.strategy === 'discount_original' && config.discountPercent) {
      // 基于原价降价策略：价格 = 原价 * (1 - 百分比/100)
      newPrice = variant.original_price * (1 - config.discountPercent / 100);
      // 缓存降价百分比
      setCachedDiscountPercent(config.discountPercent);
    } else if (config.strategy === 'discount_min_follow' && config.discountPercent) {
      // 基于最低跟卖价降价策略
      const basePrice = variant.min_follow_price || variant.original_price;
      newPrice = basePrice * (1 - config.discountPercent / 100);
      // 缓存降价百分比
      setCachedDiscountPercent(config.discountPercent);
    } else if (config.strategy === 'fixed_price' && config.fixedPrice) {
      // 自定义固定价格策略
      newPrice = config.fixedPrice;
    } else {
      return; // 无效策略，跳过
    }

    // 确保价格不低于 0.01 元
    variant.custom_price = Math.max(0.01, newPrice);
    // 自动计算划线价（比例 0.625:1，即划线价 = 改后售价 × 1.6）
    variant.custom_old_price = variant.custom_price * 1.6;

    // 更新输入框
    const priceInput = document.querySelector(`.custom-price-input[data-index="${index}"]`) as HTMLInputElement;
    if (priceInput) priceInput.value = variant.custom_price.toFixed(2);

    const oldPriceInput = document.querySelector(`.custom-old-price-input[data-index="${index}"]`) as HTMLInputElement;
    if (oldPriceInput) oldPriceInput.value = variant.custom_old_price.toFixed(2);
  });
}

// ========== 上架处理 ==========

/**
 * 处理跟卖操作（立即上架）
 */
async function handleFollowPdp(): Promise<void> {
  if (!apiClient || !productData) {
    console.error('[PublishModal] 数据未准备好');
    alert('数据未准备好，请刷新页面重试');
    return;
  }

  // 验证必填字段
  if (!selectedShopId) {
    alert('请选择店铺');
    return;
  }

  if (selectedWarehouseIds.length === 0) {
    alert('请选择仓库');
    return;
  }

  // 校验尺寸和重量
  const dimensions = productData.dimensions;
  if (!dimensions || !dimensions.width || !dimensions.height || !dimensions.length || !dimensions.weight) {
    alert('尺寸和重量数据缺失，请刷新重试');
    return;
  }

  // 获取已选择的变体
  const enabledVariants = variants.filter(v => v.enabled);
  if (enabledVariants.length === 0) {
    alert('请至少选择一个变体');
    return;
  }

  // 验证每个变体的数据
  for (const variant of enabledVariants) {
    if (!variant.offer_id || variant.offer_id.trim() === '') {
      alert(`变体"${variant.specifications}"的商家SKU不能为空`);
      return;
    }
    if (variant.custom_price <= 0) {
      alert(`变体"${variant.specifications}"的价格必须大于 0`);
      return;
    }
    if (variant.stock <= 0) {
      alert(`变体"${variant.specifications}"的库存必须大于 0`);
      return;
    }
  }

  // 禁用按钮
  const followPdpBtn = document.getElementById('follow-pdp-btn') as HTMLButtonElement;
  const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
  if (followPdpBtn) {
    followPdpBtn.disabled = true;
    followPdpBtn.style.opacity = '0.5';
    followPdpBtn.style.cursor = 'not-allowed';
  }
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.style.opacity = '0.5';
    cancelBtn.style.cursor = 'not-allowed';
  }

  try {
    // 获取 API 配置
    const config = await getApiConfig();
    if (!config || !config.apiUrl) {
      throw new Error('API配置未初始化');
    }

    // ========== 构建变体数据 ==========
    // 直接使用图片 URL，后端负责下载和处理
    const variantsData: QuickPublishVariant[] = enabledVariants.map((variant) => {
      return {
        name: variant.name || productData?.title || '',
        sku: variant.variant_id,
        offer_id: variant.offer_id,
        price: variant.custom_price,
        stock: variant.stock,
        old_price: variant.custom_old_price || undefined,
        primary_image: variant.image_url || undefined,
        images: variant.images || undefined,
      };
    });

    // 注意：由于每个变体现在有独立的附加图片，不再需要共享图片
    // 但为了向后兼容，如果变体没有独立的附加图片，仍然使用 productData.images 作为后备

    // 确定使用的描述：如果用户编辑过（检测到外链时），使用编辑后的描述
    const finalDescription = editedDescription || productData.description || undefined;

    // 构建请求数据
    // 每个变体有独立的图片（primary_image + images），不再需要共享图片
    const requestData = {
      shop_id: selectedShopId,
      warehouse_id: selectedWarehouseIds[0],
      watermark_config_id: selectedWatermarkId || undefined,
      source_url: window.location.href,
      variants: variantsData,
      videos: productData.videos || undefined,
      description: finalDescription,
      category_id: productData.category_id || undefined,
      dimensions: productData.dimensions,
      attributes: productData.attributes || undefined,
      // 采购信息（可选）
      purchase_url: purchaseUrl || undefined,
      purchase_price: purchasePrice || undefined,
      purchase_note: purchaseNote || undefined,
      // 商品标题（用于后端构造展示数据）
      title: productData.title,
    };

    // 通过 Service Worker 调用跟卖接口（避免 CORS）
    const response = await chrome.runtime.sendMessage({
      type: 'FOLLOW_PDP',
      data: {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey || '',
        data: requestData,
      },
    });

    if (!response.success) {
      throw new Error(response.error || '跟卖失败');
    }

    // 保存用户选择（下次自动选中）
    await saveSelectionCache();

    // 成功后显示右上角通知
    showToast('跟卖已提交，后续请查看Seller后台是否有错', 'info');
    closeModal();
  } catch (error) {
    console.error('[PublishModal] 跟卖失败:', error);
    showToast('跟卖失败：' + (error as Error).message, 'error');

    // 恢复按钮状态
    if (followPdpBtn) {
      followPdpBtn.disabled = false;
      followPdpBtn.style.opacity = '1';
      followPdpBtn.style.cursor = 'pointer';
    }
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.style.opacity = '1';
      cancelBtn.style.cursor = 'pointer';
    }
  }
}

// ========== 进度弹窗（已废弃，新流程使用异步提交）==========
// 注：以下代码保留供参考，新流程不再需要前端轮询

// ========== 关闭弹窗 ==========

/**
 * 仅关闭弹窗元素（不重置数据）
 */
function closeModalElement(): void {
  if (currentModal) {
    currentModal.remove();
    currentModal = null;
  }
}

/**
 * 关闭主弹窗并重置所有状态
 */
function closeModal(): void {
  closeModalElement();

  // 重置状态
  productData = null;
  shops = [];
  warehouses = [];
  watermarks = [];
  selectedShopId = null;
  selectedWarehouseIds = [];
  selectedWatermarkId = null;
  variants = [];

  // 重置采购信息
  purchaseUrl = '';
  purchasePrice = null;
  purchaseNote = '';

  // 重置编辑后的描述
  editedDescription = '';
}

// ========== UI 辅助函数 ==========

/**
 * 创建遮罩层
 */
function createOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = 'euraflow-publish-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: '2147483646',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(2px)',
  });

  // 点击遮罩层关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  return overlay;
}

/**
 * 创建弹窗容器
 */
function createModalContainer(width: string): HTMLDivElement {
  const modal = document.createElement('div');
  Object.assign(modal.style, {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    width: width,
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
  });

  // 阻止点击事件冒泡
  modal.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  return modal;
}
