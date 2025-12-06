/**
 * OZON 库存管理类型定义
 */

/**
 * 库存项
 */
export interface StockItem {
  id: number;
  shop_id: number;
  shop_name?: string;
  sku: string;
  product_title?: string;
  product_image?: string;
  product_price?: number;
  qty_available: number;
  threshold: number;
  unit_price?: number; // 采购单价
  notes?: string;
  source_platform?: string[]; // 采购平台来源
  updated_at: string;
}

/**
 * 添加库存请求
 */
export interface AddStockRequest {
  shop_id: number;
  sku: string;
  quantity: number;
  unit_price?: number; // 采购单价
  notes?: string;
  source_platform?: string[]; // 采购平台来源
}

/**
 * 更新库存请求
 */
export interface UpdateStockRequest {
  quantity: number;
  unit_price?: number; // 采购单价
  notes?: string;
  source_platform?: string[]; // 采购平台来源
}

/**
 * 库存检查项
 */
export interface StockCheckItem {
  sku: string;
  product_title?: string;
  product_image?: string;
  stock_available: number;
  order_quantity: number;
  is_sufficient: boolean;
  unit_price?: number; // 采购单价（用于自动填充进货价格）
}
