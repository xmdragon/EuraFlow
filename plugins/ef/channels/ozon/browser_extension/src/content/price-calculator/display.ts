/**
 * OZON 真实售价计算器 - 显示注入（整合上品帮数据）
 *
 * 在页面上注入和管理价格显示元素 + 上品帮销售数据面板
 */

import { showPublishModal } from '../components/PublishModal';
import { injectEuraflowStyles } from '../styles/injector';
import './display.scss';

// ========== 配置常量 ==========
const DISPLAY_CONFIG = {
  // 使用 OZON 风格的命名
  injectedElementId: 'euraflow-widget-price',
  injectedSectionId: 'euraflow-section',
};

// ========== 全局数据存储 ==========
// 存储当前页面的完整商品数据，异步 API 获取后不断合并更新
// 按钮点击时从这里获取最新最全的数据
interface ProductDataStore {
  ozonProduct: any | null;
  spbSales: any | null;
  euraflowConfig: any | null;
  dimensions: any | null;
  realPrice: number | null;
}

const productDataStore: ProductDataStore = {
  ozonProduct: null,
  spbSales: null,
  euraflowConfig: null,
  dimensions: null,
  realPrice: null,
};

/**
 * 更新全局数据存储（合并新数据到现有数据）
 */
export function updateProductDataStore(data: Partial<ProductDataStore>): void {
  if (data.ozonProduct !== undefined) {
    // 合并 ozonProduct 数据，保留已有字段
    productDataStore.ozonProduct = {
      ...productDataStore.ozonProduct,
      ...data.ozonProduct,
    };
  }
  if (data.spbSales !== undefined) {
    // 合并 spbSales 数据，新值覆盖旧值
    productDataStore.spbSales = {
      ...productDataStore.spbSales,
      ...data.spbSales,
    };
  }
  if (data.euraflowConfig !== undefined) {
    productDataStore.euraflowConfig = data.euraflowConfig;
  }
  if (data.dimensions !== undefined) {
    productDataStore.dimensions = data.dimensions;
  }
  if (data.realPrice !== undefined) {
    productDataStore.realPrice = data.realPrice;
  }

}

/**
 * 获取全局数据存储（只读）
 */
export function getProductDataStore(): Readonly<ProductDataStore> {
  return productDataStore;
}

// ========== Toast 通知 ==========

/**
 * 显示右上角 Toast 通知（5秒后自动消失）
 */
function showToast(message: string, type: 'success' | 'error' | 'info' = 'success'): void {
  // 移除已有的 toast
  const existingToast = document.getElementById('euraflow-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'euraflow-toast';

  // 根据类型设置颜色
  const colors = {
    success: { bg: '#10b981', icon: '✓' },
    error: { bg: '#ef4444', icon: '✕' },
    info: { bg: '#3b82f6', icon: 'ℹ' }
  };
  const { bg, icon } = colors[type];

  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${bg};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
    animation: euraflow-toast-in 0.3s ease-out;
    max-width: 400px;
  `;

  toast.innerHTML = `<span style="font-size: 16px;">${icon}</span><span>${message}</span>`;

  // 添加动画样式
  if (!document.getElementById('euraflow-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'euraflow-toast-styles';
    style.textContent = `
      @keyframes euraflow-toast-in {
        from { opacity: 0; transform: translateX(100px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes euraflow-toast-out {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(100px); }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  // 5秒后自动消失
  setTimeout(() => {
    toast.style.animation = 'euraflow-toast-out 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ========== 外链检测与确认弹窗 ==========

/**
 * 检测描述中是否包含外链（<a>标签）
 */
function hasExternalLinks(description: string | undefined | null): boolean {
  if (!description) return false;
  return /<a\s/i.test(description);
}

/**
 * 显示采集确认弹窗（当描述中包含外链时）
 * @returns Promise<{confirmed: boolean, editedDescription?: string}>
 */
function showCollectConfirmModal(description: string): Promise<{confirmed: boolean, editedDescription?: string}> {
  return new Promise((resolve) => {
    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.id = 'euraflow-collect-confirm-overlay';
    overlay.className = 'ef-collect-confirm-overlay';

    // 创建弹窗
    const modal = document.createElement('div');
    modal.className = 'ef-collect-confirm-modal';

    // 转义HTML用于显示
    const escapedDescription = description
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    modal.innerHTML = `
      <div class="ef-collect-confirm__field">
        <label class="ef-collect-confirm__label">商品描述</label>
        <textarea id="collect-description-edit" class="ef-collect-confirm__textarea">${escapedDescription}</textarea>
      </div>
      <div class="ef-collect-confirm__warning">
        提示：⚠️ 描述中有外链，请检查，建议删除或修改描述中的 &lt;a&gt; 标签。
      </div>
      <div class="ef-collect-confirm__actions">
        <button id="collect-cancel-btn" class="ef-collect-confirm__cancel-btn">取消</button>
        <button id="collect-confirm-btn" class="ef-collect-confirm__confirm-btn">确认采集</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 阻止点击弹窗时关闭
    modal.addEventListener('click', (e) => e.stopPropagation());

    // 点击遮罩层关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve({ confirmed: false });
      }
    });

    // 取消按钮
    const cancelBtn = modal.querySelector('#collect-cancel-btn');
    cancelBtn?.addEventListener('click', () => {
      overlay.remove();
      resolve({ confirmed: false });
    });

    // 确认按钮
    const confirmBtn = modal.querySelector('#collect-confirm-btn');
    confirmBtn?.addEventListener('click', () => {
      const textarea = modal.querySelector('#collect-description-edit') as HTMLTextAreaElement;
      const editedDescription = textarea?.value || description;
      overlay.remove();
      resolve({ confirmed: true, editedDescription });
    });
  });
}

// ========== 数据格式化函数 ==========

/**
 * 格式化日期
 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '---';
  try {
    // 只显示 YYYY-MM-DD 格式
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return dateStr;
  }
}

/**
 * 更新价格显示（异步加载完成后调用）
 * @param greenPrice 绿色价格（Ozon卡价格，可能为 null）
 * @param blackPrice 黑色价格（普通价格）
 * @param realPrice 真实售价（计算后的价格）
 */
export function updatePriceDisplay(greenPrice: number | null, blackPrice: number | null, realPrice: number | null): void {
  // 更新全局数据存储
  if (realPrice !== null) {
    productDataStore.realPrice = realPrice;
  }

  // 更新 DOM 显示
  const priceTagsContainer = document.getElementById('euraflow-price-tags');
  if (priceTagsContainer) {
    priceTagsContainer.innerHTML = createPriceTags(greenPrice, blackPrice, realPrice);
  }
}

/**
 * 创建价格标签 HTML
 */
function createPriceTags(greenPrice: number | null, blackPrice: number | null, realPrice: number | null): string {
  const tags: string[] = [];

  // 绿色价格（Ozon卡价格）- 只有存在且大于0才显示
  if (greenPrice !== null && greenPrice > 0) {
    tags.push(`<span class="ef-price-tag ef-price-tag--green">${greenPrice.toFixed(2)}¥</span>`);
  }

  // 黑色价格（普通价格）
  if (blackPrice !== null && blackPrice > 0) {
    tags.push(`<span class="ef-price-tag ef-price-tag--black">${blackPrice.toFixed(2)}¥</span>`);
  }

  // 红色价格（真实售价）
  if (realPrice !== null && realPrice > 0) {
    tags.push(`<span id="euraflow-real-price-tag" class="ef-price-tag ef-price-tag--red">${realPrice.toFixed(2)}¥</span>`);
  } else {
    tags.push(`<span id="euraflow-real-price-tag" class="ef-price-tag ef-price-tag--red">---</span>`);
  }

  return tags.join('');
}

/**
 * 更新跟卖数据（异步加载完成后调用）
 * 替换已注入的跟卖行，并更新全局数据存储
 */
export function updateFollowSellerData(spbSales: any): void {
  // 更新全局数据存储（合并跟卖数据到现有数据）
  updateProductDataStore({ spbSales });

  const existingRow = document.getElementById('ef-follower-row');
  if (!existingRow) return;

  const follower = spbSales?.competitorCount;
  const followerStr = follower != null && follower > 0 ? `${follower}家` : '无跟卖';

  // 计算最低跟卖价：仅使用 OZON 跟卖数据的 followSellerPrices
  // followSellerPrices 存在表示 OZON API 成功，空数组表示无跟卖
  // followSellerPrices 不存在表示 OZON API 失败，显示 ---
  let minPrice: number | null = null;
  if (spbSales?.followSellerPrices?.length > 0) {
    const prices = spbSales.followSellerPrices.filter((p: number) => p > 0);
    if (prices.length > 0) {
      minPrice = Math.min(...prices);
    }
  }
  const minPriceStr = minPrice != null ? `${minPrice.toFixed(2)}¥` : '---';

  // 创建新的跟卖行
  let newRow: HTMLElement;
  if (follower != null && follower > 0) {
    newRow = createFollowerRow(follower, followerStr, minPriceStr, spbSales?.followSellerList);
  } else {
    newRow = createSingleRow('跟卖', followerStr);
    newRow.id = 'ef-follower-row';
  }

  // 替换旧行
  existingRow.replaceWith(newRow);
}

/**
 * 更新类目数据（异步加载完成后调用）
 */
export function updateCategoryData(spbSales: any): void {
  // 更新全局数据存储（合并类目数据到现有数据）
  updateProductDataStore({ spbSales });

  const existingRow = document.getElementById('ef-category-row');
  if (!existingRow) return;

  const categoryValue = spbSales?.category || '---';

  // 更新类目值
  const valueSpan = existingRow.querySelector('.ef-value');
  if (valueSpan) {
    valueSpan.textContent = categoryValue;
  }
}

/**
 * 更新评分数据（异步加载完成后调用）
 */
export function updateRatingData(rating: number | null, reviewCount: number | null): void {
  const bottomRow = document.querySelector('.ef-row-bottom');
  if (!bottomRow) return;

  // 找到评分列
  const ratingCol = bottomRow.querySelector('.ef-col:first-child');
  if (!ratingCol) return;

  // 更新评分内容
  let ratingHtml = '<span class="ef-label">评分:</span>';
  if (rating != null) {
    const stars = '★'.repeat(Math.round(rating));
    const reviewStr = reviewCount != null ? `(${reviewCount})` : '';
    ratingHtml += `<span class="ef-rating" title="评分: ${rating}">${stars}${rating} ${reviewStr}</span>`;
  } else {
    ratingHtml += '<span class="ef-value">---</span>';
  }
  ratingCol.innerHTML = ratingHtml;
}

/**
 * 更新尺寸和重量数据（异步加载完成后调用）
 */
export function updateDimensionsData(dimensions: any, spbSales: any): void {
  // 更新全局数据存储
  if (dimensions) {
    updateProductDataStore({ dimensions });
  }

  const dataSection = document.getElementById('euraflow-data-section');
  if (!dataSection) return;

  // 找到重量行（均价 + 重量）
  const rows = dataSection.querySelectorAll('.ef-row-two');
  for (const row of rows) {
    const cols = row.querySelectorAll('.ef-col');
    if (cols.length === 2) {
      const label1 = cols[0].querySelector('.ef-label');
      const label2 = cols[1].querySelector('.ef-label');

      // 更新重量
      if (label1?.textContent === '均价:' && label2?.textContent === '重量:') {
        const weight = dimensions?.weight ?? spbSales?.weight;
        const weightStr = weight != null ? `${weight}g` : '---';
        const valueSpan = cols[1].querySelector('.ef-value');
        if (valueSpan) valueSpan.textContent = weightStr;
      }

      // 更新尺寸
      if (label1?.textContent === '尺寸:' && label2?.textContent === '模式:') {
        const d = dimensions?.length ?? spbSales?.depth;
        const w = dimensions?.width ?? spbSales?.width;
        const h = dimensions?.height ?? spbSales?.height;
        const dimStr = (d != null && w != null && h != null) ? `${d}×${w}×${h}` : '---';
        const valueSpan = cols[0].querySelector('.ef-value');
        if (valueSpan) valueSpan.textContent = dimStr;
      }
    }
  }
}

/**
 * 更新按钮区域（配置和 OZON 数据加载完成后调用）
 */
export function updateButtonsWithConfig(
  euraflowConfig: any,
  ozonProduct: any,
  spbSales: any
): void {
  const dimensions = ozonProduct?.dimensions || null;

  updateProductDataStore({
    ozonProduct,
    spbSales,
    euraflowConfig,
    dimensions,
  });

  const buttonRow = document.getElementById('euraflow-button-row');
  if (!buttonRow) return;

  const hasDimensions = dimensions &&
    dimensions.weight !== null && dimensions.weight !== undefined;
  const hasSpbDimensions = spbSales &&
    spbSales.weight !== null && spbSales.weight !== undefined;
  const hasAnyDimensions = hasDimensions || hasSpbDimensions;

  // 检查是否已有跟卖按钮
  const existingFollowButton = buttonRow.querySelector('#euraflow-follow');
  if (!existingFollowButton && ozonProduct && hasAnyDimensions) {
    const followButton = createFollowButton();
    buttonRow.appendChild(followButton);
  }

  // 检查是否已有采集按钮
  const existingCollectButton = buttonRow.querySelector('#euraflow-collect');
  if (!existingCollectButton && ozonProduct && euraflowConfig) {
    const collectButton = createCollectButton();
    buttonRow.appendChild(collectButton);
  }

  // 如果有任何按钮，显示按钮行
  if (buttonRow.children.length > 0) {
    buttonRow.style.display = '';

    // 按钮注入完成后，输出最终完整数据
    if (__DEBUG__) {
      console.log('[ProductDataStore] 完整数据:', getProductDataStore());
    }
  }
}

/**
 * 分阶段注入显示组件
 * 阶段1：显示主体（价格+数据区），按钮区域显示加载占位
 * 阶段2：跟卖数据就绪后显示跟卖按钮
 * 阶段3：采集数据就绪后显示采集按钮
 */
export async function injectCompleteDisplay(data: {
  message: string;
  price: number | null;
  ozonProduct: any;
  spbSales: any | null;
  euraflowConfig: any | null;
}): Promise<void> {
  // 注入 EuraFlow 样式（仅注入一次）
  injectEuraflowStyles();

  const { message, price, ozonProduct, spbSales, euraflowConfig } = data;

  // dimensions 直接从 ozonProduct 中获取
  const dimensions = ozonProduct?.dimensions || null;

  // 初始化全局数据存储（上品帮数据作为初始数据）
  updateProductDataStore({
    ozonProduct,
    spbSales,
    euraflowConfig,
    dimensions,
    realPrice: price,
  });

  // 获取目标容器
  const container = document.querySelector('.container') as HTMLElement | null;
  if (!container?.lastChild) return;

  const rightSide = (container.lastChild as HTMLElement).lastChild as HTMLElement | null;
  if (!rightSide?.children || rightSide.children.length === 0) return;

  const targetContainer = (rightSide.children[0] as HTMLElement)?.firstChild as HTMLElement ||
                          (rightSide.children[1] as HTMLElement)?.firstChild as HTMLElement;
  if (!targetContainer) return;

  // 移除已存在的组件
  const existing = document.getElementById(DISPLAY_CONFIG.injectedSectionId);
  if (existing) {
    existing.remove();
  }

  // 创建 EuraFlow 容器
  const euraflowContainer = document.createElement('div');
  euraflowContainer.id = DISPLAY_CONFIG.injectedSectionId;
  euraflowContainer.setAttribute('data-euraflow-root', 'true');  // EuraFlow 根组件标识

  // 【关键】让 Vue 忽略这个节点的 hydration 检查
  // v-pre: Vue 会跳过这个元素及其子元素的编译
  // data-server-rendered: false 告诉 Vue 这不是服务端渲染的内容
  euraflowContainer.setAttribute('v-pre', '');
  euraflowContainer.setAttribute('data-server-rendered', 'false');
  euraflowContainer.setAttribute('data-v-skip-hydration', 'true');

  // 使用 CSS 类
  euraflowContainer.className = 'ef-price-container';

  // 阶段1：先添加价格区和数据区
  euraflowContainer.appendChild(createPriceSection(message));
  euraflowContainer.appendChild(await createDataSection(spbSales, dimensions));

  // 阶段1：创建按钮行容器（先隐藏）
  const buttonRow = document.createElement('div');
  buttonRow.id = 'euraflow-button-row';
  buttonRow.setAttribute('data-euraflow-component', 'button-row');
  buttonRow.className = 'ef-button-row';
  buttonRow.style.display = 'none';  // 初始隐藏
  euraflowContainer.appendChild(buttonRow);

  // 设置高度并注入
  if (rightSide.children[0]?.firstChild) {
    (rightSide.children[0].firstChild as HTMLElement).classList.add('ef-ozon-right-side-fix');
  }
  targetContainer.insertBefore(euraflowContainer, targetContainer.firstElementChild);

  // 阶段2：检查数据就绪后显示按钮
  const checkDataAndShowButtons = () => {
    // 检查跟卖数据是否就绪（需要 ozonProduct 和尺寸信息）
    const hasDimensions = dimensions &&
      dimensions.weight !== null && dimensions.weight !== undefined;
    const hasSpbDimensions = spbSales &&
      spbSales.weight !== null && spbSales.weight !== undefined;
    const hasAnyDimensions = hasDimensions || hasSpbDimensions;

    // 检查采集数据是否就绪
    const hasCollectData = ozonProduct && euraflowConfig;

    // 只要有 ozonProduct 就可以显示按钮
    if (ozonProduct && hasAnyDimensions) {
      // 创建跟卖按钮（从全局存储获取数据）
      const followButton = createFollowButton();
      buttonRow.appendChild(followButton);
    }

    if (hasCollectData) {
      // 创建采集按钮（从全局存储获取数据）
      const collectButton = createCollectButton();
      buttonRow.appendChild(collectButton);
    }

    // 如果有任何按钮，显示按钮行
    if (buttonRow.children.length > 0) {
      buttonRow.style.display = '';  // 显示按钮行
    }
  };

  // 立即检查一次
  checkDataAndShowButtons();

  // 监听组件是否被移除，如果被移除则重新注入（最多重试3次）
  let retryCount = 0;
  const MAX_RETRY = 3;

  const observer = new MutationObserver(() => {
    const componentExists = document.getElementById(DISPLAY_CONFIG.injectedSectionId);

    if (!componentExists && retryCount < MAX_RETRY) {
      retryCount++;
      console.warn(`[EuraFlow] 组件被移除，${500}ms后重新注入 (第${retryCount}次重试)`);

      // 延迟500ms重新注入（避免与OZON的渲染冲突）
      setTimeout(() => {
        if (!document.getElementById(DISPLAY_CONFIG.injectedSectionId)) {
          targetContainer.insertBefore(euraflowContainer, targetContainer.firstElementChild);
        }
      }, 500);
    } else if (!componentExists && retryCount >= MAX_RETRY) {
      console.error('[EuraFlow] 组件被反复移除，停止重试');
      observer.disconnect();
    }
  });

  // 监听父容器的子节点变化
  observer.observe(targetContainer, {
    childList: true,
    subtree: false
  });
}

/**
 * 创建价格区域
 * 显示：标签"价格" + 三个价格标签（绿色/黑色/红色）
 */
function createPriceSection(_message: string): HTMLElement {
  const section = document.createElement('div');
  section.setAttribute('data-euraflow-component', 'price-section');
  section.className = 'ef-price-section';

  const priceDisplay = document.createElement('div');
  priceDisplay.className = 'ef-price-display';

  const label = document.createElement('span');
  label.className = 'ef-price-display__label';
  label.textContent = '价格';

  // 价格标签容器
  const tagsContainer = document.createElement('div');
  tagsContainer.id = 'euraflow-price-tags';
  tagsContainer.className = 'ef-price-tags';
  // 初始显示加载中
  tagsContainer.innerHTML = '<span class="ef-price-tag ef-price-tag--red">---</span>';

  priceDisplay.appendChild(label);
  priceDisplay.appendChild(tagsContainer);
  section.appendChild(priceDisplay);

  return section;
}

/**
 * 创建数据字段区域（de3.png 风格紧凑两列布局）
 */
async function createDataSection(spbSales: any | null, dimensions: any | null): Promise<HTMLElement> {
  // 注入保护性 CSS
  if (!document.getElementById('euraflow-protect-styles')) {
    const style = document.createElement('style');
    style.id = 'euraflow-protect-styles';
    style.textContent = `
      [data-euraflow-root="true"],
      [data-euraflow-component] {
        height: auto !important;
        min-height: unset !important;
        max-height: none !important;
      }
      [data-euraflow-component="data-section"].uw_a4n,
      [data-euraflow-component="data-section"][data-widget="separator"] {
        height: auto !important;
      }
    `;
    document.head.appendChild(style);
  }

  const section = document.createElement('div');
  section.id = 'euraflow-data-section';
  section.setAttribute('data-euraflow-component', 'data-section');
  section.className = 'ef-data-panel';

  // 如果没有数据
  if (!spbSales && !dimensions) {
    const hint = document.createElement('div');
    hint.className = 'ef-data-panel-hint';
    hint.textContent = '数据获取中...';
    section.appendChild(hint);
    return section;
  }

  // 渲染紧凑两列布局
  const rows = buildDataRows(spbSales, dimensions);
  rows.forEach(row => section.appendChild(row));

  return section;
}

/**
 * 构建数据行（de3.png 风格）
 */
function buildDataRows(spbSales: any | null, dimensions: any | null): HTMLElement[] {
  const rows: HTMLElement[] = [];

  // 类目行（单列）- 带 ID 以便后续异步更新
  const categoryRow = createSingleRow('类目', spbSales?.category || '加载中...');
  categoryRow.id = 'ef-category-row';
  rows.push(categoryRow);

  // 品牌行（单列）
  rows.push(createSingleRow('品牌', spbSales?.brand || '---'));

  // 佣金行（三列徽章）
  const rfbs = formatCommissions(spbSales?.rfbsCommissionLow, spbSales?.rfbsCommissionMid, spbSales?.rfbsCommissionHigh);
  const fbp = formatCommissions(spbSales?.fbpCommissionLow, spbSales?.fbpCommissionMid, spbSales?.fbpCommissionHigh);
  rows.push(createBadgeRow('rFBS', rfbs));
  rows.push(createBadgeRow('FBP', fbp));

  // 月销行（两列）
  const monthlySalesNum = spbSales?.monthlySales;
  const monthlySalesStr = monthlySalesNum > 0 ? `${formatNum(monthlySalesNum)}件` : '--';
  const monthlyAmount = formatMoney(spbSales?.monthlySalesAmount);
  rows.push(createTwoColRow('月销', monthlySalesStr, '月销额', monthlyAmount));

  // 日销行（两列）- 根据月销数据计算：月销 / 当天日期
  const dayOfMonth = new Date().getDate();
  const dailySalesNum = monthlySalesNum > 0 ? monthlySalesNum / dayOfMonth : 0;
  const dailySalesStr = dailySalesNum > 0 ? `${dailySalesNum.toFixed(1)}件` : '--';
  const dailyAmount = spbSales?.monthlySalesAmount > 0
    ? formatDailyAmount(spbSales.monthlySalesAmount / dayOfMonth)
    : '--';
  rows.push(createTwoColRow('日销', dailySalesStr, '日销额', dailyAmount));

  // 动态 + 点击率（两列）
  const dynamic = formatPercent(spbSales?.salesDynamic);
  const ctr = formatPercent(spbSales?.clickThroughRate);
  rows.push(createTwoColRow('动态', dynamic, '点击', ctr));

  // 卡片浏览 + 加购率（两列）
  const cardViews = formatNum(spbSales?.cardViews);
  const cardRate = formatPercent(spbSales?.cardAddToCartRate);
  rows.push(createTwoColRow('卡片', cardViews, '加购', cardRate));

  // 搜索浏览 + 加购率（两列）
  const searchViews = formatNum(spbSales?.searchViews);
  const searchRate = formatPercent(spbSales?.searchAddToCartRate);
  rows.push(createTwoColRow('搜索', searchViews, '加购', searchRate));

  // 促销天数 + 折扣（两列）
  const promoDays = spbSales?.promoDays != null ? `${spbSales.promoDays}天` : '---';
  const promoDiscount = formatPercent(spbSales?.promoDiscount);
  rows.push(createTwoColRow('促销', promoDays, '折扣', promoDiscount));

  // 付费推广 + 份额（两列）
  const paidDays = spbSales?.paidPromoDays != null ? `${spbSales.paidPromoDays}天` : '---';
  const adShare = formatPercent(spbSales?.adShare);
  rows.push(createTwoColRow('付费', paidDays, '份额', adShare));

  // 成交率 + 退货率（两列）
  const convRate = formatPercent(spbSales?.transactionRate);
  const returnRate = formatPercent(spbSales?.returnCancelRate);
  rows.push(createTwoColRow('成交', convRate, '退取', returnRate));

  // 均价 + 重量（两列）
  const avgPrice = formatMoney(spbSales?.avgPrice);
  const weight = dimensions?.weight ?? spbSales?.weight;
  const weightStr = weight != null ? `${weight}g` : '---';
  rows.push(createTwoColRow('均价', avgPrice, '重量', weightStr));

  // 尺寸 + 模式（两列）
  const dim = formatDimensions(dimensions, spbSales);
  const mode = spbSales?.sellerMode || '---';
  rows.push(createTwoColRow('尺寸', dim, '模式', mode));

  // 跟卖 + 最低价（两列）- 支持异步加载
  const follower = spbSales?.competitorCount;
  // 初始显示 ---，等 API 查询完成后由 updateFollowSellerData 更新为实际值或"无跟卖"
  const followerStr = follower != null && follower > 0 ? `${follower}家` : '---';

  // 最低跟卖价：仅使用 OZON 跟卖数据的 followSellerPrices
  // followSellerPrices 存在表示 OZON API 成功，空数组表示无跟卖
  // followSellerPrices 不存在表示 OZON API 失败，显示 ---
  let minPrice: number | null = null;
  if (spbSales?.followSellerPrices?.length > 0) {
    const prices = spbSales.followSellerPrices.filter((p: number) => p > 0);
    if (prices.length > 0) {
      minPrice = Math.min(...prices);
    }
  }
  const minPriceStr = minPrice != null ? `${minPrice.toFixed(2)}¥` : '---';

  // 创建跟卖行（带 id 便于后续更新）
  if (follower != null && follower > 0) {
    // 使用带悬浮窗口的跟卖行
    rows.push(createFollowerRow(follower, followerStr, minPriceStr, spbSales?.followSellerList));
  } else {
    // 单列显示（加载中或无跟卖）
    const followerRow = createSingleRow('跟卖', followerStr);
    followerRow.id = 'ef-follower-row';  // 添加 id 便于后续更新
    rows.push(followerRow);
  }

  // 底部行：评分 + 上架时间（两列）
  const rating = spbSales?.rating;
  const reviewCount = spbSales?.reviewCount;
  const listingDate = spbSales?.listingDate ? formatDate(spbSales.listingDate) : '---';
  const listingDays = spbSales?.listingDays;
  rows.push(createBottomRow(rating, reviewCount, listingDate, listingDays));

  return rows;
}

/**
 * 创建单列行
 */
function createSingleRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ef-row ef-row-single';
  row.innerHTML = `<span class="ef-label">${label}:</span><span class="ef-value">${value}</span>`;
  return row;
}

/**
 * 创建两列行
 */
function createTwoColRow(label1: string, value1: string, label2: string, value2: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ef-row ef-row-two';
  row.innerHTML = `
    <div class="ef-col"><span class="ef-label">${label1}:</span><span class="ef-value">${value1}</span></div>
    <div class="ef-col"><span class="ef-label">${label2}:</span><span class="ef-value">${value2}</span></div>
  `;
  return row;
}

/**
 * 创建三列徽章行（佣金）
 */
function createBadgeRow(label: string, badges: string[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ef-row ef-row-three';
  const badgesHtml = badges.map(b => `<span class="ef-badge">${b}</span>`).join('');
  row.innerHTML = `<span class="ef-label">${label}:</span><span class="ef-badges">${badgesHtml}</span>`;
  return row;
}

/**
 * 创建底部行（评分 + 日期）
 */
function createBottomRow(rating: number | null, reviewCount: number | null, date: string, days: number | null): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ef-row ef-row-bottom';

  // 评分
  let ratingHtml = '<div class="ef-col"><span class="ef-label">评分:</span>';
  if (rating != null) {
    const stars = '★'.repeat(Math.round(rating));
    const reviewStr = reviewCount != null ? `(${reviewCount})` : '';
    ratingHtml += `<span class="ef-rating" title="评分: ${rating}">${stars}${rating} ${reviewStr}</span>`;
  } else {
    ratingHtml += '<span class="ef-value">---</span>';
  }
  ratingHtml += '</div>';

  // 日期
  const dateTitle = days != null ? `上架${days}天` : '上架时间';
  const dateHtml = `<div class="ef-col"><span class="ef-label">上架:</span><span class="ef-date" title="${dateTitle}">${date}</span></div>`;

  row.innerHTML = ratingHtml + dateHtml;
  return row;
}

/**
 * 创建跟卖行（带悬浮窗口）
 */
function createFollowerRow(_count: number, countStr: string, minPriceStr: string, sellerList: any[] | null): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ef-row ef-row-two';
  row.id = 'ef-follower-row';  // 添加 id 便于后续更新

  // 左列：跟卖数量（可点击显示悬浮窗口）
  const leftCol = document.createElement('div');
  leftCol.className = 'ef-col';

  const label = document.createElement('span');
  label.className = 'ef-label';
  label.textContent = '跟卖:';

  const valueWrapper = document.createElement('span');
  valueWrapper.className = 'ef-follower-value';
  valueWrapper.style.cssText = 'position: relative; display: inline-block;';

  const valueSpan = document.createElement('span');
  valueSpan.className = 'ef-value ef-value-clickable';
  valueSpan.textContent = countStr;
  valueSpan.style.cssText = 'color: #005bff; cursor: pointer; text-decoration: underline;';

  // 悬浮窗口容器
  const popover = createFollowerPopover(sellerList);
  popover.style.display = 'none';

  // 鼠标事件
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  const showPopover = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    popover.style.display = 'block';
  };

  const hidePopover = () => {
    hideTimeout = setTimeout(() => {
      popover.style.display = 'none';
    }, 200);
  };

  valueSpan.addEventListener('mouseenter', showPopover);
  valueSpan.addEventListener('mouseleave', hidePopover);
  popover.addEventListener('mouseenter', showPopover);
  popover.addEventListener('mouseleave', hidePopover);

  valueWrapper.appendChild(valueSpan);
  valueWrapper.appendChild(popover);
  leftCol.appendChild(label);
  leftCol.appendChild(valueWrapper);

  // 右列：最低价
  const rightCol = document.createElement('div');
  rightCol.className = 'ef-col';
  rightCol.innerHTML = `<span class="ef-label">最低价:</span><span class="ef-value">${minPriceStr}</span>`;

  row.appendChild(leftCol);
  row.appendChild(rightCol);

  return row;
}

/**
 * 创建跟卖者悬浮窗口
 */
function createFollowerPopover(sellerList: any[] | null): HTMLElement {
  const popover = document.createElement('div');
  popover.className = 'ef-follower-popover';

  if (!sellerList || sellerList.length === 0) {
    popover.innerHTML = '<div class="ef-follower-popover__empty">暂无跟卖数据</div>';
    return popover;
  }

  // 创建表格
  const table = document.createElement('table');
  table.className = 'ef-follower-popover__table';

  // 表头
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr class="ef-follower-popover__thead-row">
      <th class="ef-follower-popover__th ef-follower-popover__th--avatar">头像</th>
      <th class="ef-follower-popover__th ef-follower-popover__th--name">卖家名称</th>
      <th class="ef-follower-popover__th ef-follower-popover__th--rating">评分</th>
      <th class="ef-follower-popover__th ef-follower-popover__th--region">地区</th>
      <th class="ef-follower-popover__th ef-follower-popover__th--sku">商品SKU</th>
      <th class="ef-follower-popover__th ef-follower-popover__th--price">售价</th>
    </tr>
  `;
  table.appendChild(thead);

  // 表体
  const tbody = document.createElement('tbody');

  sellerList.forEach((seller, index) => {
    const tr = document.createElement('tr');
    tr.className = `ef-follower-popover__row${index % 2 === 1 ? ' ef-follower-popover__row--odd' : ''}`;

    // 头像
    const logoUrl = seller.logoImageUrl || '';
    const logoHtml = logoUrl
      ? `<img src="${logoUrl}" class="ef-follower-popover__avatar" onerror="this.style.display='none'">`
      : '<div class="ef-follower-popover__avatar-placeholder"></div>';

    // 卖家名称（可点击跳转）
    const sellerLink = seller.link || '#';
    const sellerName = seller.name || '未知卖家';

    // 评分（从 rating 提取）
    let ratingHtml = '<span class="ef-follower-popover__rating--empty">---</span>';
    if (seller.rating) {
      const score = seller.rating.totalScore ?? seller.rating.score ?? null;
      const reviews = seller.rating.reviewsCount ?? seller.rating.count ?? 0;
      if (score !== null) {
        // 星星颜色：5分金色，4-4.9橙色，其他灰色
        const ratingClass = score >= 5 ? 'gold' : score >= 4 ? 'orange' : 'gray';
        const scoreStr = Number(score).toFixed(1);
        ratingHtml = `<span class="ef-follower-popover__rating--${ratingClass}">★${scoreStr}</span><span class="ef-follower-popover__rating-count">(${reviews})</span>`;
      }
    }

    // 地区（从 credentials 提取，找包含 CN 的行）
    let region = '未知';
    if (seller.credentials && Array.isArray(seller.credentials)) {
      const cnLine = seller.credentials.find((c: string) => c.includes('CN,'));
      if (cnLine) {
        region = '中国';
      } else if (seller.credentials.some((c: string) => c.includes('RU,'))) {
        region = '俄罗斯';
      }
    }

    // SKU
    const sku = seller.sku || '---';
    const productLink = seller.productLink || '#';

    // 价格（从 cardPrice 或 price 提取）
    let priceStr = '---';
    if (seller.price?.cardPrice?.price) {
      priceStr = seller.price.cardPrice.price;
    } else if (seller.price?.price) {
      priceStr = seller.price.price;
    }

    tr.innerHTML = `
      <td class="ef-follower-popover__td">${logoHtml}</td>
      <td class="ef-follower-popover__td"><a href="${sellerLink}" target="_blank" class="ef-follower-popover__link ef-follower-popover__link--name">${sellerName}</a></td>
      <td class="ef-follower-popover__td ef-follower-popover__td--center">${ratingHtml}</td>
      <td class="ef-follower-popover__td ef-follower-popover__td--center">${region}</td>
      <td class="ef-follower-popover__td ef-follower-popover__td--center"><a href="${productLink}" target="_blank" class="ef-follower-popover__link">${sku}</a></td>
      <td class="ef-follower-popover__td ef-follower-popover__td--right ef-follower-popover__price">${priceStr}</td>
    `;

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  popover.appendChild(table);

  return popover;
}

/**
 * 格式化佣金数组
 */
function formatCommissions(low: number | null, mid: number | null, high: number | null): string[] {
  const format = (v: number | null) => v != null ? `${v}` : '-';
  return [format(low), format(mid), format(high)];
}

/**
 * 格式化数字
 */
function formatNum(value: any): string {
  if (value == null) return '---';
  if (typeof value === 'number') {
    if (value >= 10000) return `${(value / 10000).toFixed(2)}万`;
    return String(value);
  }
  return String(value);
}

/**
 * 格式化金额
 */
function formatMoney(value: any): string {
  if (value == null) return '---';
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return '---';
  if (num >= 10000) return `${(num / 10000).toFixed(2)}万₽`;
  return `${num.toFixed(2)}₽`;
}

/**
 * 格式化日销额（精确到1位小数）
 */
function formatDailyAmount(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万₽`;
  return `${value.toFixed(1)}₽`;
}

/**
 * 格式化百分比
 */
function formatPercent(value: any): string {
  if (value == null) return '---';
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return '---';
  // 如果值小于1，可能是小数形式的百分比
  if (num < 1 && num > 0) return `${(num * 100).toFixed(2)}%`;
  return `${num}%`;
}

/**
 * 格式化尺寸
 */
function formatDimensions(dimensions: any, spbSales: any): string {
  const d = dimensions?.length ?? spbSales?.depth;
  const w = dimensions?.width ?? spbSales?.width;
  const h = dimensions?.height ?? spbSales?.height;
  if (d == null || w == null || h == null) return '---';
  return `${d}×${w}×${h}`;
}

/**
 * 创建"跟卖"按钮
 * 点击时从全局数据存储获取最新最全的数据
 */
function createFollowButton(): HTMLButtonElement {
  const followButton = document.createElement('button');
  followButton.id = 'euraflow-follow-sell';
  followButton.setAttribute('type', 'button');
  followButton.className = 'ef-follow-button';
  followButton.textContent = '跟卖';

  // 事件处理
  followButton.addEventListener('click', async () => {
    try {
      // 从全局存储获取最新数据
      const store = getProductDataStore();
      const { ozonProduct, spbSales, dimensions, realPrice } = store;

      // 优先使用 dimensions（OZON Seller API），fallback 到 spbSales（上品帮）
      const hasDimensions = dimensions &&
        dimensions.weight !== null && dimensions.weight !== undefined &&
        dimensions.height !== null && dimensions.height !== undefined &&
        dimensions.width !== null && dimensions.width !== undefined &&
        dimensions.length !== null && dimensions.length !== undefined;

      const hasSpbSales = spbSales &&
        spbSales.weight !== null && spbSales.weight !== undefined &&
        spbSales.height !== null && spbSales.height !== undefined &&
        spbSales.width !== null && spbSales.width !== undefined &&
        spbSales.depth !== null && spbSales.depth !== undefined;

      if (!ozonProduct) {
        alert('商品数据不完整，请刷新页面重试');
        return;
      }

      if (!hasDimensions && !hasSpbSales) {
        alert('商品数据不完整（缺少尺寸和重量信息），请通过其它插件上架');
        return;
      }

      // 构建 finalDimensions：优先 dimensions，fallback 到 spbSales
      const finalDimensions = hasDimensions ? dimensions : {
        weight: spbSales.weight,
        height: spbSales.height,
        width: spbSales.width,
        length: spbSales.depth  // spbSales 的长度字段是 depth
      };

      // 使用计算出的真实售价，而不是 OZON 的绿色价格
      // 主图获取优先级：上品帮 photo → ozonProduct.primary_image → images[0]
      const primaryImage = spbSales?.photo
        || ozonProduct?.primary_image
        || ozonProduct?.images?.[0]?.url
        || null;

      // 计算最低跟卖价：从全局存储的 followSellerPrices 获取（OZON 跟卖 API 返回）
      let minFollowPrice: number | null = null;
      if (spbSales?.followSellerPrices?.length > 0) {
        const prices = spbSales.followSellerPrices.filter((p: number) => p > 0);
        if (prices.length > 0) {
          minFollowPrice = Math.min(...prices);
        }
      }

      const productData = {
        ...ozonProduct,
        dimensions: finalDimensions,  // 确保包含尺寸数据
        realPrice: realPrice,  // 真实售价（新字段，不覆盖原有价格）
        primary_image: primaryImage
      };
      showPublishModal(productData, realPrice, minFollowPrice);
    } catch (error) {
      console.error('[EuraFlow] 打开跟卖弹窗失败:', error);
      alert('打开上架配置失败，请稍后重试');
    }
  });

  return followButton;
}

/**
 * 创建"采集"按钮
 * 点击时从全局数据存储获取最新最全的数据
 */
function createCollectButton(): HTMLButtonElement {
  const collectButton = document.createElement('button');
  collectButton.id = 'euraflow-collect';
  collectButton.setAttribute('type', 'button');
  collectButton.className = 'ef-collect-button';
  collectButton.textContent = '采集';

  // 事件处理
  collectButton.addEventListener('click', async () => {
    try {
      // 从全局存储获取最新数据
      const store = getProductDataStore();
      const { ozonProduct, spbSales, dimensions, euraflowConfig, realPrice } = store;

      // 优先使用 dimensions（OZON Seller API），fallback 到 spbSales（上品帮）
      const hasDimensions = dimensions &&
        dimensions.weight !== null && dimensions.weight !== undefined &&
        dimensions.height !== null && dimensions.height !== undefined &&
        dimensions.width !== null && dimensions.width !== undefined &&
        dimensions.length !== null && dimensions.length !== undefined;

      const hasSpbSales = spbSales &&
        spbSales.weight !== null && spbSales.weight !== undefined &&
        spbSales.height !== null && spbSales.height !== undefined &&
        spbSales.width !== null && spbSales.width !== undefined &&
        spbSales.depth !== null && spbSales.depth !== undefined;

      if (!ozonProduct) {
        alert('商品数据不完整，请刷新页面重试');
        return;
      }

      if (!hasDimensions && !hasSpbSales) {
        alert('商品数据不完整（缺少尺寸和重量信息），请通过其它插件上架');
        return;
      }

      if (!euraflowConfig?.apiUrl || !euraflowConfig?.apiKey) {
        alert('API未配置，请先在扩展设置中配置API');
        return;
      }

      // 构建 finalDimensions：优先 dimensions，fallback 到 spbSales
      const finalDimensions = hasDimensions ? dimensions : {
        weight: spbSales.weight,
        height: spbSales.height,
        width: spbSales.width,
        length: spbSales.depth  // spbSales 的长度字段是 depth
      };

      // 检测描述中是否有外链
      const description = ozonProduct?.description || '';
      let finalDescription = description;

      if (hasExternalLinks(description)) {
        // 显示确认弹窗，让用户检查/编辑描述
        const result = await showCollectConfirmModal(description);
        if (!result.confirmed) {
          // 用户取消采集
          return;
        }
        // 使用编辑后的描述
        finalDescription = result.editedDescription || description;
      }

      // 直接发送采集请求，不打开弹窗
      collectButton.disabled = true;
      collectButton.classList.add('ef-collect-button--disabled');
      collectButton.textContent = '采集中...';

      // 通过 background service worker 发送请求（避免 CORS）
      // 构建采集数据：
      // 1. 保留所有价格字段：price, realPrice, cardPrice
      // 2. 移除不必要字段：barcode, primary_image(顶层), category_level_*, category_path
      // 3. 确保 sku 字段存在（使用 ozon_product_id）
      const {
        barcode: _barcode,
        primary_image: _primaryImage,
        category_level_1: _catLevel1,
        category_level_2: _catLevel2,
        category_level_3: _catLevel3,
        category_path: _catPath,
        ...cleanedOzonProduct
      } = ozonProduct || {};

      const productData = {
        ...cleanedOzonProduct,
        sku: ozonProduct?.sku || ozonProduct?.ozon_product_id || null,  // 确保 sku 字段存在
        dimensions: finalDimensions,  // 使用确定的尺寸数据
        price: ozonProduct?.price ?? null,  // OZON 黑色价格
        cardPrice: ozonProduct?.cardPrice ?? null,  // OZON 绿色价格（Ozon卡价格）
        realPrice: realPrice ?? null,  // 计算出的真实售价
        description: finalDescription  // 使用可能被编辑的描述
      };
      const response = await chrome.runtime.sendMessage({
        type: 'COLLECT_PRODUCT',
        data: {
          apiUrl: euraflowConfig.apiUrl,
          apiKey: euraflowConfig.apiKey,
          source_url: window.location.href,
          product_data: productData
        }
      });

      if (!response.success) {
        throw new Error(response.error || '采集失败');
      }

      showToast('商品已采集，请到系统采集记录中查看', 'success');
    } catch (error) {
      console.error('[EuraFlow] 采集失败:', error);
      showToast('采集失败：' + (error as Error).message, 'error');
    } finally {
      collectButton.disabled = false;
      collectButton.classList.remove('ef-collect-button--disabled');
      collectButton.classList.add('ef-collect-button--enabled');
      collectButton.textContent = '采集';
    }
  });

  return collectButton;
}

/**
 * 移除显示元素
 */
export function removeDisplay(): void {
  const euraflowSection = document.getElementById(
    DISPLAY_CONFIG.injectedSectionId
  );
  if (euraflowSection) {
    euraflowSection.remove();
  }
}

/**
 * 获取目标容器元素（用于检查页面是否准备好）
 * 参考上品帮的逻辑
 */
export function getTargetContainer(): Element | null {
  const container = document.querySelector('.container') as HTMLElement | null;
  if (!container || !container.lastChild) return null;

  const rightSide = (container.lastChild as HTMLElement).lastChild as HTMLElement | null;
  if (!rightSide || !rightSide.children || rightSide.children.length === 0) return null;

  return (rightSide.children[0] as HTMLElement)?.firstChild as HTMLElement ||
         (rightSide.children[1] as HTMLElement)?.firstChild as HTMLElement ||
         null;
}
