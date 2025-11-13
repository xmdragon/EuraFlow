/**
 * 一键跟卖配置弹窗
 *
 * 原生DOM实现（无React依赖）
 */

import { extractProductData, type ProductDetailData } from '../parsers/product-detail';
import { ApiClient } from '../../shared/api-client';
import { getApiConfig } from '../../shared/storage';
import type { Shop, Warehouse, Watermark, QuickPublishRequest } from '../../shared/types';

// ========== 全局状态 ==========
let currentModal: HTMLElement | null = null;
let apiClient: ApiClient | null = null;
let productData: ProductDetailData | null = null;

// 配置数据
let shops: Shop[] = [];
let warehouses: Warehouse[] = [];
let watermarks: Watermark[] = [];

// 用户选择
let selectedShopId: number | null = null;
let selectedWarehouseIds: number[] = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let selectedWatermarkId: number | null = null; // 未来功能：水印支持

// ========== 主函数 ==========

/**
 * 显示上架配置弹窗
 */
export async function showPublishModal(realPrice: number): Promise<void> {
  console.log('[PublishModal] 显示弹窗，真实售价:', realPrice);

  // 如果已有弹窗，先关闭
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

  // 采集商品数据
  showLoadingModal('正在采集商品数据...');
  try {
    productData = await extractProductData();
    console.log('[PublishModal] 商品数据:', productData);
  } catch (error) {
    console.error('[PublishModal] 采集商品数据失败:', error);
    alert('采集商品数据失败，请刷新页面重试');
    closeModal();
    return;
  }

  // 加载配置数据（店铺、仓库、水印）
  updateLoadingMessage('正在加载店铺列表...');
  try {
    await loadConfigData();
  } catch (error) {
    console.error('[PublishModal] 加载配置数据失败:', error);
    alert('加载配置数据失败：' + (error as Error).message);
    closeModal();
    return;
  }

  // 渲染主弹窗
  renderMainModal(realPrice);
}

// ========== 数据加载 ==========

/**
 * 加载所有配置数据
 */
async function loadConfigData(): Promise<void> {
  if (!apiClient) throw new Error('API客户端未初始化');

  // 并行加载
  const [shopsData, watermarksData] = await Promise.all([
    apiClient.getShops(),
    apiClient.getWatermarks(),
  ]);

  shops = shopsData;
  watermarks = watermarksData;

  console.log('[PublishModal] 加载到店铺:', shops.length, '个');
  console.log('[PublishModal] 加载到水印:', watermarks.length, '个');

  // 默认选择第一个店铺
  if (shops.length > 0) {
    selectedShopId = shops[0].id;
    await loadWarehouses(selectedShopId);
  }
}

/**
 * 加载指定店铺的仓库列表
 */
async function loadWarehouses(shopId: number): Promise<void> {
  if (!apiClient) return;

  updateLoadingMessage('正在加载仓库列表...');
  warehouses = await apiClient.getWarehouses(shopId);
  console.log('[PublishModal] 加载到仓库:', warehouses.length, '个');

  // 默认选择第一个仓库
  if (warehouses.length > 0) {
    selectedWarehouseIds = [warehouses[0].id];
  }
}

// ========== UI 渲染 ==========

/**
 * 显示加载中弹窗
 */
function showLoadingModal(message: string): void {
  const overlay = createOverlay();
  const modal = createModalContainer();

  modal.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div style="font-size: 16px; margin-bottom: 16px;">${message}</div>
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
  if (currentModal) {
    const messageEl = currentModal.querySelector('div > div:first-child') as HTMLDivElement;
    if (messageEl) {
      messageEl.textContent = message;
    }
  }
}

/**
 * 渲染主弹窗
 */
function renderMainModal(realPrice: number): void {
  if (currentModal) {
    currentModal.remove();
  }

  const overlay = createOverlay();
  const modal = createModalContainer();

  // 弹窗内容
  modal.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: bold;">一键跟卖到 OZON</h2>
      ${renderProductPreview()}
    </div>

    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500;">店铺 <span style="color: red;">*</span></label>
      ${renderShopSelect()}
    </div>

    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500;">仓库 <span style="color: red;">*</span></label>
      ${renderWarehouseSelect()}
    </div>

    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500;">水印（可选）</label>
      ${renderWatermarkSelect()}
    </div>

    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500;">定价策略 <span style="color: red;">*</span></label>
      ${renderPricingStrategy(realPrice)}
    </div>

    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500;">商家SKU <span style="color: red;">*</span></label>
      <input type="text" id="offer-id" value="AUTO-${Date.now()}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
    </div>

    <div style="margin-bottom: 24px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500;">库存数量 <span style="color: red;">*</span></label>
      <input type="number" id="stock" value="100" min="1" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
    </div>

    <div id="progress-container" style="display: none; margin-bottom: 16px;">
      <div id="progress-message" style="margin-bottom: 8px; color: #1976D2; font-weight: 500;"></div>
      <div style="width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;">
        <div id="progress-bar" style="width: 0%; height: 100%; background: #1976D2; transition: width 0.3s;"></div>
      </div>
    </div>

    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="cancel-btn" style="padding: 12px 24px; border: 1px solid #ddd; background: white; cursor: pointer; border-radius: 6px; font-size: 14px; font-weight: 500;">取消</button>
      <button id="publish-btn" style="padding: 12px 24px; background: #1976D2; color: white; border: none; cursor: pointer; border-radius: 6px; font-size: 14px; font-weight: 500;">开始上架</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  currentModal = overlay;

  // 绑定事件
  bindEvents();
}

/**
 * 渲染商品预览
 */
function renderProductPreview(): string {
  if (!productData) return '';

  const imageUrl = productData.images && productData.images.length > 0 ? productData.images[0] : '';
  const title = productData.title || '未知商品';
  const price = productData.price || 0;
  const oldPrice = productData.old_price;

  return `
    <div style="border: 1px solid #e0e0e0; padding: 16px; border-radius: 8px; background: #f9f9f9;">
      <div style="display: flex; gap: 16px; align-items: start;">
        ${imageUrl ? `<img src="${imageUrl}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 6px; flex-shrink: 0;">` : ''}
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 500; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${title}</div>
          <div style="font-size: 14px; color: #666;">
            <span style="font-weight: bold; color: #D84315;">¥${price.toFixed(2)}</span>
            ${oldPrice ? `<span style="text-decoration: line-through; margin-left: 8px; color: #999;">¥${oldPrice.toFixed(2)}</span>` : ''}
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
    return '<div style="color: #f44336;">未找到店铺配置，请先在系统中添加店铺</div>';
  }

  const options = shops
    .map(shop => `<option value="${shop.id}" ${shop.id === selectedShopId ? 'selected' : ''}>${shop.display_name}</option>`)
    .join('');

  return `<select id="shop-select" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; cursor: pointer;">${options}</select>`;
}

/**
 * 渲染仓库下拉选择
 */
function renderWarehouseSelect(): string {
  if (warehouses.length === 0) {
    return '<div style="color: #666;">请先选择店铺</div>';
  }

  const options = warehouses
    .map(wh => `<option value="${wh.id}" ${selectedWarehouseIds.includes(wh.id) ? 'selected' : ''}>${wh.name}</option>`)
    .join('');

  return `<select id="warehouse-select" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; cursor: pointer;">${options}</select>`;
}

/**
 * 渲染水印下拉选择
 */
function renderWatermarkSelect(): string {
  const options = [
    '<option value="">无</option>',
    ...watermarks.map(wm => `<option value="${wm.id}">${wm.name}</option>`),
  ].join('');

  return `<select id="watermark-select" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; cursor: pointer;">${options}</select>`;
}

/**
 * 渲染定价策略
 */
function renderPricingStrategy(realPrice: number): string {
  return `
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <label style="display: flex; align-items: center; cursor: pointer;">
        <input type="radio" name="pricing" value="keep" checked style="margin-right: 8px;">
        <span>保持原价（¥${productData?.price?.toFixed(2) || '0.00'}）</span>
      </label>
      <label style="display: flex; align-items: center; cursor: pointer;">
        <input type="radio" name="pricing" value="markup" style="margin-right: 8px;">
        <span>加价</span>
        <input type="number" id="markup-percent" value="10" min="0" max="200" step="1" style="width: 60px; padding: 6px; border: 1px solid #ddd; border-radius: 4px; margin: 0 8px; font-size: 14px;">
        <span>%</span>
      </label>
      <label style="display: flex; align-items: center; cursor: pointer;">
        <input type="radio" name="pricing" value="custom" style="margin-right: 8px;">
        <span>自定义价格</span>
        <input type="number" id="custom-price" value="${realPrice.toFixed(2)}" min="0" step="0.01" style="width: 100px; padding: 6px; border: 1px solid #ddd; border-radius: 4px; margin: 0 8px; font-size: 14px;">
        <span>¥</span>
      </label>
    </div>
  `;
}

// ========== 事件处理 ==========

/**
 * 绑定所有事件
 */
function bindEvents(): void {
  // 取消按钮
  const cancelBtn = document.getElementById('cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeModal);
  }

  // 上架按钮
  const publishBtn = document.getElementById('publish-btn');
  if (publishBtn) {
    publishBtn.addEventListener('click', handlePublish);
  }

  // 店铺切换
  const shopSelect = document.getElementById('shop-select') as HTMLSelectElement;
  if (shopSelect) {
    shopSelect.addEventListener('change', async (e) => {
      const shopId = parseInt((e.target as HTMLSelectElement).value);
      selectedShopId = shopId;
      await loadWarehouses(shopId);
      // 重新渲染仓库下拉框
      const warehouseContainer = document.querySelector('#warehouse-select')?.parentElement;
      if (warehouseContainer) {
        const label = warehouseContainer.querySelector('label');
        warehouseContainer.innerHTML = '';
        if (label) warehouseContainer.appendChild(label);
        warehouseContainer.insertAdjacentHTML('beforeend', renderWarehouseSelect());
        // 重新绑定仓库选择事件
        const newWarehouseSelect = document.getElementById('warehouse-select') as HTMLSelectElement;
        if (newWarehouseSelect) {
          newWarehouseSelect.addEventListener('change', (e) => {
            const warehouseId = parseInt((e.target as HTMLSelectElement).value);
            selectedWarehouseIds = [warehouseId];
          });
        }
      }
    });
  }

  // 仓库选择
  const warehouseSelect = document.getElementById('warehouse-select') as HTMLSelectElement;
  if (warehouseSelect) {
    warehouseSelect.addEventListener('change', (e) => {
      const warehouseId = parseInt((e.target as HTMLSelectElement).value);
      selectedWarehouseIds = [warehouseId];
    });
  }

  // 水印选择
  const watermarkSelect = document.getElementById('watermark-select') as HTMLSelectElement;
  if (watermarkSelect) {
    watermarkSelect.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      selectedWatermarkId = value ? parseInt(value) : null;
      // 未来功能：将 selectedWatermarkId 传递给后端API
      console.log('[PublishModal] 选择水印:', selectedWatermarkId);
    });
  }

  // 定价策略单选框自动聚焦输入框
  const markupRadio = document.querySelector('input[value="markup"]') as HTMLInputElement;
  const markupInput = document.getElementById('markup-percent') as HTMLInputElement;
  if (markupRadio && markupInput) {
    markupInput.addEventListener('focus', () => {
      markupRadio.checked = true;
    });
  }

  const customRadio = document.querySelector('input[value="custom"]') as HTMLInputElement;
  const customInput = document.getElementById('custom-price') as HTMLInputElement;
  if (customRadio && customInput) {
    customInput.addEventListener('focus', () => {
      customRadio.checked = true;
    });
  }
}

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

  const offerIdInput = document.getElementById('offer-id') as HTMLInputElement;
  const offerId = offerIdInput?.value?.trim();
  if (!offerId) {
    alert('请输入商家SKU');
    return;
  }

  const stockInput = document.getElementById('stock') as HTMLInputElement;
  const stock = parseInt(stockInput?.value || '0');
  if (stock <= 0) {
    alert('请输入有效的库存数量');
    return;
  }

  // 计算价格
  const price = calculateFinalPrice();

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

  // 显示进度
  showProgress('正在提交上架任务...', 10);

  try {
    // 构建请求数据
    const request: QuickPublishRequest = {
      shop_id: selectedShopId,
      warehouse_ids: selectedWarehouseIds,
      offer_id: offerId,
      price: price,
      stock: stock,
      category_id: productData.category_id,
      old_price: productData.old_price,
      ozon_product_id: productData.ozon_product_id,
      title: productData.title,
      description: productData.description,
      images: productData.images,
      brand: productData.brand,
      barcode: productData.barcode,
      dimensions: productData.dimensions,
      attributes: productData.attributes,
    };

    console.log('[PublishModal] 提交上架请求:', request);

    // 调用API
    showProgress('正在调用 OZON API...', 50);
    const response = await apiClient.quickPublish(request);

    if (response.success && response.task_id) {
      // 轮询任务状态
      await pollTaskStatus(response.task_id);
    } else {
      throw new Error(response.error || '上架失败');
    }
  } catch (error) {
    console.error('[PublishModal] 上架失败:', error);
    hideProgress();
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
 * 计算最终价格
 */
function calculateFinalPrice(): number {
  const pricingStrategy = document.querySelector('input[name="pricing"]:checked') as HTMLInputElement;
  const strategy = pricingStrategy?.value || 'keep';

  if (strategy === 'keep') {
    return productData?.price || 0;
  } else if (strategy === 'markup') {
    const markupInput = document.getElementById('markup-percent') as HTMLInputElement;
    const markupPercent = parseFloat(markupInput?.value || '0');
    const basePrice = productData?.price || 0;
    return basePrice * (1 + markupPercent / 100);
  } else {
    const customInput = document.getElementById('custom-price') as HTMLInputElement;
    return parseFloat(customInput?.value || '0');
  }
}

/**
 * 轮询任务状态
 */
async function pollTaskStatus(taskId: string): Promise<void> {
  if (!apiClient) return;

  const maxAttempts = 60; // 最多轮询60次（5分钟）
  const interval = 5000; // 5秒

  for (let i = 0; i < maxAttempts; i++) {
    try {
      showProgress(`正在查询任务状态... (${i + 1}/${maxAttempts})`, 50 + (i / maxAttempts) * 45);

      const status = await apiClient.getTaskStatus(taskId);

      if (status.status === 'imported') {
        // 成功
        showProgress('上架成功！', 100);
        setTimeout(() => {
          alert('✓ 商品已成功上架到 OZON！');
          closeModal();
        }, 1000);
        return;
      } else if (status.status === 'failed') {
        // 失败
        throw new Error(status.error || '上架任务失败');
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
  throw new Error('任务超时，请稍后在系统中查看任务状态');
}

/**
 * 显示进度
 */
function showProgress(message: string, percent: number): void {
  const progressContainer = document.getElementById('progress-container');
  const progressMessage = document.getElementById('progress-message');
  const progressBar = document.getElementById('progress-bar');

  if (progressContainer) progressContainer.style.display = 'block';
  if (progressMessage) progressMessage.textContent = message;
  if (progressBar) progressBar.style.width = `${percent}%`;
}

/**
 * 隐藏进度
 */
function hideProgress(): void {
  const progressContainer = document.getElementById('progress-container');
  if (progressContainer) progressContainer.style.display = 'none';
}

/**
 * 关闭弹窗
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

  // 点击遮罩层关闭（可选）
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
function createModalContainer(): HTMLDivElement {
  const modal = document.createElement('div');
  Object.assign(modal.style, {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '32px',
    width: '540px',
    maxWidth: '90vw',
    maxHeight: '85vh',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
  });

  // 阻止点击事件冒泡
  modal.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  return modal;
}
