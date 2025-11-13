/**
 * 一键跟卖配置弹窗（支持变体）
 *
 * 原生DOM实现（无React依赖）
 * 完全重构以支持多变体、批量定价、配置预加载
 */

import { extractProductData, type ProductDetailData } from '../parsers/product-detail';
import { ApiClient } from '../../shared/api-client';
import { getApiConfig } from '../../shared/storage';
import { configCache } from '../../shared/config-cache';
import { centsToYuan, yuanToCents, formatYuan } from '../../shared/price-utils';
import type { Shop, Warehouse, Watermark, QuickPublishRequest } from '../../shared/types';

// ========== 类型定义 ==========

/**
 * 变体编辑数据
 */
interface VariantEditData {
  variant_id: string;           // 变体ID
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
 * 定价策略类型
 */
type PricingStrategy = 'manual' | 'discount' | 'profit';

/**
 * 批量定价配置
 */
interface BatchPricingConfig {
  strategy: PricingStrategy;
  discountPercent?: number; // 降价百分比（1-99）
  profitMargin?: number;    // 毛利率（1-99）
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
 * @param realPrice 真实售价（元），用于参考
 */
export async function showPublishModal(realPrice: number): Promise<void> {
  console.log('[PublishModal] 显示弹窗，参考售价:', realPrice, '元');

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
  showLoadingModal('正在采集商品数据...');

  try {
    // 1. 采集商品数据
    productData = await extractProductData();
    console.log('[PublishModal] 商品数据:', productData);

    if (!productData || !productData.title) {
      throw new Error('未能采集到有效商品数据');
    }

    // 2. 加载配置数据（从缓存）
    updateLoadingMessage('正在加载配置数据...');
    await loadConfigData();

    // 3. 初始化变体数据
    updateLoadingMessage('正在处理变体数据...');
    initializeVariants(realPrice);

    // 4. 渲染主弹窗
    closeModal();
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
    console.log('[PublishModal] 使用缓存配置');
    shops = cached.shops;
    watermarks = cached.watermarks;

    // 默认选择第一个店铺
    if (shops.length > 0) {
      selectedShopId = shops[0].id;
      warehouses = cached.warehouses.get(selectedShopId) || [];
      if (warehouses.length > 0) {
        selectedWarehouseIds = [warehouses[0].id];
      }
    }
    return;
  }

  // 缓存未命中，手动加载
  console.log('[PublishModal] 缓存未命中，重新加载配置');
  shops = await configCache.getShops(apiClient);
  watermarks = await configCache.getWatermarks(apiClient);

  if (shops.length > 0) {
    selectedShopId = shops[0].id;
    warehouses = await configCache.getWarehouses(apiClient, selectedShopId);
    if (warehouses.length > 0) {
      selectedWarehouseIds = [warehouses[0].id];
    }
  }

  // 未来功能：预选水印
  console.log('[PublishModal] 配置加载完成:', { shops: shops.length, warehouses: warehouses.length, watermarks: watermarks.length, selectedWatermark: selectedWatermarkId });
}

/**
 * 加载指定店铺的仓库列表
 */
async function loadWarehouses(shopId: number): Promise<void> {
  if (!apiClient) return;

  warehouses = await configCache.getWarehouses(apiClient, shopId);
  console.log('[PublishModal] 加载仓库:', warehouses.length, '个');

  // 默认选择第一个仓库
  if (warehouses.length > 0) {
    selectedWarehouseIds = [warehouses[0].id];
  } else {
    selectedWarehouseIds = [];
  }
}

/**
 * 初始化变体数据
 */
function initializeVariants(referencePrice: number): void {
  variants = [];

  if (!productData) {
    console.warn('[PublishModal] productData 为空');
    return;
  }

  // 保存到局部变量以避免 TypeScript null 检查问题
  const product = productData;

  // 情况1: 商品有变体
  if (product.has_variants && product.variants && product.variants.length > 0) {
    console.log('[PublishModal] 检测到商品变体:', product.variants.length, '个');
    product.variants.forEach((variant, index) => {
      // 价格转换：后端是分，前端显示元
      const originalPrice = centsToYuan(variant.price);
      const originalOldPrice = variant.old_price ? centsToYuan(variant.old_price) : undefined;

      variants.push({
        variant_id: variant.variant_id,
        specifications: variant.specifications || `变体 ${index + 1}`,
        spec_details: variant.spec_details,
        image_url: variant.image_url || (product.images && product.images[0]) || '',
        original_price: originalPrice,
        original_old_price: originalOldPrice,
        custom_price: referencePrice, // 默认使用参考价格
        custom_old_price: originalOldPrice,
        offer_id: `AUTO-${Date.now()}-${index}`,
        stock: 100,
        enabled: variant.available, // 默认勾选可用的变体
        available: variant.available,
      });
    });
  }
  // 情况2: 单品（无变体）
  else {
    console.log('[PublishModal] 单品（无变体）');
    const originalPrice = product.price || 0;
    const originalOldPrice = product.old_price;

    variants.push({
      variant_id: product.ozon_product_id || 'single',
      specifications: '单品',
      spec_details: undefined,
      image_url: (product.images && product.images[0]) || '',
      original_price: originalPrice,
      original_old_price: originalOldPrice,
      custom_price: referencePrice,
      custom_old_price: originalOldPrice,
      offer_id: `AUTO-${Date.now()}`,
      stock: 100,
      enabled: true,
      available: true,
    });
  }

  console.log('[PublishModal] 初始化变体数据完成:', variants.length, '个');
}

// ========== UI 渲染 ==========

/**
 * 显示加载中弹窗
 */
function showLoadingModal(message: string): void {
  const overlay = createOverlay();
  const modal = createModalContainer('480px');

  modal.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div id="loading-message" style="font-size: 16px; margin-bottom: 16px; color: #1976D2; font-weight: 500;">${message}</div>
      <div style="color: #666;">请稍候...</div>
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
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 20px; font-weight: bold; color: #333;">一键跟卖到 OZON</h2>
    </div>

    <!-- 商品预览 -->
    ${renderProductPreview()}

    <!-- 操作栏：店铺/仓库/库存/批量定价 -->
    <div style="display: flex; gap: 12px; align-items: flex-end; margin-bottom: 16px; padding: 16px; background: #f5f5f5; border-radius: 8px;">
      <div style="flex: 1;">
        <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: #555;">店铺 <span style="color: red;">*</span></label>
        ${renderShopSelect()}
      </div>
      <div style="flex: 1;">
        <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: #555;">仓库 <span style="color: red;">*</span></label>
        ${renderWarehouseSelect()}
      </div>
      <div style="width: 100px;">
        <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: #555;">默认库存</label>
        <input type="number" id="default-stock" value="100" min="1" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
      </div>
      <button id="batch-pricing-btn" style="padding: 8px 16px; background: #1976D2; color: white; border: none; cursor: pointer; border-radius: 4px; font-size: 14px; font-weight: 500; white-space: nowrap;">批量定价</button>
    </div>

    <!-- 变体列表表格 -->
    <div style="margin-bottom: 16px; max-height: 400px; overflow-y: auto; border: 1px solid #e0e0e0; border-radius: 8px;">
      <table style="width: 100%; border-collapse: collapse; background: white;">
        <thead style="position: sticky; top: 0; background: #fafafa; z-index: 1; border-bottom: 2px solid #e0e0e0;">
          <tr>
            <th style="padding: 12px 8px; text-align: center; font-size: 13px; font-weight: 600; color: #555; width: 40px;">
              <input type="checkbox" id="select-all" checked style="cursor: pointer;">
            </th>
            <th style="padding: 12px 8px; text-align: left; font-size: 13px; font-weight: 600; color: #555; width: 60px;">图片</th>
            <th style="padding: 12px 8px; text-align: left; font-size: 13px; font-weight: 600; color: #555;">规格</th>
            <th style="padding: 12px 8px; text-align: left; font-size: 13px; font-weight: 600; color: #555; width: 140px;">商家SKU</th>
            <th style="padding: 12px 8px; text-align: right; font-size: 13px; font-weight: 600; color: #555; width: 90px;">原价格</th>
            <th style="padding: 12px 8px; text-align: right; font-size: 13px; font-weight: 600; color: #555; width: 110px;">自定义价格</th>
            <th style="padding: 12px 8px; text-align: right; font-size: 13px; font-weight: 600; color: #555; width: 90px;">划线价</th>
            <th style="padding: 12px 8px; text-align: right; font-size: 13px; font-weight: 600; color: #555; width: 80px;">库存</th>
          </tr>
        </thead>
        <tbody>
          ${renderVariantRows()}
        </tbody>
      </table>
    </div>

    <!-- 底部按钮 -->
    <div style="display: flex; gap: 12px; justify-content: flex-end; align-items: center;">
      <div id="selected-count" style="flex: 1; color: #666; font-size: 14px;">已选择 ${variants.filter(v => v.enabled).length} 个变体</div>
      <button id="cancel-btn" style="padding: 10px 20px; border: 1px solid #ddd; background: white; cursor: pointer; border-radius: 6px; font-size: 14px; font-weight: 500;">取消</button>
      <button id="publish-btn" style="padding: 10px 20px; background: #1976D2; color: white; border: none; cursor: pointer; border-radius: 6px; font-size: 14px; font-weight: 500;">开始上架</button>
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

  const imageUrl = productData.images && productData.images.length > 0 ? productData.images[0] : '';
  const title = productData.title || '未知商品';
  const variantCount = variants.length;

  return `
    <div style="border: 1px solid #e0e0e0; padding: 12px; border-radius: 8px; background: #f9f9f9; margin-bottom: 16px;">
      <div style="display: flex; gap: 12px; align-items: center;">
        ${imageUrl ? `<img src="${imageUrl}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 6px; flex-shrink: 0;">` : ''}
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 500; font-size: 14px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${title}</div>
          <div style="font-size: 13px; color: #666;">
            ${variantCount > 1 ? `${variantCount} 个变体` : '单品（无变体）'}
          </div>
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
    return '<div style="color: #f44336; font-size: 13px;">未找到店铺配置</div>';
  }

  const options = shops
    .map(shop => `<option value="${shop.id}" ${shop.id === selectedShopId ? 'selected' : ''}>${shop.display_name}</option>`)
    .join('');

  return `<select id="shop-select" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; cursor: pointer;">${options}</select>`;
}

/**
 * 渲染仓库下拉选择
 */
function renderWarehouseSelect(): string {
  if (warehouses.length === 0) {
    return '<div style="color: #999; font-size: 13px;">请选择店铺</div>';
  }

  const options = warehouses
    .map(wh => `<option value="${wh.id}" ${selectedWarehouseIds.includes(wh.id) ? 'selected' : ''}>${wh.name}</option>`)
    .join('');

  return `<select id="warehouse-select" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; cursor: pointer;">${options}</select>`;
}

/**
 * 渲染变体行
 */
function renderVariantRows(): string {
  if (variants.length === 0) {
    return '<tr><td colspan="8" style="padding: 40px; text-align: center; color: #999;">未检测到变体数据</td></tr>';
  }

  return variants.map((variant, index) => `
    <tr data-index="${index}" style="border-bottom: 1px solid #f0f0f0; ${!variant.available ? 'background: #fafafa; opacity: 0.6;' : ''}">
      <td style="padding: 12px 8px; text-align: center;">
        <input type="checkbox" class="variant-checkbox" data-index="${index}" ${variant.enabled ? 'checked' : ''} ${!variant.available ? 'disabled' : ''} style="cursor: pointer;">
      </td>
      <td style="padding: 12px 8px;">
        ${variant.image_url ? `<img src="${variant.image_url}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid #e0e0e0;">` : '<div style="width: 50px; height: 50px; background: #f0f0f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #999;">无图</div>'}
      </td>
      <td style="padding: 12px 8px; font-size: 13px; color: #333;">
        ${variant.specifications}
        ${!variant.available ? '<span style="color: #f44336; font-size: 12px; margin-left: 4px;">(不可用)</span>' : ''}
      </td>
      <td style="padding: 12px 8px;">
        <input type="text" class="offer-id-input" data-index="${index}" value="${variant.offer_id}" ${!variant.enabled ? 'disabled' : ''} style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;">
      </td>
      <td style="padding: 12px 8px; text-align: right; font-size: 13px; color: #666;">
        ${formatYuan(variant.original_price)}
      </td>
      <td style="padding: 12px 8px;">
        <input type="number" class="custom-price-input" data-index="${index}" value="${variant.custom_price.toFixed(2)}" step="0.01" min="0" ${!variant.enabled ? 'disabled' : ''} style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; text-align: right;">
      </td>
      <td style="padding: 12px 8px;">
        <input type="number" class="custom-old-price-input" data-index="${index}" value="${variant.custom_old_price?.toFixed(2) || ''}" step="0.01" min="0" placeholder="可选" ${!variant.enabled ? 'disabled' : ''} style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; text-align: right;">
      </td>
      <td style="padding: 12px 8px;">
        <input type="number" class="stock-input" data-index="${index}" value="${variant.stock}" min="1" ${!variant.enabled ? 'disabled' : ''} style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; text-align: right;">
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

  // 上架按钮
  const publishBtn = document.getElementById('publish-btn');
  publishBtn?.addEventListener('click', handlePublish);

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

  // 创建批量定价弹窗
  const overlay = createOverlay();
  const modal = createModalContainer('500px');

  modal.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0; font-size: 18px; font-weight: bold; color: #333;">批量定价</h3>
      <div style="font-size: 13px; color: #666; margin-top: 4px;">将应用到已选择的 ${enabledCount} 个变体</div>
    </div>

    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; cursor: pointer; margin-bottom: 12px;" id="strategy-discount-label">
        <input type="radio" name="batch-strategy" value="discount" checked style="margin-right: 12px;">
        <div style="flex: 1;">
          <div style="font-weight: 500; margin-bottom: 4px;">降价策略</div>
          <div style="font-size: 13px; color: #666;">在原价基础上降价指定百分比</div>
        </div>
      </label>

      <div id="discount-input-container" style="margin-bottom: 12px; padding-left: 28px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 14px;">降价</span>
          <input type="number" id="discount-percent" value="10" min="1" max="99" step="1" style="width: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; text-align: right;">
          <span style="font-size: 14px;">%</span>
          <span style="font-size: 13px; color: #666; margin-left: 8px;">（例：原价 ¥100，降价 10% = ¥90）</span>
        </label>
      </div>

      <label style="display: flex; align-items: center; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; cursor: pointer; margin-bottom: 12px;" id="strategy-profit-label">
        <input type="radio" name="batch-strategy" value="profit" style="margin-right: 12px;">
        <div style="flex: 1;">
          <div style="font-weight: 500; margin-bottom: 4px;">毛利率策略</div>
          <div style="font-size: 13px; color: #666;">设置目标毛利率，自动计算售价</div>
        </div>
      </label>

      <div id="profit-input-container" style="margin-bottom: 12px; padding-left: 28px; display: none;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 14px;">毛利率</span>
          <input type="number" id="profit-margin" value="30" min="1" max="99" step="1" style="width: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; text-align: right;">
          <span style="font-size: 14px;">%</span>
          <span style="font-size: 13px; color: #666; margin-left: 8px;">（例：成本 ¥70，毛利 30% = ¥100）</span>
        </label>
      </div>

      <label style="display: flex; align-items: center; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; cursor: pointer;" id="strategy-manual-label">
        <input type="radio" name="batch-strategy" value="manual" style="margin-right: 12px;">
        <div style="flex: 1;">
          <div style="font-weight: 500; margin-bottom: 4px;">保持手动输入</div>
          <div style="font-size: 13px; color: #666;">不修改已输入的价格</div>
        </div>
      </label>
    </div>

    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="batch-cancel-btn" style="padding: 10px 20px; border: 1px solid #ddd; background: white; cursor: pointer; border-radius: 6px; font-size: 14px; font-weight: 500;">取消</button>
      <button id="batch-apply-btn" style="padding: 10px 20px; background: #1976D2; color: white; border: none; cursor: pointer; border-radius: 6px; font-size: 14px; font-weight: 500;">应用</button>
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
  const profitContainer = batchOverlay.querySelector('#profit-input-container') as HTMLElement;

  strategyRadios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const value = (e.target as HTMLInputElement).value;
      if (value === 'discount') {
        discountContainer.style.display = 'block';
        profitContainer.style.display = 'none';
      } else if (value === 'profit') {
        discountContainer.style.display = 'none';
        profitContainer.style.display = 'block';
      } else {
        discountContainer.style.display = 'none';
        profitContainer.style.display = 'none';
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
    } else if (strategy === 'profit') {
      const profitInput = batchOverlay.querySelector('#profit-margin') as HTMLInputElement;
      const profitMargin = parseFloat(profitInput.value) || 0;
      if (profitMargin <= 0 || profitMargin >= 100) {
        alert('毛利率必须在 1-99 之间');
        return;
      }
      applyBatchPricing({ strategy: 'profit', profitMargin });
    } else {
      // manual - 不做任何修改
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

    if (config.strategy === 'discount' && config.discountPercent) {
      // 降价策略：价格 = 原价 * (1 - 百分比/100)
      const newPrice = variant.original_price * (1 - config.discountPercent / 100);
      variant.custom_price = Math.max(0.01, newPrice); // 最低 0.01 元

      // 更新输入框
      const priceInput = document.querySelector(`.custom-price-input[data-index="${index}"]`) as HTMLInputElement;
      if (priceInput) priceInput.value = variant.custom_price.toFixed(2);
    } else if (config.strategy === 'profit' && config.profitMargin) {
      // 毛利率策略：价格 = 成本 / (1 - 毛利率/100)
      // 假设原价即为成本
      const cost = variant.original_price;
      const newPrice = cost / (1 - config.profitMargin / 100);
      variant.custom_price = Math.max(0.01, newPrice);

      // 更新输入框
      const priceInput = document.querySelector(`.custom-price-input[data-index="${index}"]`) as HTMLInputElement;
      if (priceInput) priceInput.value = variant.custom_price.toFixed(2);
    }
  });

  console.log('[PublishModal] 批量定价完成:', config);
}

// ========== 上架处理 ==========

/**
 * 处理上架操作
 */
async function handlePublish(): Promise<void> {
  if (!apiClient || !productData) {
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
  const publishBtn = document.getElementById('publish-btn') as HTMLButtonElement;
  const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.style.opacity = '0.5';
    publishBtn.style.cursor = 'not-allowed';
  }
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.style.opacity = '0.5';
    cancelBtn.style.cursor = 'not-allowed';
  }

  // 显示进度弹窗
  showProgressModal(enabledVariants.length);

  try {
    // 逐个上架变体
    for (let i = 0; i < enabledVariants.length; i++) {
      const variant = enabledVariants[i];
      updateProgress(i, enabledVariants.length, `正在上架变体: ${variant.specifications}...`);

      // 构建请求数据（价格转换：元 → 分）
      const request: QuickPublishRequest = {
        shop_id: selectedShopId,
        warehouse_ids: selectedWarehouseIds,
        offer_id: variant.offer_id,
        price: yuanToCents(variant.custom_price), // 元 → 分
        stock: variant.stock,
        old_price: variant.custom_old_price ? yuanToCents(variant.custom_old_price) : undefined,
        ozon_product_id: productData.ozon_product_id,
        title: productData.title,
        description: productData.description,
        images: variant.image_url ? [variant.image_url] : productData.images,
        brand: productData.brand,
        barcode: productData.barcode,
        category_id: productData.category_id,
        dimensions: productData.dimensions,
        attributes: productData.attributes,
      };

      console.log('[PublishModal] 提交变体上架:', variant.specifications, request);

      // 调用API
      const response = await apiClient.quickPublish(request);

      if (response.success && response.task_id) {
        // 轮询任务状态
        await pollTaskStatus(response.task_id, variant.specifications);
      } else {
        throw new Error(response.error || `变体"${variant.specifications}"上架失败`);
      }
    }

    // 全部成功
    updateProgress(enabledVariants.length, enabledVariants.length, '全部上架完成！');
    setTimeout(() => {
      alert(`✓ 成功上架 ${enabledVariants.length} 个变体到 OZON！`);
      closeModal();
      closeProgressModal();
    }, 1000);
  } catch (error) {
    console.error('[PublishModal] 上架失败:', error);
    closeProgressModal();
    alert('上架失败：' + (error as Error).message);

    // 恢复按钮
    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.style.opacity = '1';
      publishBtn.style.cursor = 'pointer';
    }
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.style.opacity = '1';
      cancelBtn.style.cursor = 'pointer';
    }
  }
}

/**
 * 轮询任务状态
 */
async function pollTaskStatus(taskId: string, variantName: string): Promise<void> {
  if (!apiClient) return;

  const maxAttempts = 60; // 最多轮询60次（5分钟）
  const interval = 5000; // 5秒

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const status = await apiClient.getTaskStatus(taskId);

      if (status.status === 'imported') {
        // 成功
        console.log(`[PublishModal] 变体"${variantName}"上架成功`);
        return;
      } else if (status.status === 'failed') {
        // 失败
        throw new Error(status.error || `变体"${variantName}"上架失败`);
      } else if (status.status === 'pending' || status.status === 'processing') {
        // 继续等待
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    } catch (error) {
      console.error('[PublishModal] 查询任务状态失败:', error);
      throw error;
    }
  }

  // 超时
  throw new Error(`变体"${variantName}"上架超时`);
}

// ========== 进度弹窗 ==========

let progressOverlay: HTMLElement | null = null;

/**
 * 显示进度弹窗
 */
function showProgressModal(totalCount: number): void {
  progressOverlay = createOverlay();
  const modal = createModalContainer('500px');

  modal.innerHTML = `
    <div style="text-align: center; padding: 32px;">
      <div style="font-size: 18px; font-weight: bold; margin-bottom: 16px; color: #333;">正在上架中...</div>
      <div id="progress-message" style="font-size: 14px; margin-bottom: 16px; color: #666;">准备中...</div>
      <div style="width: 100%; height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
        <div id="progress-bar" style="width: 0%; height: 100%; background: #1976D2; transition: width 0.3s;"></div>
      </div>
      <div id="progress-count" style="font-size: 13px; color: #999;">0 / ${totalCount}</div>
    </div>
  `;

  progressOverlay.appendChild(modal);
  document.body.appendChild(progressOverlay);

  // 阻止点击关闭
  modal.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  progressOverlay.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

/**
 * 更新进度
 */
function updateProgress(current: number, total: number, message: string): void {
  const progressMessage = document.getElementById('progress-message');
  const progressBar = document.getElementById('progress-bar');
  const progressCount = document.getElementById('progress-count');

  if (progressMessage) progressMessage.textContent = message;
  if (progressBar) progressBar.style.width = `${(current / total) * 100}%`;
  if (progressCount) progressCount.textContent = `${current} / ${total}`;
}

/**
 * 关闭进度弹窗
 */
function closeProgressModal(): void {
  if (progressOverlay) {
    progressOverlay.remove();
    progressOverlay = null;
  }
}

// ========== 关闭弹窗 ==========

/**
 * 关闭主弹窗
 */
function closeModal(): void {
  if (currentModal) {
    currentModal.remove();
    currentModal = null;
  }

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
      closeProgressModal();
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
