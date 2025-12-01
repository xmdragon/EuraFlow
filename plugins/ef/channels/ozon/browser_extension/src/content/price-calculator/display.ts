/**
 * OZON 真实售价计算器 - 显示注入（整合上品帮数据）
 *
 * 在页面上注入和管理价格显示元素 + 上品帮销售数据面板
 */

import { showPublishModal } from '../components/PublishModal';
import { injectEuraflowStyles } from '../styles/injector';

// ========== 配置常量 ==========
const DISPLAY_CONFIG = {
  // 使用 OZON 风格的命名
  injectedElementId: 'euraflow-widget-price',
  injectedSectionId: 'euraflow-section',
};

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
 * 一次性注入完整显示组件（无骨架屏，等待所有数据后再注入）
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

  // 添加三个部分
  euraflowContainer.appendChild(createPriceSection(message));
  euraflowContainer.appendChild(await createDataSection(spbSales, dimensions));
  euraflowContainer.appendChild(createButtonRow(price, ozonProduct, spbSales, dimensions, euraflowConfig));

  // 设置高度并注入
  if (rightSide.children[0]?.firstChild) {
    (rightSide.children[0].firstChild as HTMLElement).classList.add('ef-ozon-right-side-fix');
  }
  targetContainer.insertBefore(euraflowContainer, targetContainer.firstElementChild);

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
 * 创建真实售价区域
 */
function createPriceSection(message: string): HTMLElement {
  const section = document.createElement('div');
  section.setAttribute('data-euraflow-component', 'price-section');
  section.className = 'ef-price-section';

  const priceDisplay = document.createElement('div');
  priceDisplay.className = 'ef-price-display';

  const label = document.createElement('span');
  label.className = 'ef-price-display__label';
  label.textContent = '真实售价';

  const value = document.createElement('span');
  value.id = 'euraflow-real-price';
  value.className = 'ef-price-display__value';
  value.textContent = message.replace('真实售价：', '');

  priceDisplay.appendChild(label);
  priceDisplay.appendChild(value);
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

  // 类目行（单列）
  rows.push(createSingleRow('类目', spbSales?.category || '---'));

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

  // 跟卖 + 最低价（两列）
  const follower = spbSales?.competitorCount;
  const followerStr = follower != null && follower > 0 ? `${follower}家` : '无跟卖';

  // 最低跟卖价：优先用 competitorMinPrice，其次从 followSellerPrices 取最小值
  let minPrice = spbSales?.competitorMinPrice;
  if (minPrice == null && spbSales?.followSellerPrices?.length > 0) {
    const prices = spbSales.followSellerPrices.filter((p: number) => p > 0);
    if (prices.length > 0) {
      minPrice = Math.min(...prices);
    }
  }
  const minPriceStr = minPrice != null ? `${minPrice.toFixed(2)}¥` : '---';

  // 只有有跟卖时才显示最低价，否则显示单列
  if (follower != null && follower > 0) {
    rows.push(createTwoColRow('跟卖', followerStr, '最低价', minPriceStr));
  } else {
    rows.push(createSingleRow('跟卖', followerStr));
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
 * 创建按钮行
 */
function createButtonRow(
  realPrice: number | null,
  ozonProduct: any,
  spbSales: any | null,
  dimensions: any | null,
  euraflowConfig: any | null
): HTMLElement {
  const buttonRow = document.createElement('div');
  buttonRow.id = 'euraflow-button-row';
  buttonRow.setAttribute('data-euraflow-component', 'button-row');
  buttonRow.className = 'ef-button-row';

  // 创建"跟卖"按钮
  const followButton = createFollowButton(realPrice, ozonProduct, spbSales, dimensions);
  buttonRow.appendChild(followButton);

  // 创建"采集"按钮
  const collectButton = createCollectButton(realPrice, ozonProduct, spbSales, dimensions, euraflowConfig);
  buttonRow.appendChild(collectButton);

  return buttonRow;
}

/**
 * 创建"跟卖"按钮
 */
function createFollowButton(
  realPrice: number | null,
  ozonProduct: any,
  spbSales: any | null,
  dimensions: any | null
): HTMLButtonElement {
  const followButton = document.createElement('button');
  followButton.id = 'euraflow-follow-sell';
  followButton.setAttribute('type', 'button');
  followButton.className = 'ef-follow-button';
  followButton.textContent = '跟卖';

  // 事件处理
  followButton.addEventListener('click', async () => {
    try {
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

      // 计算最低跟卖价：优先用 competitorMinPrice，其次从 followSellerPrices 取最小值
      let minFollowPrice: number | null = spbSales?.competitorMinPrice ?? null;
      if (minFollowPrice == null && spbSales?.followSellerPrices?.length > 0) {
        const prices = spbSales.followSellerPrices.filter((p: number) => p > 0);
        if (prices.length > 0) {
          minFollowPrice = Math.min(...prices);
        }
      }

      const productData = {
        ...ozonProduct,
        dimensions: finalDimensions,  // 确保包含尺寸数据
        price: realPrice,  // 使用真实售价
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
 */
function createCollectButton(
  realPrice: number | null,
  ozonProduct: any,
  spbSales: any | null,
  dimensions: any | null,
  euraflowConfig: any | null
): HTMLButtonElement {
  const collectButton = document.createElement('button');
  collectButton.id = 'euraflow-collect';
  collectButton.setAttribute('type', 'button');
  collectButton.className = 'ef-collect-button';
  collectButton.textContent = '采集';

  // 事件处理
  collectButton.addEventListener('click', async () => {
    try {
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

      // 直接发送采集请求，不打开弹窗
      collectButton.disabled = true;
      collectButton.classList.add('ef-collect-button--disabled');
      collectButton.textContent = '采集中...';

      // 通过 background service worker 发送请求（避免 CORS）
      // 使用计算出的真实售价，而不是 OZON 的绿色价格
      const productData = {
        ...ozonProduct,
        dimensions: finalDimensions,  // 使用确定的尺寸数据
        price: realPrice  // 使用真实售价
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
