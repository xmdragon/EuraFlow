/**
 * OZON 真实售价计算器 - 显示注入（整合上品帮数据）
 *
 * 在页面上注入和管理价格显示元素 + 上品帮销售数据面板
 */

import { getDataPanelConfig } from '../../shared/storage';

// ========== 配置常量 ==========
const DISPLAY_CONFIG = {
  // 使用 OZON 风格的命名
  injectedElementId: 'euraflow-widget-price',
  injectedSectionId: 'euraflow-section',
};

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
  field.style.display = 'flex';
  field.style.justifyContent = 'space-between';
  field.style.alignItems = 'center';
  field.style.padding = '6px 0';
  field.style.borderBottom = '1px solid #f0f0f0';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'tsBody400Medium';
  labelSpan.style.color = '#757575';
  labelSpan.textContent = label;

  const valueSpan = document.createElement('span');
  valueSpan.className = 'tsBody500Medium';
  valueSpan.style.color = '#212121';
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
  dimensions: any | null;
  euraflowConfig: any | null;
}): Promise<void> {
  const { message, price, ozonProduct, spbSales, dimensions, euraflowConfig } = data;

  // 获取目标容器
  const container = document.querySelector('.container') as HTMLElement | null;
  if (!container?.lastChild) {
    console.log('[EuraFlow] 未找到 .container');
    return;
  }

  const rightSide = (container.lastChild as HTMLElement).lastChild as HTMLElement | null;
  if (!rightSide?.children || rightSide.children.length === 0) {
    console.log('[EuraFlow] 未找到右侧容器');
    return;
  }

  const targetContainer = (rightSide.children[0] as HTMLElement)?.firstChild as HTMLElement ||
                          (rightSide.children[1] as HTMLElement)?.firstChild as HTMLElement;
  if (!targetContainer) {
    console.log('[EuraFlow] 未找到目标容器');
    return;
  }

  // 移除已存在的组件
  const existing = document.getElementById(DISPLAY_CONFIG.injectedSectionId);
  if (existing) {
    existing.remove();
  }

  // 创建 EuraFlow 容器
  const euraflowContainer = document.createElement('div');
  euraflowContainer.id = DISPLAY_CONFIG.injectedSectionId;
  euraflowContainer.setAttribute('data-euraflow-root', 'true');  // EuraFlow 根组件标识
  euraflowContainer.setAttribute('data-widget', 'webPdpGrid');
  euraflowContainer.className = 'pdp_as2 pdp_sa8 pdp_sa5 pdp_as6';
  euraflowContainer.style.padding = '8px 0px';
  euraflowContainer.style.width = '388px';

  // 添加三个部分
  euraflowContainer.appendChild(createPriceSection(message));
  euraflowContainer.appendChild(await createDataSection(spbSales, dimensions));
  euraflowContainer.appendChild(createButtonRow(price, ozonProduct, dimensions, euraflowConfig));

  // 设置高度并注入
  if (rightSide.children[0]?.firstChild) {
    (rightSide.children[0].firstChild as HTMLElement).style.height = 'auto';
  }
  targetContainer.insertBefore(euraflowContainer, targetContainer.firstElementChild);

  console.log('[EuraFlow] 组件注入完成');
}

/**
 * 创建真实售价区域
 */
function createPriceSection(message: string): HTMLElement {
  const section = document.createElement('div');
  section.setAttribute('data-euraflow-component', 'price-section');
  section.style.padding = '8px 0';
  section.style.marginBottom = '12px';
  section.style.borderBottom = '2px solid #D84315';

  const priceDisplay = document.createElement('div');
  priceDisplay.style.display = 'flex';
  priceDisplay.style.alignItems = 'center';
  priceDisplay.style.justifyContent = 'space-between';

  const label = document.createElement('span');
  label.className = 'tsBody500Medium';
  label.style.color = '#757575';
  label.textContent = '真实售价';

  const value = document.createElement('span');
  value.id = 'euraflow-real-price';
  value.className = 'tsHeadline500Medium';
  value.style.color = '#D84315';
  value.style.fontSize = '20px';
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
  section.style.padding = '8px 0';
  section.style.marginBottom = '12px';

  // 获取配置的可见字段
  const config = await getDataPanelConfig();
  const visibleFields = config.visibleFields;

  console.log('[EuraFlow Display] 开始渲染数据字段', {
    spbSales: spbSales ? '有数据' : 'null',
    dimensions: dimensions ? '有数据' : 'null',
    visibleFields
  });

  // 渲染配置的字段
  for (const fieldKey of visibleFields) {
    const field = renderDataField(fieldKey, spbSales, dimensions);
    if (field) {
      section.appendChild(field);
      console.log('[EuraFlow Display] 已添加字段:', fieldKey);
    } else {
      console.log('[EuraFlow Display] 字段返回null，跳过:', fieldKey);
    }
  }

  console.log('[EuraFlow Display] 数据区域子元素数量:', section.children.length);

  // 如果没有渲染任何字段，显示提示
  if (section.children.length === 0) {
    const hint = document.createElement('div');
    hint.style.padding = '12px';
    hint.style.textAlign = 'center';
    hint.style.color = '#9e9e9e';
    hint.style.fontSize = '14px';
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
        const rate = spbSales.transactionRate * 100;
        value = formatValue(rate, '%');
      } else {
        value = '---';
      }
      break;
    case 'packageWeight':
      // 优先使用 dimensions（来自 OZON Seller API）
      if (dimensions?.weight !== undefined && dimensions.weight !== null) {
        value = formatValue(dimensions.weight, ' g');
      } else if (spbSales) {
        value = formatValue(spbSales.packageWeight, ' g');
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
          value = formatDimensions(spbSales.packageLength, spbSales.packageWidth, spbSales.packageHeight);
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
  dimensions: any | null,
  euraflowConfig: any | null
): HTMLElement {
  const buttonRow = document.createElement('div');
  buttonRow.id = 'euraflow-button-row';
  buttonRow.setAttribute('data-euraflow-component', 'button-row');
  buttonRow.style.display = 'flex';
  buttonRow.style.gap = '8px';
  buttonRow.style.marginTop = '12px';

  // 创建"跟卖"按钮
  const followButton = createFollowButton(realPrice, ozonProduct, dimensions);
  buttonRow.appendChild(followButton);

  // 创建"采集"按钮
  const collectButton = createCollectButton(ozonProduct, dimensions, euraflowConfig);
  buttonRow.appendChild(collectButton);

  return buttonRow;
}

/**
 * 创建"跟卖"按钮
 */
function createFollowButton(
  realPrice: number | null,
  ozonProduct: any,
  dimensions: any | null
): HTMLButtonElement {
  const followButton = document.createElement('button');
  followButton.id = 'euraflow-follow-sell';
  followButton.setAttribute('type', 'button');
  followButton.className = 'pdp_e9a pdp_fa3 b25_5_1-a0 b25_5_1-b3 b25_5_1-a5';
  followButton.style.background = 'var(--bgActionPrimary)';
  followButton.style.color = 'var(--textLightKey)';
  followButton.style.flex = '1';
  followButton.style.height = '48px';
  followButton.style.borderRadius = '8px';
  followButton.style.border = 'none';
  followButton.style.cursor = 'pointer';
  followButton.style.position = 'relative';
  followButton.style.overflow = 'hidden';

  // 按钮内容容器
  const followContent = document.createElement('div');
  followContent.className = 'b25_5_1-a2';
  followContent.style.display = 'flex';
  followContent.style.alignItems = 'center';
  followContent.style.justifyContent = 'center';
  followContent.style.gap = '4px';

  const followText = document.createElement('div');
  followText.className = 'b25_5_1-a9 tsBodyControl500Medium';
  followText.textContent = '跟卖';

  followContent.appendChild(followText);

  // 按钮波纹效果层
  const followRipple = document.createElement('div');
  followRipple.className = 'b25_5_1-a';
  followRipple.style.backgroundColor = 'var(--textLightKey)';

  followButton.appendChild(followContent);
  followButton.appendChild(followRipple);

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

      const { showPublishModal } = await import('../components/PublishModal');
      const productData = { ...ozonProduct, dimensions };
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
  ozonProduct: any,
  dimensions: any | null,
  euraflowConfig: any | null
): HTMLButtonElement {
  const collectButton = document.createElement('button');
  collectButton.id = 'euraflow-collect';
  collectButton.setAttribute('type', 'button');
  collectButton.className = 'pdp_e9a pdp_fa3 b25_5_1-a0 b25_5_1-b3 b25_5_1-a5';
  collectButton.style.background = 'var(--bgActionSecondary)';
  collectButton.style.color = 'var(--textActionPrimary)';
  collectButton.style.flex = '1';
  collectButton.style.height = '48px';
  collectButton.style.borderRadius = '8px';
  collectButton.style.border = 'none';
  collectButton.style.cursor = 'pointer';
  collectButton.style.position = 'relative';
  collectButton.style.overflow = 'hidden';

  // 按钮内容容器
  const collectContent = document.createElement('div');
  collectContent.className = 'b25_5_1-a2';
  collectContent.style.display = 'flex';
  collectContent.style.alignItems = 'center';
  collectContent.style.justifyContent = 'center';
  collectContent.style.gap = '4px';

  const collectText = document.createElement('div');
  collectText.className = 'b25_5_1-a9 tsBodyControl500Medium';
  collectText.textContent = '采集';

  collectContent.appendChild(collectText);

  // 按钮波纹效果层
  const collectRipple = document.createElement('div');
  collectRipple.className = 'b25_5_1-a';
  collectRipple.style.backgroundColor = 'var(--graphicActionPrimary)';

  collectButton.appendChild(collectContent);
  collectButton.appendChild(collectRipple);

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
      collectButton.style.opacity = '0.5';
      collectText.textContent = '采集中...';

      // 通过 background service worker 发送请求（避免 CORS）
      const productData = { ...ozonProduct, dimensions };
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

      alert('✓ 商品已采集，请到系统采集记录中查看');
    } catch (error) {
      console.error('[EuraFlow] 采集失败:', error);
      alert('采集失败：' + (error as Error).message);
    } finally {
      collectButton.disabled = false;
      collectButton.style.opacity = '1';
      collectText.textContent = '采集';
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
