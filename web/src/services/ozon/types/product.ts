/**
 * OZON 商品类型定义
 */

/**
 * 商品图片
 */
export interface ProductImages {
  primary?: string;
  additional?: string[];
  [key: string]: unknown;
}

/**
 * 商品属性
 */
export interface ProductAttributes {
  [key: string]: unknown;
}

/**
 * 商品信息
 */
export interface Product {
  id: number;
  shop_id: number;
  offer_id: string;
  sku?: string; // SKU别名（与offer_id相同）
  ozon_product_id?: number;
  ozon_sku?: number;
  title: string;
  title_cn?: string;
  description?: string;
  barcode?: string;
  barcodes?: string[];
  category_id?: number;
  category_name?: string;
  brand?: string;
  status:
    | "on_sale"
    | "ready_to_sell"
    | "error"
    | "pending_modification"
    | "inactive"
    | "archived";
  ozon_status?: string;
  status_reason?: string;
  ozon_visibility_details?: {
    has_price?: boolean;
    has_stock?: boolean;
    [key: string]: unknown;
  };
  visibility: boolean;
  is_archived: boolean;
  price?: string;
  currency_code?: string;
  old_price?: string;
  premium_price?: string;
  cost?: string;
  min_price?: string;
  stock: number;
  reserved: number;
  available: number;
  warehouse_stocks?: Array<{
    warehouse_id: number;
    warehouse_name: string;
    present: number;
    reserved: number;
  }>;
  weight?: number;
  width?: number;
  height?: number;
  depth?: number;
  dimension_unit?: string;
  weight_unit?: string;
  description_category_id?: number;
  type_id?: number;
  color_image?: string;
  primary_image?: string;
  ozon_attributes?: unknown;
  complex_attributes?: unknown;
  model_info?: unknown;
  pdf_list?: unknown[];
  attributes_with_defaults?: unknown[];
  ozon_archived?: boolean;
  ozon_has_fbo_stocks?: boolean;
  ozon_has_fbs_stocks?: boolean;
  ozon_is_discounted?: boolean;
  ozon_visibility_status?: string;
  images?: ProductImages;
  attributes?: ProductAttributes;
  last_sync_at?: string;
  sync_status: "pending" | "syncing" | "success" | "failed" | "imported";
  sync_error?: string;
  created_at: string;
  updated_at: string;
}

/**
 * 商品筛选条件
 */
export interface ProductFilter {
  shop_id?: number | null;
  status?: string;
  sku?: string;
  title?: string;
  category_id?: number;
  sync_status?: string;
  search?: string; // 通用搜索
  price_min?: number;
  price_max?: number;
  has_stock?: boolean;
  visibility?: string;
  archived?: boolean;
  brand?: string;
  created_from?: string; // 创建日期起始（YYYY-MM-DD）
  created_to?: string; // 创建日期结束（YYYY-MM-DD）
  sort_by?: string; // 排序字段
  sort_order?: "asc" | "desc"; // 排序方向
  include_stats?: boolean; // 是否包含统计信息（影响性能）
}

/**
 * 价格更新
 */
export interface PriceUpdate {
  offer_id: string;
  price: string;
  old_price?: string;
  premium_price?: string;
  reason?: string;
}

/**
 * 库存更新
 */
export interface StockUpdate {
  offer_id: string;
  stock: number;
  warehouse_id: number;
}

/**
 * 进货价格历史
 */
export interface PurchasePriceHistory {
  posting_number: string;
  purchase_price: string | null;
  updated_at: string | null;
  source_platform?: string[]; // 采购平台列表
}

/**
 * 进货价格历史响应
 */
export interface PurchasePriceHistoryResponse {
  sku: string;
  primary_image: string | null;
  product_price: string | null;
  purchase_url: string | null;
  suggested_purchase_price: string | null;
  purchase_note: string | null;
  history: PurchasePriceHistory[];
  total: number;
}
