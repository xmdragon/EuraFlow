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

  // 物流信息
  package_weight?: number;          // 克
  package_volume?: number;          // 升
  package_length?: number;          // 毫米
  package_width?: number;           // 毫米
  package_height?: number;          // 毫米

  // 商品评价
  rating?: number;
  review_count?: number;

  // 其他信息
  seller_type?: string;             // FBS/FBO
  delivery_days?: number;
  availability_percent?: number;
  ad_cost_share?: number;
  product_created_date?: Date;

  // 竞争对手数据
  competitor_count?: number;
  competitor_min_price?: number;

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

/**
 * 采集配置
 */
export interface CollectorConfig {
  targetCount: number;
  scrollDelay: number;
  scrollWaitTime: number;
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
}

/**
 * 融合统计
 */
export interface FusionStats {
  spbFields: number;        // 上品帮提供的字段数
  mzFields: number;         // 毛子ERP提供的字段数
  totalFields: number;      // 总字段数
  fusedFields: string[];    // 从两个数据源融合的字段
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
    attribute_id: number;
    value: string;
    dictionary_value_id?: number;
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
 * 批量上架请求
 */
export interface QuickPublishBatchRequest {
  shop_id: number;
  warehouse_ids: number[];
  watermark_config_id?: number;     // 水印配置ID
  variants: QuickPublishVariant[];  // 变体列表
  // 通过SKU创建商品只需要变体中的7个字段：name, offer_id, old_price, price, sku, vat, currency_code
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
  status: 'pending' | 'processing' | 'imported' | 'failed';
  items?: any[];
  error?: string;
}
