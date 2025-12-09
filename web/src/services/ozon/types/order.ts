/**
 * OZON 订单类型定义
 */

/**
 * 订单商品项
 */
export interface OrderItem {
  id: number;
  sku: string;
  offer_id?: string;
  ozon_sku?: number;
  product_id?: number; // OZON 商品 ID (用于拆分 API)
  name?: string;
  quantity: number;
  price: string;
  discount: string;
  total_amount: string;
  status?: string;
  image?: string;
}

/**
 * 货件包裹
 */
export interface ShipmentPackage {
  id: number;
  tracking_number?: string;
  carrier_name?: string;
  carrier_code?: string;
}

/**
 * 发货单（Posting）
 */
export interface Posting {
  id: number;
  posting_number: string;
  ozon_posting_number?: string;
  status: string;
  substatus?: string;
  operation_status?: string;
  shipment_date?: string;
  delivery_method_name?: string;
  warehouse_name?: string;
  packages_count: number;
  total_weight?: number;
  is_cancelled: boolean;
  cancel_reason?: string;
  shipped_at?: string;
  delivered_at?: string;
  cancelled_at?: string;
  packages?: ShipmentPackage[];
  products?: OrderItem[]; // 该 posting 的商品列表（从 raw_payload 提取）
  items?: OrderItem[]; // 该 posting 的商品列表（别名，与 products 相同）
  tracking_number?: string; // 物流追踪号
  /** @deprecated 使用 domestic_tracking_numbers 代替 */
  domestic_tracking_number?: string; // 国内物流单号（常用字段，提升到 Posting）
  domestic_tracking_numbers?: string[]; // 国内物流单号列表（一对多关系）
  source_platform?: string[]; // 采购平台列表（常用字段，提升到 Posting）
  order_notes?: string; // 订单备注
  // 财务字段
  purchase_price?: string; // 进货价格
  purchase_price_updated_at?: string; // 进货价格更新时间
  material_cost?: string; // 打包费用（物料成本）
  last_mile_delivery_fee_cny?: string; // 尾程派送费(CNY)
  international_logistics_fee_cny?: string; // 国际物流费(CNY)
  ozon_commission_cny?: string; // Ozon佣金(CNY)
  // 打印追踪字段
  label_printed_at?: string; // 标签首次打印时间
  label_print_count?: number; // 标签打印次数
  // 时间字段
  in_process_at?: string; // 开始处理时间
  // 包装重量（克）
  package_weight?: number;
  // 订单进度时间字段
  tracking_synced_at?: string; // 国际单号首次同步时间
  domestic_tracking_updated_at?: string; // 国内单号最后更新时间
}

/**
 * 订单信息
 */
export interface Order {
  id: number;
  shop_id: number;
  order_id: string;
  order_number?: string; // Added for compatibility
  ozon_order_id: string;
  ozon_order_number?: string;
  posting_number?: string; // Added for compatibility
  status:
    | "pending"
    | "confirmed"
    | "processing"
    | "shipped"
    | "delivered"
    | "cancelled";
  ozon_status?: string;
  payment_status?: string;
  order_type: "FBS" | "FBO" | "CrossDock";
  is_express: boolean;
  is_premium: boolean;
  total_amount: string;
  currency_code?: string;
  products_amount?: string;
  products_price?: string; // Added for compatibility
  delivery_amount?: string;
  commission_amount?: string;
  customer_id?: string;
  customer_phone?: string;
  customer_email?: string;
  delivery_address?: {
    city?: string;
    district?: string;
    region?: string;
    street?: string;
    building?: string;
    apartment?: string;
    postal_code?: string;
    delivery_type?: string;
    [key: string]: unknown;
  };
  delivery_method?: string;
  delivery_date?: string;
  delivery_time_slot?: string;
  shipment_date?: string;
  warehouse_name?: string;
  ordered_at: string;
  in_process_at?: string; // Added for compatibility
  confirmed_at?: string;
  shipped_at?: string;
  delivered_at?: string;
  cancelled_at?: string;
  purchase_price?: string;
  /** @deprecated 使用 domestic_tracking_numbers 代替 */
  domestic_tracking_number?: string;
  domestic_tracking_numbers?: string[]; // 国内物流单号列表（一对多关系）
  tracking_number?: string; // 物流追踪号
  material_cost?: string;
  source_platform?: string[]; // 采购平台列表
  order_notes?: string;
  delivery_price?: string;
  total_price?: string;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
  postings?: Posting[];
}

/**
 * 货件与订单的组合类型（用于列表展示）
 * 后端会将常用的 Order 字段提升到 Posting 级别以便访问
 */
export interface PostingWithOrder extends Posting {
  order: Order; // 关联的完整订单信息
  // 从 Order 提升的便捷字段（后端自动填充）
  shop_id: number;
  items?: OrderItem[]; // 商品列表（从 order.items 或 posting.products 提取）
  tracking_number?: string; // 追踪号（从 packages 提取或直接返回）
  ordered_at?: string; // 下单时间（从 order.ordered_at）
  in_process_at?: string; // 开始处理时间（从 order.in_process_at）
  delivery_method?: string; // 配送方式（从 order.delivery_method）
}

/**
 * 订单筛选条件
 */
export interface OrderFilter {
  shop_id?: number | null;
  status?: string;
  order_type?: string;
  date_from?: string;
  date_to?: string;
  customer_phone?: string;
  posting_number?: string;
}

/**
 * 发货请求
 */
export interface ShipmentRequest {
  posting_number: string;
  tracking_number: string;
  carrier_code: string;
  items?: Array<{
    sku: string;
    quantity: number;
  }>;
}

/**
 * 废弃订单请求参数
 */
export interface DiscardOrderRequest {
  // 预留扩展字段
}

/**
 * 拆分货件请求 - 单个商品
 */
export interface SplitPostingProduct {
  sku: string;  // 使用 SKU 作为唯一标识
  quantity: number;
}

/**
 * 拆分货件请求 - 单个新货件
 */
export interface SplitPostingItem {
  products: SplitPostingProduct[];
}

/**
 * 拆分货件请求
 */
export interface SplitPostingRequest {
  postings: SplitPostingItem[];
}

/**
 * 拆分货件响应
 */
export interface SplitPostingResponse {
  success: boolean;
  message: string;
  data: {
    parent_posting_number: string;
    new_posting_numbers: string[];
    split_at: string;
  };
}
