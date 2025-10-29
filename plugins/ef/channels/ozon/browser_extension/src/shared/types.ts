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
  category_path?: string;               // 类目路径
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
