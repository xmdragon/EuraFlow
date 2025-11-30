/**
 * 商品列表增强组件渲染器
 *
 * 按行布局，参考商品详情页数据面板样式
 */

import type { SpbSalesData } from '../../shared/api/spbang-api';

// ========== 行布局定义 ==========
// 'single' = 单列行, 'two' = 两列行, 'badge' = 徽章行(佣金)

interface RowConfig {
  type: 'single' | 'two' | 'badge';
  fields: string[];  // 单列1个，两列2个，徽章3个
}

const ROW_LAYOUT: RowConfig[] = [
  // 按 a44.png 顺序排列
  { type: 'single', fields: ['category'] },                                      // 类目
  { type: 'single', fields: ['brand'] },                                         // 品牌
  { type: 'badge', fields: ['rfbsCommissionLow', 'rfbsCommissionMid', 'rfbsCommissionHigh'] },  // rFBS
  { type: 'badge', fields: ['fbpCommissionLow', 'fbpCommissionMid', 'fbpCommissionHigh'] },     // FBP
  { type: 'two', fields: ['monthlySales', 'monthlySalesAmount'] },                // 月销 + 月销额
  { type: 'two', fields: ['dailySales', 'dailySalesAmount'] },                    // 日销 + 日销额
  { type: 'two', fields: ['salesDynamic', 'clickThroughRate'] },                  // 动态 + 点击
  { type: 'two', fields: ['cardViews', 'cardAddToCartRate'] },                    // 卡片 + 加购
  { type: 'two', fields: ['searchViews', 'searchAddToCartRate'] },                // 搜索 + 加购
  { type: 'two', fields: ['promoDays', 'promoDiscount'] },                        // 促销 + 折扣
  { type: 'two', fields: ['paidPromoDays', 'adShare'] },                          // 付费 + 份额
  { type: 'two', fields: ['transactionRate', 'returnCancelRate'] },               // 成交 + 退取
  { type: 'two', fields: ['avgPrice', 'packageWeight'] },                         // 均价 + 重量
  { type: 'two', fields: ['dimensions', 'sellerMode'] },                          // 尺寸 + 模式
  { type: 'two', fields: ['competitorCount', 'competitorMinPrice'] },             // 跟卖 + 最低价
  { type: 'two', fields: ['listingDate', 'listingDays'] },                        // 上架 + 天数
  { type: 'single', fields: ['sku'] },                                            // SKU
];

// ========== 数据格式化函数 ==========

// 空值占位符
const EMPTY = '--';

// 缓存检测到的货币符号
let detectedCurrencySymbol: string | null = null;

/**
 * 检测页面货币符号
 * 从商品价格元素中提取货币符号
 */
function detectCurrencySymbol(): string {
  if (detectedCurrencySymbol) return detectedCurrencySymbol;

  // 尝试从页面商品价格中提取货币符号
  // OZON 价格通常格式: "1 234 ₽" 或 "$ 12.34" 或 "€ 12,34"
  const priceSelectors = [
    '[data-widget="webPrice"] span',
    '[data-widget="webSale"] span',
    '.tsHeadline500Medium',  // OZON 商品列表价格常用类
    '[class*="price"]',
  ];

  for (const selector of priceSelectors) {
    const priceElements = document.querySelectorAll(selector);
    for (const el of priceElements) {
      const text = el.textContent?.trim() || '';
      // 匹配常见货币符号
      const match = text.match(/[₽$€£¥₴₸₼]/);
      if (match) {
        detectedCurrencySymbol = match[0];
        return detectedCurrencySymbol;
      }
    }
  }

  // 默认使用卢布符号
  return '₽';
}

function formatNum(value: any): string {
  if (value == null) return EMPTY;
  if (typeof value === 'number') {
    if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return String(Math.round(value * 10) / 10);
  }
  return String(value);
}

function formatMoney(value: any): string {
  if (value == null) return EMPTY;
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return EMPTY;
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万₽`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k₽`;
  return `${num.toFixed(0)}₽`;
}

function formatPercent(value: any): string {
  if (value == null) return EMPTY;
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return EMPTY;
  if (num < 1 && num > 0) return `${(num * 100).toFixed(1)}%`;
  return `${num.toFixed(1)}%`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return EMPTY;
  try {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return dateStr.substring(0, 10) || dateStr;
  }
}

function formatWeight(value: any): string {
  if (value == null) return EMPTY;
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return EMPTY;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}kg`;
  return `${Math.round(num)}g`;
}

function formatCommission(value: any): string {
  if (value == null) return '-';
  return `${value}`;
}

function formatDays(value: any): string {
  if (value == null) return EMPTY;
  return `${value}天`;
}

// ========== 字段配置 ==========

interface FieldConfig {
  getValue: (data: any) => any;
  format: (value: any) => string;
  label: string;
}

const FIELD_CONFIG: Record<string, FieldConfig> = {
  // 基础信息
  category: {
    getValue: (d) => d?.category3 || d?.category,
    format: (v) => v || EMPTY,
    label: '类目'
  },
  brand: {
    getValue: (d) => d?.brand,
    format: (v) => v || EMPTY,
    label: '品牌'
  },

  // 销售数据
  monthlySales: {
    getValue: (d) => d?.monthlySales,
    format: (v) => v != null ? `${formatNum(v)}件` : EMPTY,
    label: '月销'
  },
  monthlySalesAmount: {
    getValue: (d) => d?.monthlySalesAmount,
    format: formatMoney,
    label: '月销额'
  },
  dailySales: {
    getValue: (d) => d?.dailySales,
    format: (v) => v != null ? `${formatNum(v)}件` : EMPTY,
    label: '日销'
  },
  dailySalesAmount: {
    getValue: (d) => d?.dailySalesAmount,
    format: formatMoney,
    label: '日销额'
  },
  salesDynamic: {
    getValue: (d) => d?.salesDynamic,
    format: formatPercent,
    label: '动态'
  },

  // 营销数据
  cardViews: {
    getValue: (d) => d?.cardViews,
    format: formatNum,
    label: '卡片'
  },
  cardAddToCartRate: {
    getValue: (d) => d?.cardAddToCartRate,
    format: formatPercent,
    label: '加购'
  },
  searchViews: {
    getValue: (d) => d?.searchViews,
    format: formatNum,
    label: '搜索'
  },
  searchAddToCartRate: {
    getValue: (d) => d?.searchAddToCartRate,
    format: formatPercent,
    label: '加购'
  },
  clickThroughRate: {
    getValue: (d) => d?.clickThroughRate,
    format: formatPercent,
    label: '点击'
  },
  transactionRate: {
    getValue: (d) => d?.transactionRate,
    format: formatPercent,
    label: '成交'
  },
  returnCancelRate: {
    getValue: (d) => d?.returnCancelRate,
    format: formatPercent,
    label: '退取'
  },
  promoDays: {
    getValue: (d) => d?.promoDays,
    format: formatDays,
    label: '促销'
  },
  promoDiscount: {
    getValue: (d) => d?.promoDiscount,
    format: formatPercent,
    label: '折扣'
  },
  paidPromoDays: {
    getValue: (d) => d?.paidPromoDays,
    format: formatDays,
    label: '付费'
  },
  adShare: {
    getValue: (d) => d?.adShare,
    format: formatPercent,
    label: '份额'
  },

  // 商品信息
  avgPrice: {
    getValue: (d) => d?.avgPrice,
    format: formatMoney,
    label: '均价'
  },
  packageWeight: {
    getValue: (d) => d?.weight,
    format: formatWeight,
    label: '重量'
  },
  // 尺寸（合并长宽高）
  dimensions: {
    getValue: (d) => {
      const length = d?.depth;
      const width = d?.width;
      const height = d?.height;
      if (length == null && width == null && height == null) return null;
      return { length, width, height };
    },
    format: (v) => {
      if (!v) return EMPTY;
      const l = v.length != null ? Math.round(v.length / 10) : '-';
      const w = v.width != null ? Math.round(v.width / 10) : '-';
      const h = v.height != null ? Math.round(v.height / 10) : '-';
      return `${l}×${w}×${h}`;
    },
    label: '尺寸'
  },
  sellerMode: {
    getValue: (d) => d?.sellerMode,
    format: (v) => v || EMPTY,
    label: '模式'
  },
  listingDate: {
    getValue: (d) => d?.listingDate,
    format: formatDate,
    label: '上架'
  },
  listingDays: {
    getValue: (d) => d?.listingDays,
    format: formatDays,
    label: '天数'
  },
  sku: {
    getValue: (d) => d?.sku,
    format: (v) => v || EMPTY,
    label: 'SKU'
  },

  // 竞争数据
  competitorCount: {
    getValue: (d) => {
      // 优先用 followSellerPrices 数组长度
      if (d?.followSellerPrices?.length > 0) {
        return d.followSellerPrices.length;
      }
      return d?.competitorCount;
    },
    format: (v) => v != null ? (v > 0 ? `${v}家` : '无跟卖') : EMPTY,
    label: '跟卖'
  },
  competitorMinPrice: {
    getValue: (d) => d?.competitorMinPrice,
    format: (v) => v != null ? `${v}${detectCurrencySymbol()}` : EMPTY,
    label: '最低价'
  },

  // 佣金数据
  rfbsCommissionLow: {
    getValue: (d) => d?.rfbsCommissionLow,
    format: formatCommission,
    label: 'rFBS'
  },
  rfbsCommissionMid: {
    getValue: (d) => d?.rfbsCommissionMid,
    format: formatCommission,
    label: ''
  },
  rfbsCommissionHigh: {
    getValue: (d) => d?.rfbsCommissionHigh,
    format: formatCommission,
    label: ''
  },
  fbpCommissionLow: {
    getValue: (d) => d?.fbpCommissionLow,
    format: formatCommission,
    label: 'FBP'
  },
  fbpCommissionMid: {
    getValue: (d) => d?.fbpCommissionMid,
    format: formatCommission,
    label: ''
  },
  fbpCommissionHigh: {
    getValue: (d) => d?.fbpCommissionHigh,
    format: formatCommission,
    label: ''
  },
};

// ========== 渲染函数 ==========

/**
 * 渲染单列行
 */
function renderSingleRow(fieldKey: string, data: any): string {
  const config = FIELD_CONFIG[fieldKey];
  if (!config) return '';

  const value = config.getValue(data);
  const formattedValue = config.format(value);

  return `<div class="ef-row ef-row-single">
    <span class="ef-label">${config.label}:</span>
    <span class="ef-value">${formattedValue}</span>
  </div>`;
}

/**
 * 渲染两列行
 */
function renderTwoColRow(leftKey: string, rightKey: string, data: any, showLeft: boolean, showRight: boolean): string {
  const leftConfig = FIELD_CONFIG[leftKey];
  const rightConfig = FIELD_CONFIG[rightKey];

  let leftHtml = '';
  let rightHtml = '';

  if (showLeft && leftConfig) {
    const value = leftConfig.getValue(data);
    const formattedValue = leftConfig.format(value);
    leftHtml = `<div class="ef-col"><span class="ef-label">${leftConfig.label}:</span><span class="ef-value">${formattedValue}</span></div>`;
  }

  if (showRight && rightConfig) {
    const value = rightConfig.getValue(data);
    const formattedValue = rightConfig.format(value);
    rightHtml = `<div class="ef-col"><span class="ef-label">${rightConfig.label}:</span><span class="ef-value">${formattedValue}</span></div>`;
  }

  if (!leftHtml && !rightHtml) return '';

  return `<div class="ef-row ef-row-two">${leftHtml}${rightHtml}</div>`;
}

/**
 * 渲染徽章行（佣金）
 */
function renderBadgeRow(fields: string[], data: any, label: string): string {
  const badges = fields.map(fieldKey => {
    const config = FIELD_CONFIG[fieldKey];
    if (!config) return '<span class="ef-badge">-</span>';
    const value = config.getValue(data);
    const formattedValue = config.format(value);
    return `<span class="ef-badge">${formattedValue}</span>`;
  }).join('');

  return `<div class="ef-row ef-row-badge">
    <span class="ef-label">${label}:</span>
    <span class="ef-badges">${badges}</span>
  </div>`;
}

/**
 * 渲染商品列表项组件
 */
export function renderListItemComponent(
  data: SpbSalesData | undefined,
  visibleFields: string[]
): string {
  if (!data || Object.keys(data).length === 0) {
    return '<div class="ef-list-no-data">暂无数据</div>';
  }

  const visibleSet = new Set(visibleFields);

  // 如果用户配置了长/宽/高任一字段，则显示合并的尺寸字段
  if (visibleSet.has('packageLength') || visibleSet.has('packageWidth') || visibleSet.has('packageHeight')) {
    visibleSet.add('dimensions');
  }

  const rowsHtml: string[] = [];

  // 遍历行布局
  for (const row of ROW_LAYOUT) {
    if (row.type === 'single') {
      const fieldKey = row.fields[0];
      if (visibleSet.has(fieldKey)) {
        rowsHtml.push(renderSingleRow(fieldKey, data));
      }
    } else if (row.type === 'two') {
      const [leftKey, rightKey] = row.fields;
      const showLeft = visibleSet.has(leftKey);
      const showRight = visibleSet.has(rightKey);
      if (showLeft || showRight) {
        rowsHtml.push(renderTwoColRow(leftKey, rightKey, data, showLeft, showRight));
      }
    } else if (row.type === 'badge') {
      // 佣金行：只要配置了任一佣金字段就显示
      const hasAnyCommission = row.fields.some(f => visibleSet.has(f));
      if (hasAnyCommission) {
        // 判断是 rFBS 还是 FBP
        const label = row.fields[0].startsWith('rfbs') ? 'rFBS' : 'FBP';
        rowsHtml.push(renderBadgeRow(row.fields, data, label));
      }
    }
  }

  if (rowsHtml.length === 0) {
    return '<div class="ef-list-no-data">暂无数据</div>';
  }

  return `<div class="ef-list-data-panel">${rowsHtml.join('')}</div>`;
}

/**
 * 获取所有可用字段的定义（用于 popup 配置界面）
 */
export function getAllFieldDefinitions(): Array<{
  key: string;
  label: string;
  group: string;
}> {
  const fields: Array<{ key: string; label: string; group: string }> = [];

  Object.entries(FIELD_CONFIG).forEach(([key, config]) => {
    let group = 'basic';
    if (['monthlySales', 'monthlySalesAmount', 'dailySales', 'dailySalesAmount', 'salesDynamic'].includes(key)) {
      group = 'sales';
    } else if (['cardViews', 'cardAddToCartRate', 'searchViews', 'searchAddToCartRate', 'clickThroughRate', 'transactionRate', 'returnCancelRate', 'promoDays', 'promoDiscount', 'paidPromoDays', 'adShare'].includes(key)) {
      group = 'marketing';
    } else if (['competitorCount', 'competitorMinPrice'].includes(key)) {
      group = 'competitor';
    } else if (key.startsWith('rfbs') || key.startsWith('fbp')) {
      group = 'commission';
    }

    fields.push({
      key,
      label: config.label,
      group
    });
  });

  return fields;
}
