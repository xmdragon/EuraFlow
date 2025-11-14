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
import type { Shop, Warehouse, Watermark, QuickPublishVariant, QuickPublishBatchRequest } from '../../shared/types';

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
  if (isDebugEnabled()) console.log('[PublishModal] configCache.getCached() 返回值:', cached);

  if (cached) {
    if (isDebugEnabled()) console.log('[PublishModal] 使用缓存配置');
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

  // 缓存未命中，手动加载
  if (isDebugEnabled()) console.log('[PublishModal] 缓存未命中，重新加载配置');
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
    if (isDebugEnabled()) console.log('[PublishModal] 检测到商品变体:', product.variants.length, '个', '页面真实售价:', pageRealPrice);

    // 只有一个变体且提供了页面真实售价时，使用页面价格（确保一致性）
    const usePageRealPrice = product.variants.length === 1 && pageRealPrice !== null;

    product.variants.forEach((variant, index) => {
      // 注意：product-detail.ts 返回的价格已经是人民币元
      const greenPrice = variant.price || 0; // 绿色价格（Ozon Card价格）
      const blackPrice = variant.original_price || greenPrice; // 黑色价格（原价），没有则用绿价

      // 使用页面真实售价（单变体）或计算售价（多变体）
      const realPrice = usePageRealPrice ? pageRealPrice! : calculateRealPriceCore(greenPrice, blackPrice);

      // 应用降价策略
      const customPrice = Math.max(0.01, realPrice * discountMultiplier);

      if (isDebugEnabled()) console.log(`[PublishModal] 初始化变体 ${index}:`, {
        variant_id: variant.variant_id,
        specifications: variant.specifications,
        greenPrice,
        blackPrice,
        realPrice,
        customPrice,
        discountPercent
      });

      // 调试：输出原始变体图片
      console.log(`[PublishModal] 初始化变体 ${index + 1}:`, {
        variant_id: variant.variant_id,
        specifications: variant.specifications,
        image_url: variant.image_url,
        '是否有图片': !!variant.image_url
      });

      variants.push({
        variant_id: variant.variant_id,
        specifications: variant.specifications || `变体 ${index + 1}`,
        spec_details: variant.spec_details,
        image_url: variant.image_url || '',  // 保留原始值，不回退到商品主图
        original_price: realPrice, // 原价格显示真实售价
        original_old_price: blackPrice,
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

    variants.push({
      variant_id: product.ozon_product_id || 'single',
      specifications: '单品',
      spec_details: undefined,
      image_url: (product.images && product.images[0]) || '',
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
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 20px; font-weight: bold; color: #333;">一键跟卖到 OZON</h2>
    </div>

    <!-- 商品预览 -->
    ${renderProductPreview()}

    <!-- 操作栏：店铺/仓库/水印/库存/批量定价 -->
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto auto; gap: 12px; align-items: flex-end; margin-bottom: 16px; padding: 16px; background: #f5f5f5; border-radius: 8px;">
      <div>
        <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: #555;">店铺 <span style="color: red;">*</span></label>
        ${renderShopSelect()}
      </div>
      <div>
        <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: #555;">仓库 <span style="color: red;">*</span></label>
        ${renderWarehouseSelect()}
      </div>
      <div>
        <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: #555;">水印</label>
        ${renderWatermarkSelect()}
      </div>
      <div style="width: 100px;">
        <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: #555;">默认库存</label>
        <input type="number" id="default-stock" value="9" min="1" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
      </div>
      <div>
        <button id="batch-pricing-btn" style="padding: 8px 16px; background: #1976D2; color: white; border: none; cursor: pointer; border-radius: 4px; font-size: 14px; font-weight: 500; white-space: nowrap;">批量定价</button>
      </div>
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
            <th style="padding: 12px 8px; text-align: left; font-size: 13px; font-weight: 600; color: #555; width: 200px;">
              货号
              <button id="batch-generate-offerid-btn" style="margin-left: 8px; padding: 2px 8px; background: #1976D2; color: white; border: none; cursor: pointer; border-radius: 4px; font-size: 12px;">批量生成</button>
            </th>
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
 * 渲染水印下拉选择
 */
function renderWatermarkSelect(): string {
  if (watermarks.length === 0) {
    return '<div style="color: #999; font-size: 13px;">无可用水印</div>';
  }

  const options = watermarks
    .map(wm => `<option value="${wm.id}" ${wm.id === selectedWatermarkId ? 'selected' : ''}>${wm.name}</option>`)
    .join('');

  return `<select id="watermark-select" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; cursor: pointer;">
    <option value="">不使用水印</option>
    ${options}
  </select>`;
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
          <input type="number" id="discount-percent" value="${cachedDiscountPercent}" min="1" max="99" step="1" style="width: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; text-align: right;">
          <span style="font-size: 14px;">%</span>
          <span style="font-size: 13px; color: #666; margin-left: 8px;">（例：原价 ¥100，降价 ${cachedDiscountPercent}% = ¥${(100 * (1 - cachedDiscountPercent / 100)).toFixed(0)}）</span>
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
 * 处理上架操作
 */
async function handlePublish(): Promise<void> {
  console.log('[PublishModal] ========== 开始上架按钮被点击 ==========');
  console.log('[PublishModal] apiClient:', !!apiClient);
  console.log('[PublishModal] productData:', productData);

  if (!apiClient || !productData) {
    console.error('[PublishModal] 数据未准备好: apiClient=', !!apiClient, ', productData=', !!productData);
    alert('数据未准备好，请刷新页面重试');
    return;
  }

  // 验证必填字段
  console.log('[PublishModal] 验证必填字段: selectedShopId=', selectedShopId);
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
    // 构建批量请求（一次性提交所有变体）
    const variantsData: QuickPublishVariant[] = enabledVariants.map((variant, idx) => {
      // 调试：输出原始变体数据
      console.log(`[PublishModal] 变体 ${idx + 1} 原始数据:`, {
        variant_id: variant.variant_id,
        specifications: variant.specifications,
        image_url: variant.image_url,
        '是否有变体图片': !!variant.image_url
      });

      return {
        name: variant.name || productData?.title || '',  // 商品名称（必填）
        sku: variant.variant_id,                      // OZON SKU
        offer_id: variant.offer_id,
        price: yuanToCents(variant.custom_price),     // 元 → 分
        stock: variant.stock,
        old_price: variant.custom_old_price ? yuanToCents(variant.custom_old_price) : undefined,
        primary_image: variant.image_url || undefined,  // 变体主图URL（单个字符串）
      };
    });

    // 过滤共享图片：移除已经作为变体主图的图片
    const variantImageUrls = new Set(
      variantsData
        .map(v => v.primary_image)
        .filter((url): url is string => !!url)
        .map(url => url.replace(/\/wc\d+\//, '/')) // 移除尺寸标识符以匹配原图
    );

    const filteredImages = productData.images.filter(img => {
      const normalizedImg = img.replace(/\/wc\d+\//, '/');
      return !variantImageUrls.has(normalizedImg);
    });

    const batchRequest: QuickPublishBatchRequest = {
      shop_id: selectedShopId,
      warehouse_ids: selectedWarehouseIds,
      watermark_config_id: selectedWatermarkId || undefined,  // 水印配置ID
      variants: variantsData,
      // 共享图片（供后续步骤使用，如上传图片）
      images: filteredImages,  // 共享图片列表（已过滤变体主图）
    };

    console.log('[PublishModal] ========== 批量上架请求 ==========');
    console.log('[PublishModal] 变体数量:', enabledVariants.length);
    console.log('[PublishModal] 图片数量:', productData.images.length);
    console.log('[PublishModal] 完整请求数据:', JSON.stringify(batchRequest, null, 2));

    // 调用批量API
    console.log('[PublishModal] 调用 apiClient.quickPublishBatch...');
    const response = await apiClient.quickPublishBatch(batchRequest);
    console.log('[PublishModal] 批量响应:', response);

    if (!response.success || !response.task_ids || response.task_ids.length === 0) {
      throw new Error(response.error || '批量上架失败');
    }

    // 并发轮询所有任务
    console.log('[PublishModal] 开始轮询', response.task_ids.length, '个任务');
    const pollPromises = response.task_ids.map((taskId: string, idx: number) => {
      const variant = enabledVariants[idx];
      return pollTaskStatus(taskId, variant.specifications, selectedShopId ?? undefined);
    });

    await Promise.all(pollPromises);

    // 全部成功
    updateProgress(enabledVariants.length, enabledVariants.length, '全部上架完成！');
    setTimeout(() => {
      alert(`✓ 成功上架 ${enabledVariants.length} 个变体到 OZON！`);
      closeModal();
      closeProgressModal();
    }, 1000);
  } catch (error) {
    console.error('[PublishModal] 批量上架失败:', error);
    closeProgressModal();
    alert('批量上架失败：' + (error as Error).message);

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
async function pollTaskStatus(taskId: string, variantName: string, shopId?: number): Promise<void> {
  if (!apiClient) return;

  const maxAttempts = 60; // 最多轮询60次（5分钟）
  const interval = 5000; // 5秒

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const status = await apiClient.getTaskStatus(taskId, shopId);

      if (status.status === 'imported') {
        // 成功
        if (isDebugEnabled()) console.log(`[PublishModal] 变体"${variantName}"上架成功`);
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
 * 显示进度通知（右下角，不阻塞）
 */
function showProgressModal(totalCount: number): void {
  // 创建右下角通知容器（非阻塞）
  const notification = document.createElement('div');
  notification.id = 'euraflow-progress-notification';
  notification.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 360px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
    padding: 20px;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  notification.innerHTML = `
    <div style="display: flex; align-items: flex-start; gap: 12px;">
      <div style="flex-shrink: 0; width: 40px; height: 40px; background: #1976D2; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
      </div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px; color: #333;">正在上架...</div>
        <div id="progress-message" style="font-size: 14px; margin-bottom: 12px; color: #666;">准备中...</div>
        <div style="width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden; margin-bottom: 6px;">
          <div id="progress-bar" style="width: 0%; height: 100%; background: #1976D2; transition: width 0.3s;"></div>
        </div>
        <div id="progress-count" style="font-size: 13px; color: #999;">0 / ${totalCount}</div>
      </div>
    </div>
  `;

  document.body.appendChild(notification);
  progressOverlay = notification; // 保存引用（用于后续关闭）
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
