/**
 * 商品数据结构（42个字段）
 * 与后端 ProductSelectionItem 模型完全对应
 */
export interface ProductData {
  // 基础信息
  product_id: string;
  product_name_ru?: string;
  product_name_cn?: string;
  ozon_link?: string;
  image_url?: string;
  category_link?: string;

  // 品牌
  brand?: string;
  brand_normalized?: string;  // 标准化品牌名（大写、去空格）

  // 价格
  current_price?: number;
  original_price?: number;

  // 佣金（6个字段，包含高档）
  rfbs_commission_low?: number;    // rFBS ≤1500₽
  rfbs_commission_mid?: number;    // rFBS 1501-5000₽
  rfbs_commission_high?: number;   // rFBS >5000₽
  fbp_commission_low?: number;     // FBP ≤1500₽
  fbp_commission_mid?: number;     // FBP 1501-5000₽
  fbp_commission_high?: number;    // FBP >5000₽

  // 销量数据
  monthly_sales_volume?: number;
  monthly_sales_revenue?: number;
  daily_sales_volume?: number;
  daily_sales_revenue?: number;
  sales_dynamic_percent?: number;
  conversion_rate?: number;

  // 物流信息（统一使用上品帮API字段名）
  weight?: number;                  // 克
  depth?: number;                   // 深度/长度（毫米）- 上品帮API字段名
  width?: number;                   // 宽度（毫米）
  height?: number;                  // 高度（毫米）

  // 商品评价
  rating?: number;
  review_count?: number;

  // 其他信息
  seller_type?: string;             // FBS/FBO
  delivery_days?: number;
  availability_percent?: number;
  ad_cost_share?: number;
  product_created_date?: Date;

  // 竞争对手数据（上品帮销售数据API）
  competitor_count?: number;
  competitor_min_price?: number;

  // 跟卖数据（OZON API）
  follow_seller_count?: number;         // 跟卖商家数量
  follow_seller_min_price?: number;     // 最低跟卖价
  follow_seller_skus?: string[];        // 跟卖商家SKU数组（调试用）
  follow_seller_prices?: number[];      // 跟卖价格数组（按价格排序，调试用）

  // 营销分析字段（上品帮新增）
  card_views?: number;                  // 商品卡片浏览量
  card_add_to_cart_rate?: number;       // 商品卡片加购率 %
  search_views?: number;                // 搜索和目录浏览量
  search_add_to_cart_rate?: number;     // 搜索和目录加购率 %
  click_through_rate?: number;          // 点击率 %
  promo_days?: number;                  // 参与促销天数
  promo_discount_percent?: number;      // 参与促销的折扣 %
  promo_conversion_rate?: number;       // 促销活动的转化率 %
  paid_promo_days?: number;             // 付费推广天数
  return_cancel_rate?: number;          // 退货取消率 %

  // 基础字段（上品帮新增）
  category_path?: string;               // 类目路径（完整，如：儿童用品 > 小雕塑）
  category_level_1?: string;            // 一级类目（如：儿童用品）
  category_level_2?: string;            // 二级类目（如：小雕塑）
  avg_price?: number;                   // 平均价格 ₽
  listing_date?: Date;                  // 上架时间
  listing_days?: number;                // 上架天数
  seller_mode?: string;                 // 发货模式 FBS/FBO
}

/**
 * API配置
 */
export interface ApiConfig {
  apiUrl: string;
  apiKey: string;
}

export interface CollectorConfig {
  targetCount: number;
}

/**
 * 采集进度
 */
export interface CollectionProgress {
  collected: number;
  target: number;
  isRunning: boolean;
  errors: string[];
  status?: string;  // 当前状态描述
  scanned?: number;           // 已扫描总数（DOM采集）
  filteredOut?: number;       // 被过滤掉的数量
}

/**
 * 采集过滤配置
 * 空值(undefined)表示不应用该过滤条件
 */
export interface FilterConfig {
  // 价格区间（DOM可用，阶段1过滤）
  priceMin?: number;          // 最低价格（人民币）
  priceMax?: number;          // 最高价格（人民币）

  // 上品帮数据（阶段2过滤）
  monthlySalesMin?: number;   // 月销量 >= 该值
  weightMax?: number;         // 重量 <= 该值（克）
  listingDateAfter?: string;  // 上架时间晚于该日期（YYYY-MM-DD格式）
  sellerMode?: 'ALL' | 'FBS' | 'FBO';  // 发货模式，ALL表示不过滤

  // OZON API数据（阶段3过滤）
  followSellerMax?: number;   // 跟卖数量 <= 该值
}

/**
 * 融合统计
 */
export interface FusionStats {
  spbFields: number;        // 上品帮提供的字段数
  totalFields: number;      // 总字段数
  fusedFields: string[];    // 融合的字段
}

// ========== 一键跟卖功能类型 ==========

/**
 * 店铺信息
 */
export interface Shop {
  id: number;
  shop_name: string;        // 俄文店铺名
  shop_name_cn: string;     // 中文店铺名
  display_name: string;     // 显示名称
  platform: string;         // 平台（ozon）
  status: string;           // 状态（active）
}

/**
 * 仓库信息
 */
export interface Warehouse {
  id: number;
  shop_id: number;
  warehouse_id: number;     // OZON仓库ID
  name: string;             // 仓库名称
  is_rfbs: boolean;         // 是否为rFBS仓库
  status: string;           // 状态
}

/**
 * 水印配置
 */
export interface Watermark {
  id: number;
  name: string;             // 水印名称
  image_url: string;        // 水印图片URL
  scale_ratio: number;      // 缩放比例（0.01-1.0）
  opacity: number;          // 透明度（0.1-1.0）
  positions: string[];      // 位置列表
  is_active: boolean;       // 是否激活
}

/**
 * 快速上架请求
 */
export interface QuickPublishRequest {
  shop_id: number;
  warehouse_ids: number[];
  sku: string;              // OZON SKU
  offer_id: string;         // 商家SKU
  price: number;
  stock: number;
  category_id?: number;
  old_price?: number;
  ozon_product_id?: string;
  title: string;
  description?: string;
  images: string[];
  brand?: string;
  barcode?: string;
  dimensions?: {
    weight: number;         // 克
    height: number;         // 毫米
    width: number;          // 毫米
    length: number;         // 毫米
  };
  attributes?: Array<{
    attribute_id: number;      // 0 表示需要后端解析
    value: string;
    dictionary_value_id?: number;
    key?: string;              // OZON 属性 key
    name?: string;             // OZON 属性名称
  }>;
}

/**
 * 单个变体的上架数据（仅变体特有字段）
 */
export interface QuickPublishVariant {
  name: string;             // 商品名称（必填）
  sku: string;              // OZON SKU
  offer_id: string;         // 商家SKU
  price: number;            // 价格（分）
  stock: number;            // 库存
  old_price?: number;       // 原价（分）
  primary_image?: string;   // 变体主图URL（单个图片）
}

/**
 * 商品尺寸
 */
export interface Dimensions {
  weight: number;  // 重量（克）
  height: number;  // 高度（毫米）
  width: number;   // 宽度（毫米）
  length: number;  // 长度（深度，毫米）
}

/**
 * 类目特征
 * 采集时保存原始 key/name，后端根据 name 查找真实的 attribute_id
 */
export interface Attribute {
  attribute_id: number;      // 0 表示需要后端解析
  value: string;
  dictionary_value_id?: number;
  key?: string;              // OZON 属性 key，如 "Type", "Color"
  name?: string;             // OZON 属性名称，如 "类型", "颜色"
}

/**
 * 批量上架请求（支持完整商品数据）
 */
export interface QuickPublishBatchRequest {
  shop_id: number;
  warehouse_ids: number[];
  watermark_config_id?: number;     // 水印配置ID
  variants: QuickPublishVariant[];  // 变体列表

  // 共享图片和视频
  images: string[];
  videos?: string[];

  // 共享商品信息
  description?: string;
  category_id?: number;
  brand?: string;
  barcode?: string;

  // 尺寸和重量（必填）
  dimensions?: Dimensions;

  // 类目特征（可选）
  attributes?: Attribute[];
}

/**
 * 批量上架响应
 */
export interface QuickPublishBatchResponse {
  success: boolean;
  task_ids: string[];       // 任务ID列表
  task_count: number;       // 任务数量
  message: string;
  error?: string;
}

/**
 * 快速上架响应
 */
export interface QuickPublishResponse {
  success: boolean;
  task_id?: string;
  message?: string;
  error?: string;
}

/**
 * 任务状态
 */
export interface TaskStatus {
  success: boolean;
  task_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'not_found';
  items?: any[];
  error?: string;
}

// ========== 上品帮集成类型 ==========

/**
 * 上品帮配置
 */
export interface ShangpinbangConfig {
  phone: string;            // 手机号
  password: string;         // 密码（明文存储）
  token?: string;           // 登录Token
  tokenExpiry?: number;     // Token过期时间戳（预留）
}

/**
 * 上品帮登录请求
 */
export interface ShangpinbangLoginRequest {
  phone: string;
  pwd: string;
}

/**
 * 上品帮登录响应
 */
export interface ShangpinbangLoginResponse {
  code: number;             // 0=成功, -1=失败
  data: {
    token: string;
  } | null;
  message: string;          // "成功" | "密码错误" | "手机号未注册"
}

/**
 * Service Worker 消息类型
 */
export const MESSAGE_TYPES = {
  // 上品帮登录
  SPB_LOGIN: 'SPB_LOGIN',
  SPB_GET_TOKEN: 'SPB_GET_TOKEN',
  SPB_API_CALL: 'SPB_API_CALL',  // 通用上品帮 API 调用（支持自动 Token 刷新）
  GET_SPB_SALES_DATA: 'GET_SPB_SALES_DATA',  // 获取上品帮销售数据
  GET_SPB_COMMISSIONS: 'GET_SPB_COMMISSIONS',  // 获取上品帮佣金数据

  // OZON API
  GET_OZON_PRODUCT_DETAIL: 'GET_OZON_PRODUCT_DETAIL',  // 获取 OZON 商品详情

  // 商品采集
  COLLECT_PRODUCT: 'COLLECT_PRODUCT',  // 采集商品
} as const;

export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

/**
 * 上品帮 API 调用请求
 */
export interface ShangpinbangAPIRequest {
  apiUrl: string;      // API 地址
  apiType: string;     // API 类型
  params: Record<string, any>;  // API 参数
}

// ========== OZON API 集成类型 ==========

/**
 * OZON 商品属性
 */
export interface OzonProductAttribute {
  key: string;
  value: string;
  collection?: any[];
  complex?: any[];
  complex_collection?: any[];
}

/**
 * OZON 商品类目
 */
export interface OzonCategory {
  id: string;
  level: string;
  name: string;
}

/**
 * OZON 商品图片
 */
export interface OzonProductImage {
  url: string;
  is_primary: boolean;
}

/**
 * OZON 商品详情（从 search-variant-model 返回）
 */
export interface OzonProductDetail {
  variant_id: string;
  name: string;
  description: string;
  description_category_id: string;
  categories: OzonCategory[];
  attributes: OzonProductAttribute[];
  images: OzonProductImage[];
}

/**
 * OZON search-variant-model API 响应
 */
export interface OzonSearchVariantResponse {
  items: OzonProductDetail[];
  last_id: string;
}

/**
 * 获取 OZON 商品详情请求
 */
export interface GetOzonProductDetailRequest {
  productSku: string;  // 商品 SKU（如：3083658390）
}

// ========== 上品帮销售数据类型 ==========

/**
 * 上品帮销售数据（从 getGoodsInfoByIds API 返回）
 */
export interface SpbSalesData {
  // 基础信息
  goodsId: string;                      // 商品ID
  category: string;                     // 类目（如：住宅和花园 > 礼品袋）
  brand: string;                        // 品牌

  // 佣金（6个字段）
  rfbsCommissionLow: number;            // rFBS ≤1500₽
  rfbsCommissionMid: number;            // rFBS 1501-5000₽
  rfbsCommissionHigh: number;           // rFBS >5000₽
  fbpCommissionLow: number;             // FBP ≤1500₽
  fbpCommissionMid: number;             // FBP 1501-5000₽
  fbpCommissionHigh: number;            // FBP >5000₽

  // 销售数据
  monthlySales: number | null;          // 月销量（件）
  monthlySalesAmount: number | null;    // 月销售额（₽）
  dailySales: number | null;            // 日销量（件）
  dailySalesAmount: number | null;      // 日销售额（₽）
  salesDynamic: number | null;          // 月销售动态（%）

  // 营销分析
  cardViews: number | null;             // 商品卡片浏览量
  cardAddToCartRate: number | null;     // 商品卡片加购率（%）
  searchViews: number | null;           // 搜索和目录浏览量
  searchAddToCartRate: number | null;   // 搜索和目录加购率（%）
  clickThroughRate: number | null;      // 点击率（%）
  promoDays: number | null;             // 参与促销天数
  promoDiscount: number | null;         // 参与促销的折扣（%）
  promoConversion: number | null;       // 促销活动的转化率（%）
  paidPromoDays: number | null;         // 付费推广天数
  adShare: number | null;               // 广告份额（%）

  // 成交数据
  transactionRate: number | null;       // 成交率（%）
  returnCancelRate: number | null;      // 退货取消率（%）

  // 商品基础数据
  avgPrice: number | null;              // 平均价格（₽）
  weight: number | null;                // 包装重量（g）
  depth: number | null;                 // 深度/长度（mm）
  width: number | null;                 // 宽度（mm）
  height: number | null;                // 高度（mm）
  sellerMode: string | null;            // 发货模式（FBS/FBO）

  // 跟卖信息
  competitorCount: number | null;       // 跟卖者数量
  competitorMinPrice: number | null;    // 跟卖最低价（¥）

  // 上架信息
  listingDate: string | null;           // 上架时间（YYYY-MM-DD）
  listingDays: number | null;           // 上架天数
  sku: string | null;                   // SKU
}

/**
 * 数据面板配置
 */
export interface DataPanelConfig {
  // 显示的字段列表（字段key数组）
  visibleFields: string[];
}

/**
 * OZON API 频率限制配置
 */
export interface RateLimitConfig {
  mode: 'fixed' | 'random';        // 频率模式：固定频率 | 随机频率
  fixedDelay: number;              // 固定延迟时间（毫秒）
  randomDelayMin: number;          // 随机延迟最小时间（毫秒）
  randomDelayMax: number;          // 随机延迟最大时间（毫秒）
  enabled: boolean;                // 是否启用频率限制
}

/**
 * 数据字段定义（用于配置界面）
 */
export interface DataField {
  key: string;                          // 字段key（如：monthlySales）
  label: string;                        // 显示标签（如：月销量）
  group: 'sales' | 'marketing' | 'basic' | 'competitor' | 'commission';  // 字段分组
  isDefault: boolean;                   // 是否为默认显示字段
  formatter?: (value: any) => string;   // 值格式化函数
}

// 默认显示的字段列表
export const DEFAULT_FIELDS = [
  'monthlySales',       // 月销量
  'cardViews',          // 浏览量
  'transactionRate',    // 成交率
  'packageWeight',      // 包装重量
  'packageLength',      // 包装长度
  'packageWidth',       // 包装宽度
  'packageHeight',      // 包装高度
  'listingDate',        // 上架时间
] as const;

// 所有可选字段（按分组）
export const FIELD_GROUPS: Record<string, DataField[]> = {
  sales: [
    { key: 'monthlySales', label: '月销量', group: 'sales', isDefault: true },
    { key: 'monthlySalesAmount', label: '月销售额', group: 'sales', isDefault: false },
    { key: 'dailySales', label: '日销量', group: 'sales', isDefault: false },
    { key: 'dailySalesAmount', label: '日销售额', group: 'sales', isDefault: false },
    { key: 'salesDynamic', label: '月销售动态', group: 'sales', isDefault: false },
  ],
  marketing: [
    { key: 'cardViews', label: '商品卡片浏览量', group: 'marketing', isDefault: true },
    { key: 'cardAddToCartRate', label: '商品卡片加购率', group: 'marketing', isDefault: false },
    { key: 'searchViews', label: '搜索和目录浏览量', group: 'marketing', isDefault: false },
    { key: 'searchAddToCartRate', label: '搜索和目录加购率', group: 'marketing', isDefault: false },
    { key: 'clickThroughRate', label: '点击率', group: 'marketing', isDefault: false },
    { key: 'promoDays', label: '参与促销天数', group: 'marketing', isDefault: false },
    { key: 'promoDiscount', label: '参与促销的折扣', group: 'marketing', isDefault: false },
    { key: 'promoConversion', label: '促销活动的转化率', group: 'marketing', isDefault: false },
    { key: 'paidPromoDays', label: '付费推广天数', group: 'marketing', isDefault: false },
    { key: 'adShare', label: '广告份额', group: 'marketing', isDefault: false },
    { key: 'transactionRate', label: '成交率', group: 'marketing', isDefault: true },
    { key: 'returnCancelRate', label: '退货取消率', group: 'marketing', isDefault: false },
  ],
  basic: [
    { key: 'category', label: '类目', group: 'basic', isDefault: false },
    { key: 'brand', label: '品牌', group: 'basic', isDefault: false },
    { key: 'avgPrice', label: '平均价格', group: 'basic', isDefault: false },
    { key: 'packageWeight', label: '包装重量', group: 'basic', isDefault: true },
    { key: 'packageLength', label: '长度', group: 'basic', isDefault: true },
    { key: 'packageWidth', label: '宽度', group: 'basic', isDefault: true },
    { key: 'packageHeight', label: '高度', group: 'basic', isDefault: true },
    { key: 'sellerMode', label: '发货模式', group: 'basic', isDefault: false },
    { key: 'listingDate', label: '上架时间', group: 'basic', isDefault: true },
    { key: 'listingDays', label: '上架天数', group: 'basic', isDefault: false },
    { key: 'sku', label: 'SKU', group: 'basic', isDefault: false },
  ],
  competitor: [
    { key: 'competitorCount', label: '跟卖者数量', group: 'competitor', isDefault: false },
    { key: 'competitorMinPrice', label: '跟卖最低价', group: 'competitor', isDefault: false },
  ],
  commission: [
    { key: 'rfbsCommissionLow', label: 'rFBS ≤1500₽', group: 'commission', isDefault: false },
    { key: 'rfbsCommissionMid', label: 'rFBS 1501-5000₽', group: 'commission', isDefault: false },
    { key: 'rfbsCommissionHigh', label: 'rFBS >5000₽', group: 'commission', isDefault: false },
    { key: 'fbpCommissionLow', label: 'FBP ≤1500₽', group: 'commission', isDefault: false },
    { key: 'fbpCommissionMid', label: 'FBP 1501-5000₽', group: 'commission', isDefault: false },
    { key: 'fbpCommissionHigh', label: 'FBP >5000₽', group: 'commission', isDefault: false },
  ],
};
