/**
 * OZON 真实售价计算器 - 显示注入（整合上品帮数据）
 *
 * 在页面上注入和管理价格显示元素 + 上品帮销售数据面板
 */

import { getDataPanelConfig } from '../../shared/storage';
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
 * 格式化数值（处理null和百分比）
 */
function formatValue(value: any, suffix: string = ''): string {
  if (value === null || value === undefined) {
    return '---';
  }
  if (typeof value === 'number') {
    return `${value}${suffix}`;
  }
  return String(value);
}

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
 * 格式化包装尺寸
 */
function formatDimensions(
  length: number | null,
  width: number | null,
  height: number | null
): string {
  if (length === null || width === null || height === null) {
    return '---';
  }
  return `${length} × ${width} × ${height} mm`;
}

/**
 * 渲染数据字段（label + value）
 */
function renderField(label: string, value: string): HTMLElement {
  const field = document.createElement('div');
  field.className = 'ef-price-field';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'ef-price-field__label';
  labelSpan.textContent = label;

  const valueSpan = document.createElement('span');
  valueSpan.className = 'ef-price-field__value';
  valueSpan.textContent = value;

  field.appendChild(labelSpan);
  field.appendChild(valueSpan);

  return field;
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
 * 创建数据字段区域
 */
async function createDataSection(spbSales: any | null, dimensions: any | null): Promise<HTMLElement> {
  // 注入保护性 CSS（使用 !important 防止被 OZON 脚本覆盖）
  if (!document.getElementById('euraflow-protect-styles')) {
    const style = document.createElement('style');
    style.id = 'euraflow-protect-styles';
    style.textContent = `
      /* 保护所有 EuraFlow 组件不被 OZON 脚本修改 */
      [data-euraflow-root="true"],
      [data-euraflow-component] {
        height: auto !important;
        min-height: unset !important;
        max-height: none !important;
      }
      /* 即使被 OZON 添加了 separator 类，也强制保持高度为 auto */
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
  section.className = 'ef-data-panel-section';

  // 获取配置的可见字段
  const config = await getDataPanelConfig();
  const visibleFields = config.visibleFields;

  // 渲染配置的字段
  for (const fieldKey of visibleFields) {
    const field = renderDataField(fieldKey, spbSales, dimensions);
    if (field) {
      section.appendChild(field);
    }
  }

  // 如果没有渲染任何字段，显示提示
  if (section.children.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'ef-data-panel-hint';
    hint.textContent = spbSales || dimensions ? '暂无可显示的数据' : '数据获取中...';
    section.appendChild(hint);
  }

  return section;
}

/**
 * 渲染单个数据字段
 */
function renderDataField(fieldKey: string, spbSales: any | null, dimensions: any | null): HTMLElement | null {
  const FIELD_LABELS: Record<string, string> = {
    monthlySales: '月销量',
    monthlySalesAmount: '月销售额',
    cardViews: '浏览量',
    transactionRate: '成交率',
    packageWeight: '包装重量',
    packageLength: '长度',
    packageWidth: '宽度',
    packageHeight: '高度',
    listingDate: '上架时间',
    listingDays: '上架天数',
  };

  const label = FIELD_LABELS[fieldKey];
  if (!label) return null;

  let value: string;
  switch (fieldKey) {
    case 'monthlySales':
      value = spbSales ? formatValue(spbSales.monthlySales, ' 件') : '---';
      break;
    case 'monthlySalesAmount':
      value = spbSales ? formatValue(spbSales.monthlySalesAmount, ' ₽') : '---';
      break;
    case 'cardViews':
      value = spbSales ? formatValue(spbSales.cardViews) : '---';
      break;
    case 'transactionRate':
      if (spbSales && spbSales.transactionRate !== null) {
        const rate = (spbSales.transactionRate * 100).toFixed(1);
        value = `${rate}%`;
      } else {
        value = '---';
      }
      break;
    case 'packageWeight':
      // 优先使用 dimensions（来自 OZON Seller API）
      if (dimensions?.weight !== undefined && dimensions.weight !== null) {
        value = formatValue(dimensions.weight, ' g');
      } else if (spbSales) {
        value = formatValue(spbSales.weight, ' g');
      } else {
        value = '---';
      }
      break;
    case 'packageLength':
    case 'packageWidth':
    case 'packageHeight':
      // 合并显示尺寸 - 优先使用 dimensions（来自 OZON Seller API）
      if (fieldKey === 'packageLength') {
        if (dimensions?.length !== undefined && dimensions.length !== null) {
          value = formatDimensions(dimensions.length, dimensions.width, dimensions.height);
        } else if (spbSales) {
          value = formatDimensions(spbSales.depth, spbSales.width, spbSales.height);
        } else {
          value = '---';
        }
        return renderField('包装尺寸', value);
      }
      return null;  // 其他维度跳过
    case 'listingDate':
      value = spbSales ? formatDate(spbSales.listingDate) : '---';
      break;
    case 'listingDays':
      value = spbSales ? formatValue(spbSales.listingDays, ' 天') : '---';
      break;
    default:
      value = '---';
  }

  return renderField(label, value);
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
  const collectButton = createCollectButton(realPrice, ozonProduct, dimensions, euraflowConfig);
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
      if (!ozonProduct || !dimensions) {
        alert('商品数据不完整（缺少尺寸和重量信息），请通过其它插件上架');
        return;
      }

      if (dimensions.weight === null || dimensions.height === null ||
          dimensions.width === null || dimensions.length === null) {
        alert('尺寸和重量数据不完整，请稍后重试');
        return;
      }

      // 使用计算出的真实售价，而不是 OZON 的绿色价格
      // ozonProduct 已经包含 dimensions，不需要单独传递
      const productData = {
        ...ozonProduct,
        price: realPrice,  // 使用真实售价
        primary_image: spbSales?.photo || null  // 使用上品帮的主图（photo 字段）
      };
      showPublishModal(productData, realPrice);
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
      if (!ozonProduct || !dimensions) {
        alert('商品数据不完整（缺少尺寸和重量信息），请通过其它插件上架');
        return;
      }

      if (dimensions.weight === null || dimensions.height === null ||
          dimensions.width === null || dimensions.length === null) {
        alert('尺寸和重量数据不完整，请稍后重试');
        return;
      }

      if (!euraflowConfig?.apiUrl || !euraflowConfig?.apiKey) {
        alert('API未配置，请先在扩展设置中配置API');
        return;
      }

      // 直接发送采集请求，不打开弹窗
      collectButton.disabled = true;
      collectButton.classList.add('ef-collect-button--disabled');
      collectButton.textContent = '采集中...';

      // 通过 background service worker 发送请求（避免 CORS）
      // 使用计算出的真实售价，而不是 OZON 的绿色价格
      const productData = {
        ...ozonProduct,
        dimensions,
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
