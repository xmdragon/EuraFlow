/**
 * 一键跟卖配置弹窗（支持变体）
 *
 * 原生DOM实现（无React依赖）
 * 完全重构以支持多变体、批量定价、配置预加载
 */

import type { ProductDetailData } from '../parsers/product-detail';
import { ApiClient } from '../../shared/api-client';
import { getApiConfig } from '../../shared/storage';
import { calculateRealPriceCore } from '../price-calculator/calculator';
import { configCache } from '../../shared/config-cache';
import { yuanToCents, formatYuan } from '../../shared/price-utils';
import type { Shop, Warehouse, Watermark, QuickPublishVariant } from '../../shared/types';
import { injectEuraflowStyles } from '../styles/injector';

// ========== 工具函数 ==========

/**
 * 检查是否启用调试模式
 */
function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem('EURAFLOW_DEBUG') === 'true';
  } catch {
    return false;
  }
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

// ========== 类型定义 ==========

/**
 * 变体编辑数据
 */
interface VariantEditData {
  variant_id: string;           // 变体ID
  name?: string;               // 商品名称（可选，从product-detail.ts提取）
  specifications: string;       // 规格描述（如 "白色,M"）
  spec_details?: Record<string, string>; // 规格详情（如 { color: "白色", size: "M" }）
  image_url: string;           // 变体图片
  original_price: number;      // 原价格（元）
  original_old_price?: number; // 原划线价（元）
  custom_price: number;        // 用户自定义价格（元）
  custom_old_price?: number;   // 用户自定义划线价（元）
  offer_id: string;            // 商家SKU
  stock: number;               // 库存
  enabled: boolean;            // 是否启用（勾选）
  available: boolean;          // 是否可用（OZON原始状态）
}

/**
 * 定价策略类型（移除毛利率策略）
 */
type PricingStrategy = 'manual' | 'discount';

/**
 * 批量定价配置
 */
interface BatchPricingConfig {
  strategy: PricingStrategy;
  discountPercent?: number; // 降价百分比（1-99）
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
let apiClient: ApiClient | null = null;
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

// 变体数据
let variants: VariantEditData[] = [];

// ========== 主函数 ==========

/**
 * 显示上架配置弹窗（入口）
 * @param product 商品详情数据（包括变体价格信息）
 */
export async function showPublishModal(product: any = null, currentRealPrice: number | null = null): Promise<void> {
  // 注入 EuraFlow 样式（仅注入一次）
  injectEuraflowStyles();

  if (isDebugEnabled()) console.log('[PublishModal] 显示弹窗，商品数据:', product, '当前真实售价:', currentRealPrice);

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

  apiClient = new ApiClient(config.apiUrl, config.apiKey);

  // 显示加载提示
  showLoadingModal('正在加载配置数据...');

  try {
    // 1. 验证并保存商品数据到全局变量
    if (!product || !product.title) {
      throw new Error('数据加载中，请稍后重试');
    }

    // 赋值给全局变量（避免参数遮蔽）
    productData = product;
    if (isDebugEnabled()) console.log('[PublishModal] 使用传递的商品数据，变体数:', productData!.variants?.length || 0);

    // 2. 加载配置数据（从缓存）
    updateLoadingMessage('正在加载配置数据...');
    await loadConfigData();

    // 3. 初始化变体数据（传递当前页面显示的真实售价）
    updateLoadingMessage('正在处理变体数据...');
    initializeVariants(currentRealPrice);

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

  // 尝试从缓存获取
  const cached = configCache.getCached();

  if (cached) {
    console.log('[PublishModal] ✓ 使用预加载的配置数据（缓存命中）');
    if (isDebugEnabled()) console.log('[PublishModal] cached.shops:', cached.shops);
    if (isDebugEnabled()) console.log('[PublishModal] cached.shops 类型:', typeof cached.shops);
    if (isDebugEnabled()) console.log('[PublishModal] cached.shops 长度:', Array.isArray(cached.shops) ? cached.shops.length : 'NOT AN ARRAY');
    if (isDebugEnabled()) console.log('[PublishModal] cached.watermarks:', cached.watermarks);
    if (isDebugEnabled()) console.log('[PublishModal] cached.warehouses:', cached.warehouses);

    shops = cached.shops;
    watermarks = cached.watermarks;

    // 默认选择第一个店铺
    if (shops.length > 0) {
      if (isDebugEnabled()) console.log('[PublishModal] 选择默认店铺:', shops[0]);
      selectedShopId = shops[0].id;
      warehouses = cached.warehouses.get(selectedShopId) || [];
      if (isDebugEnabled()) console.log('[PublishModal] 默认店铺仓库数:', warehouses.length);
      if (warehouses.length > 0) {
        selectedWarehouseIds = [warehouses[0].id];
      }
    } else {
      console.warn('[PublishModal] shops数组为空！');
    }
    return;
  }

  // 缓存未命中，手动加载（预加载可能失败或超时）
  console.log('[PublishModal] ⚠ 缓存未命中，实时加载配置数据...');
  shops = await configCache.getShops(apiClient);
  if (isDebugEnabled()) console.log('[PublishModal] 从API加载的shops:', shops);

  watermarks = await configCache.getWatermarks(apiClient);
  if (isDebugEnabled()) console.log('[PublishModal] 从API加载的watermarks:', watermarks);

  if (shops.length > 0) {
    selectedShopId = shops[0].id;
    warehouses = await configCache.getWarehouses(apiClient, selectedShopId);
    if (isDebugEnabled()) console.log('[PublishModal] 从API加载的warehouses:', warehouses);
    if (warehouses.length > 0) {
      selectedWarehouseIds = [warehouses[0].id];
    }
  } else {
    console.warn('[PublishModal] API返回的shops数组为空！');
  }

  // 未来功能：预选水印
  if (isDebugEnabled()) console.log('[PublishModal] 配置加载完成:', { shops: shops.length, warehouses: warehouses.length, watermarks: watermarks.length, selectedWatermark: selectedWatermarkId });
}

/**
 * 加载指定店铺的仓库列表
 */
async function loadWarehouses(shopId: number): Promise<void> {
  if (!apiClient) return;

  warehouses = await configCache.getWarehouses(apiClient, shopId);
  if (isDebugEnabled()) console.log('[PublishModal] 加载仓库:', warehouses.length, '个');

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
 */
function initializeVariants(pageRealPrice: number | null = null): void {
  variants = [];

  if (isDebugEnabled()) console.log('[PublishModal] initializeVariants 开始，productData:', productData, '页面真实售价:', pageRealPrice);

  if (!productData) {
    console.warn('[PublishModal] productData 为空');
    return;
  }

  // 保存到局部变量以避免 TypeScript null 检查问题
  const product = productData;

  if (isDebugEnabled()) console.log('[PublishModal] product.has_variants:', product.has_variants);
  if (isDebugEnabled()) console.log('[PublishModal] product.variants:', product.variants);

  // 获取缓存的降价百分比（默认1%）
  const discountPercent = getCachedDiscountPercent();
  const discountMultiplier = 1 - discountPercent / 100;

  // 情况1: 商品有变体
  if (product.has_variants && product.variants && product.variants.length > 0) {
    if (isDebugEnabled()) console.log('[PublishModal] 检测到商品变体:', product.variants.length, '个');

    product.variants.forEach((variant: any, index: number) => {
      // ✅ 直接读取 variant.price（人民币价格）
      const rawPrice: any = variant.price;
      let price: number = 0;

      // ✅ 价格可能是字符串，需要解析
      if (typeof rawPrice === 'string') {
        price = parseFloat((rawPrice as string).replace(/\s/g, '').replace(',', '.')) || 0;
      } else if (typeof rawPrice === 'number') {
        price = rawPrice as number;
      }

      // 应用降价策略
      const customPrice = Math.max(0.01, price * discountMultiplier);

      if (isDebugEnabled()) console.log(`[PublishModal] 初始化变体 ${index}:`, {
        variant_id: variant.variant_id,
        specifications: variant.specifications,
        price,
        customPrice,
        discountPercent
      });

      // 提取变体图片URL（可能是对象或字符串）
      let variantImageUrl = '';
      if (variant.image_url) {
        if (typeof variant.image_url === 'string') {
          variantImageUrl = variant.image_url;
        } else {
          const imgObj = variant.image_url as any;
          variantImageUrl = imgObj.url || imgObj.link || imgObj.src || '';
        }
      }

      if (isDebugEnabled()) {
        console.log(`[PublishModal] 初始化变体 ${index + 1}:`, {
          variant_id: variant.variant_id,
          specifications: variant.specifications,
          原始image_url: variant.image_url,
          提取的URL: variantImageUrl
        });
      }

      variants.push({
        variant_id: variant.variant_id,
        specifications: variant.specifications || `变体 ${index + 1}`,
        spec_details: variant.spec_details,
        image_url: variantImageUrl,
        original_price: price, // 原价格
        original_old_price: price, // 原划线价（与原价格相同）
        custom_price: customPrice, // 改后售价应用降价策略
        custom_old_price: customPrice * 1.6, // 划线价 = 改后售价 × 1.6（比例 0.625:1）
        offer_id: generateOfferId(), // 使用生成函数
        stock: 9, // 默认库存改为9
        enabled: variant.available, // 默认勾选可用的变体
        available: variant.available,
      });
    });
  }
  // 情况2: 单品（无变体）
  else {
    if (isDebugEnabled()) console.log('[PublishModal] 单品（无变体）');

    // 优先使用页面显示的真实售价（最新），否则从API数据计算
    let realPrice: number;
    let greenPrice: number;
    let blackPrice: number;

    if (pageRealPrice !== null) {
      // 使用页面显示的价格（确保和页面一致）
      realPrice = pageRealPrice;
      greenPrice = product.price || 0;
      blackPrice = product.original_price || greenPrice;
      if (isDebugEnabled()) console.log('[PublishModal] 使用页面真实售价:', realPrice);
    } else {
      // 从API数据计算
      greenPrice = product.price || 0;
      blackPrice = product.original_price || greenPrice;
      realPrice = calculateRealPriceCore(greenPrice, blackPrice);
      if (isDebugEnabled()) console.log('[PublishModal] 从API数据计算真实售价:', realPrice);
    }

    // 应用降价策略
    const customPrice = Math.max(0.01, realPrice * discountMultiplier);

    if (isDebugEnabled()) console.log('[PublishModal] 单品价格计算:', {
      pageRealPrice,
      greenPrice,
      blackPrice,
      realPrice,
      customPrice,
      discountPercent
    });

    // 提取单品图片URL（可能是对象或字符串）
    let singleImageUrl = '';
    if (product.images && product.images.length > 0) {
      const firstImage = product.images[0];
      if (typeof firstImage === 'string') {
        singleImageUrl = firstImage;
      } else {
        const imgObj = firstImage as any;
        singleImageUrl = imgObj.url || imgObj.link || imgObj.src || '';
      }
    }

    variants.push({
      variant_id: product.ozon_product_id || 'single',
      specifications: '单品',
      spec_details: undefined,
      image_url: singleImageUrl,
      original_price: realPrice, // 原价格显示真实售价
      original_old_price: blackPrice,
      custom_price: customPrice, // 改后售价应用降价策略
      custom_old_price: customPrice * 1.6, // 划线价 = 改后售价 × 1.6（比例 0.625:1）
      offer_id: generateOfferId(),
      stock: 9, // 默认库存改为9
      enabled: true,
      available: true,
    });
  }

  if (isDebugEnabled()) console.log('[PublishModal] 初始化变体数据完成:', variants.length, '个', variants);
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
  // 添加调试日志
  if (isDebugEnabled()) console.log('[PublishModal] renderMainModal 调用，数据状态:', {
    shops: shops.length,
    warehouses: warehouses.length,
    watermarks: watermarks.length,
    variants: variants.length,
    productData: !!productData
  });

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
            <th class="ef-variants-table__th ef-variants-table__th--right ef-variants-table__th--price">原价格</th>
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

  // 直接使用上品帮的主图（photo 字段）
  const imageUrl = productData.primary_image || '';

  if (isDebugEnabled()) {
    console.log('[PublishModal] 使用主图 (primary_image):', imageUrl);
  }

  const title = productData.title || '未知商品';
  const variantCount = variants.length;

  // 获取真实售价（从第一个变体的 original_price）
  const realPrice = variants.length > 0 ? variants[0].original_price : 0;
  const priceText = realPrice > 0 ? ` (真实售价：${formatYuan(realPrice)})` : '';

  return `
    <div class="ef-product-preview">
      ${imageUrl ? `<img src="${imageUrl}" class="ef-product-preview__image">` : ''}
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
    .map(shop => `<option value="${shop.id}" ${shop.id === selectedShopId ? 'selected' : ''}>${shop.display_name}</option>`)
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
        ${variant.image_url ? `<img src="${variant.image_url}" class="ef-variants-table__image">` : '<div class="ef-variants-table__image-placeholder">无图</div>'}
      </td>
      <td class="ef-variants-table__td">
        <span class="ef-variants-table__spec">${variant.specifications}</span>
        ${!variant.available ? '<span class="ef-variants-table__unavailable-label">(不可用)</span>' : ''}
      </td>
      <td class="ef-variants-table__td">
        <input type="text" class="offer-id-input ef-variants-table__input" data-index="${index}" value="${variant.offer_id}" ${!variant.enabled ? 'disabled' : ''}>
      </td>
      <td class="ef-variants-table__td ef-variants-table__td--right">
        ${formatYuan(variant.original_price)}
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

  modal.innerHTML = `
    <div class="ef-batch-pricing-header">
      <h3 class="ef-batch-pricing-header__title">批量定价</h3>
      <div class="ef-batch-pricing-header__desc">将应用到已选择的 ${enabledCount} 个变体</div>
    </div>

    <div class="ef-batch-pricing-options">
      <label class="ef-batch-pricing-option ef-batch-pricing-option--selected" id="strategy-discount-label">
        <input type="radio" name="batch-strategy" value="discount" checked class="ef-batch-pricing-option__radio">
        <div class="ef-batch-pricing-option__content">
          <div class="ef-batch-pricing-option__title">降价策略</div>
          <div class="ef-batch-pricing-option__desc">在原价基础上降价指定百分比</div>
        </div>
      </label>

      <div id="discount-input-container" class="ef-batch-pricing-discount">
        <label class="ef-batch-pricing-discount__label">
          <span class="ef-batch-pricing-discount__text">降价</span>
          <input type="number" id="discount-percent" value="${cachedDiscountPercent}" min="1" max="99" step="1" class="ef-batch-pricing-discount__input">
          <span class="ef-batch-pricing-discount__text">%</span>
          <span class="ef-batch-pricing-discount__hint">（例：原价 ¥100，降价 ${cachedDiscountPercent}% = ¥${(100 * (1 - cachedDiscountPercent / 100)).toFixed(0)}）</span>
        </label>
      </div>

      <label class="ef-batch-pricing-option" id="strategy-manual-label">
        <input type="radio" name="batch-strategy" value="manual" class="ef-batch-pricing-option__radio">
        <div class="ef-batch-pricing-option__content">
          <div class="ef-batch-pricing-option__title">真实售价</div>
          <div class="ef-batch-pricing-option__desc">使用 OZON 真实售价</div>
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
  const discountContainer = batchOverlay.querySelector('#discount-input-container') as HTMLElement;

  strategyRadios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const value = (e.target as HTMLInputElement).value;
      if (value === 'discount') {
        discountContainer.style.display = 'block';
      } else {
        discountContainer.style.display = 'none';
      }
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

    if (strategy === 'discount') {
      const discountInput = batchOverlay.querySelector('#discount-percent') as HTMLInputElement;
      const discountPercent = parseFloat(discountInput.value) || 0;
      if (discountPercent <= 0 || discountPercent >= 100) {
        alert('降价百分比必须在 1-99 之间');
        return;
      }
      applyBatchPricing({ strategy: 'discount', discountPercent });
    } else if (strategy === 'manual') {
      // 真实售价策略
      applyBatchPricing({ strategy: 'manual' });
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

    if (config.strategy === 'manual') {
      // 真实价格策略：使用 OZON 真实售价（original_price）
      variant.custom_price = variant.original_price;
      variant.custom_old_price = variant.original_price * 1.6;

      // 更新输入框
      const priceInput = document.querySelector(`.custom-price-input[data-index="${index}"]`) as HTMLInputElement;
      if (priceInput) priceInput.value = variant.custom_price.toFixed(2);

      const oldPriceInput = document.querySelector(`.custom-old-price-input[data-index="${index}"]`) as HTMLInputElement;
      if (oldPriceInput) oldPriceInput.value = variant.custom_old_price.toFixed(2);
    } else if (config.strategy === 'discount' && config.discountPercent) {
      // 降价策略：价格 = 原价 * (1 - 百分比/100)
      const newPrice = variant.original_price * (1 - config.discountPercent / 100);
      variant.custom_price = Math.max(0.01, newPrice); // 最低 0.01 元

      // 自动计算划线价（比例 0.625:1，即划线价 = 改后售价 × 1.6）
      variant.custom_old_price = variant.custom_price * 1.6;

      // 更新输入框
      const priceInput = document.querySelector(`.custom-price-input[data-index="${index}"]`) as HTMLInputElement;
      if (priceInput) priceInput.value = variant.custom_price.toFixed(2);

      const oldPriceInput = document.querySelector(`.custom-old-price-input[data-index="${index}"]`) as HTMLInputElement;
      if (oldPriceInput) oldPriceInput.value = variant.custom_old_price.toFixed(2);

      // 缓存降价百分比
      setCachedDiscountPercent(config.discountPercent);
    }
  });

  if (isDebugEnabled()) console.log('[PublishModal] 批量定价完成:', config);
}

// ========== 上架处理 ==========

/**
 * 处理跟卖操作（立即上架）
 */
async function handleFollowPdp(): Promise<void> {
  console.log('[PublishModal] ========== 跟卖按钮被点击 ==========');

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

    // 构建变体数据
    const variantsData: QuickPublishVariant[] = enabledVariants.map((variant) => {
      return {
        name: variant.name || productData?.title || '',
        sku: variant.variant_id,
        offer_id: variant.offer_id,
        price: yuanToCents(variant.custom_price),
        stock: variant.stock,
        old_price: variant.custom_old_price ? yuanToCents(variant.custom_old_price) : undefined,
        primary_image: variant.image_url || undefined,
      };
    });

    // 过滤共享图片：移除已经作为变体主图的图片
    const variantImageUrls = new Set(
      variantsData
        .map(v => v.primary_image)
        .filter((url): url is string => !!url)
        .map(url => url.replace(/\/wc\d+\//, '/'))
    );

    const filteredImages = productData.images
      .filter(img => img && img.url)
      .filter(img => {
        const normalizedImg = img.url.replace(/\/wc\d+\//, '/');
        return !variantImageUrls.has(normalizedImg);
      });

    // 构建请求数据
    const requestData = {
      shop_id: selectedShopId,
      warehouse_ids: selectedWarehouseIds,
      watermark_config_id: selectedWatermarkId || undefined,
      source_url: window.location.href,
      variants: variantsData,
      images: filteredImages,
      videos: productData.videos || undefined,
      description: productData.description || undefined,
      category_id: productData.category_id || undefined,
      brand: productData.brand || undefined,
      barcode: productData.barcode || undefined,
      dimensions: productData.dimensions,
      attributes: productData.attributes || undefined,
      product_data: {
        title: productData.title,
        images: productData.images,
        price: productData.price,
        original_price: productData.original_price,
        ozon_product_id: productData.ozon_product_id,
        has_variants: productData.has_variants,
        variants: productData.variants,
        description: productData.description,
        category_id: productData.category_id,
        brand: productData.brand,
        barcode: productData.barcode,
        dimensions: productData.dimensions,
        attributes: productData.attributes,
        videos: productData.videos,
      },
    };

    console.log('[PublishModal] 跟卖请求数据:', requestData);

    // 调用跟卖接口
    const response = await fetch(`${config.apiUrl}/api/ef/v1/ozon/collection-records/follow-pdp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey || '',
      },
      credentials: 'include',
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error?.detail || errorData?.detail || '跟卖失败');
    }

    const result = await response.json();
    console.log('[PublishModal] 跟卖成功:', result);

    // 成功后关闭窗口（不显示任何通知）
    window.close();
  } catch (error) {
    console.error('[PublishModal] 跟卖失败:', error);
    alert('跟卖失败：' + (error as Error).message);

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
