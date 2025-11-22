/**
 * Ozon API 服务
 * 处理与后端 Ozon 接口的通信
 */
import axios from "axios";

import authService from "./authService";

const API_BASE = "/api/ef/v1";

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
});

// 请求拦截器：添加认证token
apiClient.interceptors.request.use(
  (config) => {
    // 使用新的认证服务获取token
    const authHeaders = authService.getAuthHeader();
    if (authHeaders.Authorization) {
      config.headers.Authorization = authHeaders.Authorization;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 响应拦截器：处理错误和token刷新
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // 尝试刷新token
      try {
        await authService.refresh();
        // 重新设置认证头并重试请求
        const authHeaders = authService.getAuthHeader();
        originalRequest.headers.Authorization = authHeaders.Authorization;
        return apiClient(originalRequest);
      } catch {
        // 刷新失败，跳转登录
        authService.logout();
      }
    }
    return Promise.reject(error);
  },
);

// ==================== 商品相关 API ====================

export interface ProductImages {
  primary?: string;
  additional?: string[];
  count?: number;
}

// ==================== 店铺 API ====================

// 获取店铺列表
export const getShops = async (includeStats: boolean = false) => {
  const response = await apiClient.get("/ozon/shops", {
    params: { include_stats: includeStats }
  });
  return response.data;
};

// 创建店铺
interface ShopData {
  shop_name: string;
  shop_name_cn?: string;
  client_id: string;
  api_key: string;
  platform?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export const createShop = async (data: ShopData) => {
  const response = await apiClient.post("/ozon/shops", data);
  return response.data;
};

// 更新店铺
export const updateShop = async (shopId: number, data: Partial<ShopData>) => {
  const response = await apiClient.put(`/ozon/shops/${shopId}`, data);
  return response.data;
};

// 删除店铺
export const deleteShop = async (shopId: number) => {
  const response = await apiClient.delete(`/ozon/shops/${shopId}`);
  return response.data;
};

// 测试店铺连接
export const testShopConnection = async (shopId: number) => {
  const response = await apiClient.post(
    `/ozon/shops/${shopId}/test-connection`,
  );
  return response.data;
};

// 测试API连接
export const testApiConnection = async (credentials: {
  client_id: string;
  api_key: string;
}) => {
  const response = await apiClient.post("/ozon/test-connection", credentials);
  return response.data;
};

// 获取店铺仓库列表（从数据库读取）
export const getWarehouses = async (shopId: number) => {
  const response = await apiClient.get(`/ozon/shops/${shopId}/warehouses`);
  return response.data;
};

// 同步仓库（单个店铺）
export const syncWarehouses = async (shopId: number) => {
  const response = await apiClient.post(
    `/ozon/shops/${shopId}/sync-warehouses`,
  );
  return response.data;
};

// 批量同步所有店铺仓库
export const syncAllWarehouses = async () => {
  const response = await apiClient.post(`/ozon/shops/sync-all-warehouses`);
  return response.data;
};

// ==================== 商品 API ====================

export interface ProductAttributes {
  [key: string]: unknown;
}

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

export interface PriceUpdate {
  offer_id: string;
  price: string;
  old_price?: string;
  premium_price?: string;
  reason?: string;
}

export interface StockUpdate {
  offer_id: string;
  stock: number;
  warehouse_id: number;
}

// 获取商品列表
export const getProducts = async (
  page: number = 1,
  pageSize: number = 20,
  filter?: ProductFilter,
) => {
  const params = {
    page: page,
    page_size: pageSize,
    ...filter,
  };
  // 如果shop_id为null（全部店铺），不传递该参数
  if (params.shop_id === null) {
    delete params.shop_id;
  }
  const response = await apiClient.get("/ozon/products", { params });
  return response.data;
};

// 获取商品详情
export const getProduct = async (productId: number) => {
  const response = await apiClient.get(`/ozon/products/${productId}`);
  return response.data;
};

// 获取商品同步错误信息
export const getProductSyncErrors = async (productId: number) => {
  const response = await apiClient.get(`/ozon/products/${productId}/sync-errors`);
  return response.data;
};

// 同步商品
export const syncProducts = async (
  shopId?: number | null,
  fullSync: boolean = false,
) => {
  // 如果没有指定店铺，获取第一个店铺
  if (!shopId) {
    const shopsResponse = await apiClient.get("/ozon/shops");
    const shops = shopsResponse.data.data;
    if (!shops || shops.length === 0) {
      throw new Error("没有找到可用的店铺");
    }
    shopId = shops[0].id;
  }

  const response = await apiClient.post(`/ozon/shops/${shopId}/sync`, null, {
    params: {
      sync_type: "products",
      products_mode: fullSync ? "full" : "incremental",
    },
  });
  return response.data;
};

// 同步单个商品
export const syncSingleProduct = async (productId: number) => {
  const response = await apiClient.post(`/ozon/products/${productId}/sync`);
  return response.data;
};

// 归档商品
export const archiveProduct = async (productId: number) => {
  const response = await apiClient.post(`/ozon/products/${productId}/archive`);
  return response.data;
};

// 恢复归档商品（简单版，仅改变归档状态）
export const restoreArchivedProduct = async (productId: number) => {
  const response = await apiClient.post(`/ozon/products/${productId}/unarchive`);
  return response.data;
};

// 删除商品
export const deleteProduct = async (productId: number) => {
  const response = await apiClient.delete(`/ozon/products/${productId}`);
  return response.data;
};

// 批量更新价格
export const updatePrices = async (updates: PriceUpdate[], shopId?: number) => {
  const data: { updates: PriceUpdate[]; shop_id?: number } = { updates };
  if (shopId) {
    data.shop_id = shopId;
  }
  const response = await apiClient.post("/ozon/products/prices", data);
  return response.data;
};

// 批量更新库存
export const updateStocks = async (updates: StockUpdate[], shopId?: number) => {
  const data: { updates: StockUpdate[]; shop_id?: number } = { updates };
  if (shopId) {
    data.shop_id = shopId;
  }
  const response = await apiClient.post("/ozon/products/stocks", data);
  return response.data;
};

// 查询批量库存更新任务状态
export const getBatchStockUpdateTaskStatus = async (taskId: string) => {
  const response = await apiClient.get(`/ozon/products/stocks/task/${taskId}`);
  return response.data;
};

// 查询批量价格更新任务状态
export const getBatchPriceUpdateTaskStatus = async (taskId: string) => {
  const response = await apiClient.get(`/ozon/products/prices/task/${taskId}`);
  return response.data;
};

// ==================== 订单相关 API ====================

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

export interface OrderItem {
  id: number;
  sku: string;
  offer_id?: string;
  ozon_sku?: number;
  name?: string;
  quantity: number;
  price: string;
  discount: string;
  total_amount: string;
  status?: string;
  image?: string;
}

export interface ShipmentPackage {
  id: number;
  tracking_number?: string;
  carrier_name?: string;
  carrier_code?: string;
}

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
  /** @deprecated 使用 domestic_tracking_numbers 代替 */
  domestic_tracking_number?: string; // 国内物流单号（常用字段，提升到 Posting）
  domestic_tracking_numbers?: string[]; // 国内物流单号列表（一对多关系）
  source_platform?: string[]; // 采购平台列表（常用字段，提升到 Posting）
  order_notes?: string; // 订单备注
  // 财务字段
  purchase_price?: string; // 进货价格
  material_cost?: string; // 打包费用（物料成本）
  last_mile_delivery_fee_cny?: string; // 尾程派送费(CNY)
  international_logistics_fee_cny?: string; // 国际物流费(CNY)
  ozon_commission_cny?: string; // Ozon佣金(CNY)
  // 打印追踪字段
  label_printed_at?: string; // 标签首次打印时间
  label_print_count?: number; // 标签打印次数
}

// 货件与订单的组合类型（用于列表展示）
export interface PostingWithOrder extends Posting {
  order: Order; // 关联的完整订单信息
}

export interface OrderFilter {
  shop_id?: number | null;
  status?: string;
  order_type?: string;
  date_from?: string;
  date_to?: string;
  customer_phone?: string;
  posting_number?: string;
}

export interface ShipmentRequest {
  posting_number: string;
  tracking_number: string;
  carrier_code: string;
  items?: Array<{
    sku: string;
    quantity: number;
  }>;
}

// 获取订单列表（页码分页）
export const getOrders = async (
  page: number = 1,
  limit: number = 50,
  filter?: OrderFilter,
) => {
  const params = {
    page: page,
    limit: limit,
    ...filter,
  };
  // 如果shop_id为null（全部店铺），不传递该参数
  if (params.shop_id === null) {
    delete params.shop_id;
  }
  const response = await apiClient.get("/ozon/orders", { params });
  return response.data;
};

// 获取订单详情
export const getOrder = async (orderId: number) => {
  const response = await apiClient.get(`/ozon/orders/${orderId}`);
  return response.data;
};

// 同步订单
export const syncOrders = async (
  shopId?: number | null,
  dateFrom?: string,
  dateTo?: string,
) => {
  // 如果没有指定店铺，获取第一个店铺
  if (!shopId) {
    const shopsResponse = await apiClient.get("/ozon/shops");
    const shops = shopsResponse.data.data;
    if (!shops || shops.length === 0) {
      throw new Error("没有找到可用的店铺");
    }
    shopId = shops[0].id;
  }

  // 根据是否有日期范围决定同步模式
  const mode = dateFrom && dateTo ? "full" : "incremental";

  const response = await apiClient.post(`/ozon/shops/${shopId}/sync`, null, {
    params: {
      sync_type: "orders",
      orders_mode: mode,
    },
  });
  return response.data;
};

// 直接同步订单（新接口）
export const syncOrdersDirect = async (
  shopId: number,
  mode: "full" | "incremental" = "incremental",
) => {
  const response = await apiClient.post("/ozon/orders/sync", {
    shop_id: shopId,
    mode: mode,
  });
  return response.data;
};

// 同步单个订单
export const syncSingleOrder = async (
  postingNumber: string,
  shopId: number,
) => {
  const response = await apiClient.post(
    `/ozon/orders/${postingNumber}/sync`,
    null,
    {
      params: {
        shop_id: shopId,
      },
    },
  );
  return response.data;
};

// 获取同步任务状态
export const getSyncStatus = async (taskId: string) => {
  const response = await apiClient.get(`/ozon/sync/status/${taskId}`);
  return response.data;
};

// 发货
export const shipOrder = async (shipment: ShipmentRequest) => {
  const response = await apiClient.post("/ozon/orders/ship", shipment);
  return response.data;
};

// 取消订单
export const cancelOrder = async (postingNumber: string, reason: string) => {
  const response = await apiClient.post("/ozon/orders/cancel", {
    posting_number: postingNumber,
    reason,
  });
  return response.data;
};

// 废弃订单请求参数
export interface DiscardOrderRequest {
  sync_to_kuajing84: boolean; // 是否同步到跨境巴士
}

// 废弃订单（可选同步到跨境84并更新本地状态）
export const discardOrder = async (postingNumber: string, data: DiscardOrderRequest) => {
  const response = await apiClient.post(
    `/ozon/packing/postings/${postingNumber}/discard`,
    data
  );
  return response.data;
};

// ==================== 统计相关 API ====================

export interface Statistics {
  products: {
    total: number;
    active: number;
    inactive: number;
    out_of_stock: number;
  };
  orders: {
    total: number;
    pending: number;
    processing: number;
    shipped: number;
    delivered: number;
    cancelled: number;
    by_ozon_status: Record<string, number>; // 按 OZON 状态分组的订单数
  };
  revenue: {
    yesterday: string; // 改为昨日销售额
    week: string;
    month: string;
  };
}

// 获取统计数据
export const getStatistics = async (shopId?: number | null) => {
  const params: { shop_id?: number } = {};
  if (shopId) {
    params.shop_id = shopId;
  }
  const response = await apiClient.get("/ozon/statistics", { params });
  return response.data;
};

// 每日Posting统计数据接口
export interface DailyPostingStats {
  dates: string[];
  shops: string[];
  data: Record<string, Record<string, number>>;
  total_days: number;
}

// 获取每日Posting统计
export const getDailyPostingStats = async (
  shopId?: number | null,
  rangeType?: string,
  startDate?: string,
  endDate?: string
) => {
  const params: { shop_id?: number; range_type?: string; start_date?: string; end_date?: string } = {};

  if (shopId) {
    params.shop_id = shopId;
  }

  if (rangeType) {
    params.range_type = rangeType;
  }

  // 自定义日期范围
  if (startDate && endDate) {
    params.start_date = startDate;
    params.end_date = endDate;
  }

  const response = await apiClient.get<DailyPostingStats>("/ozon/daily-posting-stats", { params });
  return response.data;
};

export interface DailyRevenueStats {
  dates: string[];
  shops: string[];
  data: Record<string, Record<string, string>>;  // 销售额为字符串格式（保持精度）
  total_days: number;
  currency: string;  // 货币单位（RUB）
}

// 获取每日销售额统计
export const getDailyRevenueStats = async (
  shopId?: number | null,
  rangeType?: string,
  startDate?: string,
  endDate?: string
) => {
  const params: { shop_id?: number; range_type?: string; start_date?: string; end_date?: string } = {};

  if (shopId) {
    params.shop_id = shopId;
  }

  if (rangeType) {
    params.range_type = rangeType;
  }

  // 自定义日期范围
  if (startDate && endDate) {
    params.start_date = startDate;
    params.end_date = endDate;
  }

  const response = await apiClient.get<DailyRevenueStats>("/ozon/daily-revenue-stats", { params });
  return response.data;
};

// ==================== 同步日志 API ====================

export interface SyncLog {
  id: number;
  shop_id: number;
  entity_type: string;
  sync_type: string;
  status: string;
  processed_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  error_message?: string;
  duration_ms?: number;
  started_at: string;
  completed_at?: string;
  created_at: string;
}

// 获取同步日志
export const getSyncLogs = async (entityType?: string, limit: number = 20) => {
  const params = {
    entity_type: entityType,
    limit,
  };
  const response = await apiClient.get("/ozon/sync-logs", { params });
  return response.data;
};

// 获取同步任务状态
export const getSyncTaskStatus = async (taskId: string) => {
  const response = await apiClient.get(`/ozon/sync/task/${taskId}`);
  return response.data;
};

// 订单详情API
export const getOrderDetail = async (
  postingNumber: string,
  shopId?: number,
) => {
  const params: { shop_id?: number } = {};
  if (shopId) {
    params.shop_id = shopId;
  }
  const response = await apiClient.get(`/ozon/orders/${postingNumber}`, {
    params,
  });
  return response.data;
};

// ==================== Webhook 相关 API ====================

export interface WebhookConfig {
  shop_id: number;
  webhook_url?: string;
  webhook_secret?: string;
  webhook_enabled: boolean;
  supported_events: string[];
}

export interface WebhookEvent {
  id: number;
  event_id: string;
  event_type: string;
  shop_id: number;
  status: "pending" | "processing" | "processed" | "failed" | "ignored";
  is_verified: boolean;
  entity_type?: string;
  entity_id?: string;
  retry_count: number;
  error_message?: string;
  created_at: string;
  processed_at?: string;
  payload_summary?: {
    keys: string[];
    size: number;
  };
}

// 获取Webhook配置
export const getWebhookConfig = async (
  shopId: number,
): Promise<WebhookConfig> => {
  const response = await apiClient.get(`/ozon/shops/${shopId}/webhook`);
  return response.data;
};

// 配置Webhook
export const configureWebhook = async (
  shopId: number,
  config: { webhook_url: string; webhook_secret?: string },
) => {
  const response = await apiClient.post(
    `/ozon/shops/${shopId}/webhook`,
    config,
  );
  return response.data;
};

// 测试Webhook
export const testWebhook = async (shopId: number) => {
  const response = await apiClient.post(`/ozon/shops/${shopId}/webhook/test`);
  return response.data;
};

// 删除Webhook配置
export const deleteWebhookConfig = async (shopId: number) => {
  const response = await apiClient.delete(`/ozon/shops/${shopId}/webhook`);
  return response.data;
};

// 获取Webhook事件列表
export const getWebhookEvents = async (
  shopId: number,
  status?: string,
  limit: number = 50,
  offset: number = 0,
): Promise<{
  events: WebhookEvent[];
  total: number;
  limit: number;
  offset: number;
}> => {
  const params: { shop_id: number; limit: number; offset: number; status?: string } = {
    shop_id: shopId,
    limit,
    offset,
  };
  if (status) {
    params.status = status;
  }

  const response = await apiClient.get("/ozon/webhook/events", { params });
  return response.data;
};

// 重试失败的Webhook事件
export const retryWebhookEvent = async (eventId: string) => {
  const response = await apiClient.post(
    `/ozon/webhook/events/${eventId}/retry`,
  );
  return response.data;
};

// ==================== 聊天相关 API ====================

export interface OzonChat {
  id: number;
  shop_id: number; // 聊天所属店铺ID
  chat_id: string;
  chat_type?: string;
  subject?: string;
  customer_id?: string;
  customer_name?: string;
  status: string;
  is_closed: boolean;
  is_archived?: boolean; // 是否已归档
  order_number?: string;
  product_id?: number;
  message_count: number;
  unread_count: number;
  last_message_at?: string;
  last_message_preview?: string;
  closed_at?: string;
  created_at: string;
  updated_at?: string;
  shop_name?: string; // 全部店铺模式下包含店铺名称
}

export interface OzonChatMessage {
  id: number;
  chat_id: string;
  message_id: string;
  message_type?: string;
  sender_type: string;
  sender_id?: string;
  sender_name?: string;
  content?: string;
  content_data?: unknown;
  data_cn?: string; // 中文翻译
  is_read: boolean;
  is_deleted: boolean;
  is_edited: boolean;
  order_number?: string;
  product_id?: number;
  read_at?: string;
  edited_at?: string;
  created_at: string;
}

export interface ChatStats {
  total_chats: number;
  active_chats: number;
  total_unread: number;
  unread_chats: number;
}

// 获取聊天列表
export const getChats = async (
  shopId: number | null,
  params?: {
    status?: string;
    has_unread?: boolean;
    order_number?: string;
    limit?: number;
    offset?: number;
    shop_ids?: string; // 全部店铺模式下传递的店铺ID列表
  },
): Promise<{
  items: OzonChat[];
  total: number;
  limit: number;
  offset: number;
}> => {
  // 如果shopId为null，使用全部店铺端点
  const url = shopId === null ? "/ozon/chats/all" : `/ozon/chats/${shopId}`;
  const response = await apiClient.get(url, { params });
  return response.data.data;
};

// 获取聊天详情
export const getChatDetail = async (
  shopId: number,
  chatId: string,
): Promise<OzonChat> => {
  const response = await apiClient.get(`/ozon/chats/${shopId}/${chatId}`);
  return response.data.data;
};

// 获取聊天消息列表
export const getChatMessages = async (
  shopId: number,
  chatId: string,
  params?: {
    limit?: number;
    offset?: number;
    before_message_id?: string;
  },
): Promise<{ items: OzonChatMessage[]; total: number; chat_id: string }> => {
  const response = await apiClient.get(
    `/ozon/chats/${shopId}/${chatId}/messages`,
    { params },
  );
  return response.data.data;
};

// 发送消息
export const sendChatMessage = async (
  shopId: number,
  chatId: string,
  content: string,
): Promise<any> => {
  const response = await apiClient.post(
    `/ozon/chats/${shopId}/${chatId}/messages`,
    { content },
  );
  return response.data.data;
};

// 发送文件
export const sendChatFile = async (
  shopId: number,
  chatId: string,
  base64Content: string,
  fileName: string,
): Promise<any> => {
  // 验证文件大小（base64解码后）
  // base64编码后大小约为原始大小的4/3，所以用3/4还原
  const sizeInBytes = (base64Content.length * 3) / 4;
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (sizeInBytes > maxSize) {
    throw new Error("文件大小不能超过10MB");
  }

  const response = await apiClient.post(
    `/ozon/chats/${shopId}/${chatId}/files`,
    {
      base64_content: base64Content,
      file_name: fileName,
    },
  );
  return response.data.data;
};

// 标记聊天为已读
export const markChatAsRead = async (
  shopId: number,
  chatId: string,
): Promise<any> => {
  const response = await apiClient.post(`/ozon/chats/${shopId}/${chatId}/read`);
  return response.data.data;
};

// 归档/取消归档聊天
export const archiveChat = async (
  shopId: number,
  chatId: string,
  isArchived: boolean,
): Promise<any> => {
  const response = await apiClient.post(
    `/ozon/chats/${shopId}/${chatId}/archive`,
    {
      is_archived: isArchived,
    },
  );
  return response.data.data;
};

// 同步聊天数据
export const syncChats = async (
  shopId: number,
  chatIdList?: string[],
): Promise<any> => {
  const response = await apiClient.post(
    `/ozon/chats/${shopId}/sync`,
    chatIdList || null,
  );
  return response.data.data;
};

// 下载聊天CSV文件（代理）
export const downloadChatCsv = async (
  shopId: number,
  csvUrl: string,
): Promise<any> => {
  const response = await apiClient.get(
    `/ozon/chats/${shopId}/csv-proxy`,
    {
      params: { url: csvUrl },
      responseType: 'blob', // 重要：告诉axios返回二进制数据
    },
  );
  return response;
};

// 获取聊天统计信息
export const getChatStats = async (
  shopId: number | null,
  shopIds?: string,
): Promise<ChatStats> => {
  // 如果shopId为null，使用全部店铺端点
  if (shopId === null) {
    const response = await apiClient.get("/ozon/chats/all/stats", {
      params: { shop_ids: shopIds },
    });
    return response.data.data;
  } else {
    const response = await apiClient.get(`/ozon/chats/${shopId}/stats`);
    return response.data.data;
  }
};

// ========== 报表相关 API ==========

// 获取订单报表（旧版，保留兼容）
export const getOrderReport = async (
  month: string,
  shopIds?: string,
): Promise<any> => {
  const params = new URLSearchParams({ month });
  if (shopIds) {
    params.append("shop_ids", shopIds);
  }
  const response = await apiClient.get(
    `/ozon/reports/orders?${params.toString()}`,
  );
  return response.data;
};

// 获取Posting级别报表（新版）
export const getPostingReport = async (
  month: string,
  shopIds?: string,
  statusFilter: "delivered" | "placed" = "delivered",
  page: number = 1,
  pageSize: number = 50,
  sortBy?: string,
  sortOrder: "asc" | "desc" = "desc",
  postingNumber?: string,
): Promise<any> => {
  const params = new URLSearchParams({
    month,
    status_filter: statusFilter,
    page: page.toString(),
    page_size: pageSize.toString(),
    sort_order: sortOrder,
  });
  if (shopIds) {
    params.append("shop_ids", shopIds);
  }
  if (sortBy) {
    params.append("sort_by", sortBy);
  }
  if (postingNumber) {
    params.append("posting_number", postingNumber);
  }
  const response = await apiClient.get(
    `/ozon/reports/postings?${params.toString()}`,
  );
  return response.data;
};

// 获取报表汇总数据（用于图表）
export const getReportSummary = async (
  month: string,
  shopIds?: string,
  statusFilter: "delivered" | "placed" = "delivered",
): Promise<any> => {
  const params = new URLSearchParams({
    month,
    status_filter: statusFilter,
  });
  if (shopIds) {
    params.append("shop_ids", shopIds);
  }
  const response = await apiClient.get(
    `/ozon/reports/summary?${params.toString()}`,
  );
  return response.data;
};

// 启动批量财务同步任务
export const startBatchFinanceSync = async (): Promise<{
  task_id: string;
  message: string;
}> => {
  const response = await apiClient.post(`/ozon/reports/batch-sync-finance`);
  return response.data;
};

// 查询批量财务同步进度
export const getBatchFinanceSyncProgress = async (
  taskId: string,
): Promise<any> => {
  const response = await apiClient.get(
    `/ozon/reports/batch-sync-finance/${taskId}`,
  );
  return response.data;
};

// ========== 跨境巴士同步 API ==========

export interface Kuajing84Config {
  enabled: boolean;
  username?: string;
  base_url?: string;
  has_cookie?: boolean;
}

export interface Kuajing84ConfigRequest {
  username: string;
  password: string;
  enabled: boolean;
}

export interface Kuajing84SyncLog {
  id: number;
  order_number: string;
  logistics_order: string;
  kuajing84_oid?: string;
  sync_status: "pending" | "success" | "failed";
  error_message?: string;
  attempts: number;
  created_at: string;
  synced_at?: string;
}

// 保存跨境巴士全局配置
export const saveKuajing84Config = async (config: Kuajing84ConfigRequest) => {
  const response = await apiClient.post("/ozon/kuajing84/config", config);
  return response.data;
};

// 获取跨境巴士全局配置
export const getKuajing84Config = async (): Promise<{
  success: boolean;
  data?: Kuajing84Config;
  message?: string;
}> => {
  const response = await apiClient.get("/ozon/kuajing84/config");
  return response.data;
};

// 测试跨境巴士连接
export const testKuajing84Connection = async (): Promise<{
  success: boolean;
  message: string;
  data?: unknown;
}> => {
  const response = await apiClient.post("/ozon/kuajing84/test-connection");
  return response.data;
};

// 同步物流单号到跨境巴士
export const syncToKuajing84 = async (
  ozonOrderId: number,
  postingNumber: string,
  logisticsOrder: string,
) => {
  const response = await apiClient.post("/ozon/kuajing84/sync", {
    ozon_order_id: ozonOrderId,
    posting_number: postingNumber,
    logistics_order: logisticsOrder,
  });
  return response.data;
};

// 获取跨境巴士同步日志
export const getKuajing84SyncLogs = async (
  shopId: number,
  status?: string,
  limit: number = 50,
): Promise<{ success: boolean; data: Kuajing84SyncLog[] }> => {
  const params: { limit: number; status?: string } = { limit };
  if (status) {
    params.status = status;
  }
  const response = await apiClient.get(`/ozon/kuajing84/logs/${shopId}`, {
    params,
  });
  return response.data;
};

// 更新订单额外信息
export interface OrderExtraInfo {
  purchase_price?: string;
  material_cost?: string;
  /** @deprecated 使用 domestic_tracking_numbers 代替 */
  domestic_tracking_number?: string;
  domestic_tracking_numbers?: string[]; // 国内物流单号列表（一对多关系）
  order_notes?: string;
  source_platform?: string;
}

export const updateOrderExtraInfo = async (
  postingNumber: string,
  extraInfo: OrderExtraInfo,
) => {
  const response = await apiClient.put(
    `/ozon/orders/${postingNumber}/extra-info`,
    extraInfo,
  );
  return response.data;
};

// 提交备货请求
export const prepareOrder = async (postingNumber: string) => {
  const response = await apiClient.post("/ozon/orders/prepare", {
    posting_number: postingNumber,
  });
  return response.data;
};

// 获取打包发货页面订单列表（支持操作状态筛选）
export const getPackingOrders = async (
  page: number = 1,
  pageSize: number = 50,
  params?: {
    shop_id?: number | null;
    posting_number?: string;
    sku?: string; // SKU搜索
    tracking_number?: string; // OZON追踪号码搜索
    domestic_tracking_number?: string; // 国内单号搜索
    delivery_method?: string; // 配送方式搜索（左匹配）
    operation_status?: string; // awaiting_stock/allocating/allocated/tracking_confirmed
    ozon_status?: string; // OZON原生状态，支持逗号分隔（如：awaiting_packaging,awaiting_deliver）
    source_platform?: string; // 采购平台筛选
    offset?: number; // 直接指定offset（用于无限滚动，优先级高于page计算）
  },
) => {
  const requestParams = {
    // 如果params中有offset，直接使用；否则根据page计算
    offset: params?.offset !== undefined ? params.offset : (page - 1) * pageSize,
    limit: pageSize,
    ...params,
  };
  // 如果shop_id为null（全部店铺），不传递该参数
  if (requestParams.shop_id === null) {
    delete requestParams.shop_id;
  }
  const response = await apiClient.get("/ozon/packing/orders", {
    params: requestParams,
  });
  return response.data;
};

// 获取打包发货各状态的统计数据（合并请求）
export const getPackingStats = async (params?: {
  shop_id?: number | null;
  posting_number?: string;
  sku?: string;
  tracking_number?: string;
  domestic_tracking_number?: string;
}): Promise<{
  success: boolean;
  data: {
    awaiting_stock: number;
    allocating: number;
    allocated: number;
    tracking_confirmed: number;
    printed: number;
    shipping: number;
  };
}> => {
  const requestParams = { ...params };
  // 如果shop_id为null（全部店铺），不传递该参数
  if (requestParams.shop_id === null) {
    delete requestParams.shop_id;
  }
  const response = await apiClient.get("/ozon/packing/stats", {
    params: requestParams,
  });
  return response.data;
};

// ==================== 打包发货操作 API ====================

// 备货操作请求参数
export interface PrepareStockRequest {
  purchase_price: string; // 进货价格（必填）
  source_platform?: string[]; // 采购平台列表（可选：1688/拼多多/咸鱼/淘宝/库存）
  order_notes?: string; // 订单备注（可选）
  sync_to_ozon?: boolean; // 是否同步到Ozon（可选，默认true）
}

// 更新业务信息请求参数
export interface UpdateBusinessInfoRequest {
  purchase_price?: string; // 进货价格（可选）
  material_cost?: string; // 打包费用（可选）
  source_platform?: string[]; // 采购平台列表（可选）
  order_notes?: string; // 订单备注（可选）
}

// 提交国内物流单号请求参数（支持多单号）
export interface SubmitDomesticTrackingRequest {
  domestic_tracking_numbers?: string[]; // 国内物流单号列表（推荐）
  /** @deprecated 使用 domestic_tracking_numbers 代替 */
  domestic_tracking_number?: string; // [已废弃] 单个国内物流单号（兼容字段）
  order_notes?: string; // 订单备注（可选）
  sync_to_kuajing84?: boolean; // 是否同步到跨境巴士（默认false）
}

// 备货操作：保存业务信息 + 调用 OZON exemplar set API
export const prepareStock = async (
  postingNumber: string,
  data: PrepareStockRequest,
) => {
  const response = await apiClient.post(
    `/ozon/postings/${postingNumber}/prepare`,
    data,
  );
  return response.data;
};

// 更新业务信息（不改变操作状态）
export const updatePostingBusinessInfo = async (
  postingNumber: string,
  data: UpdateBusinessInfoRequest,
) => {
  const response = await apiClient.patch(
    `/ozon/postings/${postingNumber}`,
    data,
  );
  return response.data;
};

// 填写国内物流单号 + 同步跨境巴士
export const submitDomesticTracking = async (
  postingNumber: string,
  data: SubmitDomesticTrackingRequest,
) => {
  const response = await apiClient.post(
    `/ozon/postings/${postingNumber}/domestic-tracking`,
    data,
  );
  return response.data;
};

// 更新国内物流单号列表（用于修正错误单号）
export interface UpdateDomesticTrackingRequest {
  domestic_tracking_numbers: string[]; // 完整的国内单号列表（会替换现有单号）
}

export const updateDomesticTracking = async (
  postingNumber: string,
  data: UpdateDomesticTrackingRequest,
) => {
  const response = await apiClient.patch(
    `/ozon/postings/${postingNumber}/domestic-tracking`,
    data,
  );
  return response.data;
};

// ==================== 商品进货价格历史 API ====================

export interface PurchasePriceHistory {
  posting_number: string;
  purchase_price: string | null;
  updated_at: string | null;
  source_platform?: string[]; // 采购平台列表
}

export interface PurchasePriceHistoryResponse {
  sku: string;
  product_name: string | null;
  offer_id: string | null;
  purchase_url: string | null;
  suggested_purchase_price: string | null;
  purchase_note: string | null;
  history: PurchasePriceHistory[];
  total: number;
}

// 获取商品SKU的进货价格历史记录
export const getProductPurchasePriceHistory = async (
  sku: string,
  limit: number = 10,
): Promise<PurchasePriceHistoryResponse> => {
  const response = await apiClient.get(
    `/ozon/products/${sku}/purchase-price-history`,
    {
      params: { limit },
    },
  );
  return response.data;
};

// ==================== 商品上架相关 API ====================

export interface Category {
  category_id: number;
  name: string;
  parent_id?: number;
  is_leaf: boolean;
  level: number;
}

export interface CategoryAttribute {
  attribute_id: number;
  category_id: number;
  name: string;
  description?: string;
  attribute_type: string;
  is_required: boolean;
  is_collection: boolean;
  is_aspect: boolean;
  dictionary_id?: number;
  category_dependent?: boolean;
  group_id?: number;
  group_name?: string;
  attribute_complex_id?: number;
  max_value_count?: number;
  complex_is_collection?: boolean;
  min_value?: number;
  max_value?: number;
  guide_values?: DictionaryValue[] | null;
  dictionary_value_count?: number | null;  // 字典值数量
  dictionary_values?: DictionaryValue[] | null;  // 预加载的字典值（≤100条时）
}

export interface DictionaryValue {
  value_id: number;
  value: string;
  info?: string;
  picture?: string;
}

export interface ListingStatus {
  status: string;
  mode?: string;
  product_id?: number;
  sku?: number;
  timestamps: {
    media_ready_at?: string;
    import_submitted_at?: string;
    created_at_ozon?: string;
    priced_at?: string;
    stock_set_at?: string;
    live_at?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

export interface MediaImportLog {
  id: number;
  source_url: string;
  file_name?: string;
  position: number;
  state: string;
  ozon_file_id?: string;
  ozon_url?: string;
  error_code?: string;
  error_message?: string;
  retry_count: number;
  created_at?: string;
}

export interface ProductImportLog {
  id: number;
  offer_id: string;
  import_mode: string;
  state: string;
  task_id?: string;
  ozon_product_id?: number;
  ozon_sku?: number;
  error_code?: string;
  error_message?: string;
  errors?: unknown;
  retry_count: number;
  created_at?: string;
  updated_at?: string;
}

// 获取类目树（三级联动）
export const getCategoryTree = async (shopId: number) => {
  const response = await apiClient.get("/ozon/listings/categories/tree", {
    params: { shop_id: shopId },
  });
  return response.data;
};

// 搜索类目
export const searchCategories = async (
  shopId: number,
  query: string,
  onlyLeaf: boolean = true,
  limit: number = 20,
) => {
  const response = await apiClient.get("/ozon/listings/categories/search", {
    params: { shop_id: shopId, query, only_leaf: onlyLeaf, limit },
  });
  return response.data;
};

// 获取类目属性
export const getCategoryAttributes = async (
  shopId: number,
  categoryId: number,
  requiredOnly: boolean = false,
) => {
  const response = await apiClient.get(
    `/ozon/listings/categories/${categoryId}/attributes`,
    {
      params: { shop_id: shopId, required_only: requiredOnly },
    },
  );
  return response.data;
};

// 搜索属性字典值（直接调用OZON API）
export const searchAttributeValues = async (
  shopId: number,
  categoryId: number,
  attributeId: number,
  query?: string,
  limit: number = 100,
) => {
  const response = await apiClient.get(
    `/ozon/listings/categories/${categoryId}/attributes/${attributeId}/values/search`,
    {
      params: { shop_id: shopId, query, limit },
    },
  );
  return response.data;
};

// 废弃：保留旧方法名以保持向后兼容（但实际上无法工作，因为API已改变）
export const searchDictionaryValues = searchAttributeValues;

// 同步类目树（同步模式，会阻塞）
export const syncCategoryTree = async (
  shopId: number,
  forceRefresh: boolean = false,
  rootCategoryId?: number,
) => {
  const response = await apiClient.post("/ozon/listings/categories/sync", {
    shop_id: shopId,
    force_refresh: forceRefresh,
    root_category_id: rootCategoryId,
  });
  return response.data;
};

// 异步同步类目树（异步任务模式，推荐使用）
export const syncCategoryTreeAsync = async (
  shopId: number,
  forceRefresh: boolean = true,
) => {
  const response = await apiClient.post("/ozon/listings/categories/sync-async", {
    shop_id: shopId,
    force_refresh: forceRefresh,
  });
  return response.data;
};

// 查询类目同步任务状态
export const getCategorySyncTaskStatus = async (taskId: string) => {
  const response = await apiClient.get(
    `/ozon/listings/categories/sync-async/status/${taskId}`,
  );
  return response.data;
};

// 批量同步类目特征（中文）- 异步任务模式
export const batchSyncCategoryAttributes = async (
  shopId: number,
  options: {
    categoryIds?: number[];
    syncAllLeaf?: boolean;
    syncDictionaryValues?: boolean;
    language?: string;
    maxConcurrent?: number;
  } = {},
) => {
  const response = await apiClient.post(
    "/ozon/listings/categories/batch-sync-attributes",
    {
      shop_id: shopId,
      category_ids: options.categoryIds,
      sync_all_leaf: options.syncAllLeaf || false,
      sync_dictionary_values: options.syncDictionaryValues !== false,
      language: options.language || "ZH_HANS",
      max_concurrent: options.maxConcurrent || 5,
    },
  );
  return response.data;
};

// 查询批量同步任务状态
export const getBatchSyncTaskStatus = async (taskId: string) => {
  const response = await apiClient.get(
    `/ozon/listings/categories/batch-sync-attributes/status/${taskId}`,
  );
  return response.data;
};

// 同步单个类目的特征
export const syncSingleCategoryAttributes = async (
  categoryId: number,
  shopId: number,
  options: {
    language?: string;
    forceRefresh?: boolean;
    syncDictionaryValues?: boolean;
  } = {},
) => {
  const response = await apiClient.post(
    `/ozon/listings/categories/${categoryId}/sync-attributes`,
    null,
    {
      params: {
        shop_id: shopId,
        language: options.language || "ZH_HANS",
        force_refresh: options.forceRefresh || false,
        sync_dictionary_values: options.syncDictionaryValues !== false,
      },
    },
  );
  return response.data;
};

// 导入商品（完整上架流程）
export const importProduct = async (
  shopId: number,
  offerId: string,
  mode: "NEW_CARD" | "FOLLOW_PDP" = "NEW_CARD",
  autoAdvance: boolean = true,
) => {
  const response = await apiClient.post("/ozon/listings/products/import", {
    shop_id: shopId,
    offer_id: offerId,
    mode,
    auto_advance: autoAdvance,
  });
  return response.data;
};

// 重新上架商品（从归档中还原）
export const unarchiveProduct = async (shopId: number, productId: number) => {
  const response = await apiClient.post("/ozon/listings/products/unarchive", {
    shop_id: shopId,
    product_id: productId,
  });
  return response.data;
};

// 获取商品上架状态
export const getListingStatus = async (shopId: number, offerId: string) => {
  const response = await apiClient.get(
    `/ozon/listings/products/${offerId}/status`,
    {
      params: { shop_id: shopId },
    },
  );
  return response.data;
};

// 更新商品价格
export const updateListingPrice = async (
  offerId: string,
  shopId: number,
  price: string,
  oldPrice?: string,
  minPrice?: string,
  currencyCode: string = "RUB",
  autoActionEnabled: boolean = false,
) => {
  const response = await apiClient.post(
    `/ozon/listings/products/${offerId}/price`,
    {
      shop_id: shopId,
      price,
      old_price: oldPrice,
      min_price: minPrice,
      currency_code: currencyCode,
      auto_action_enabled: autoActionEnabled,
    },
  );
  return response.data;
};

// 更新商品库存
export const updateListingStock = async (
  offerId: string,
  shopId: number,
  stock: number,
  warehouseId: number = 1,
  productId?: number,
) => {
  const response = await apiClient.post(
    `/ozon/listings/products/${offerId}/stock`,
    {
      shop_id: shopId,
      stock,
      warehouse_id: warehouseId,
      product_id: productId,
    },
  );
  return response.data;
};

// 导入商品图片
export const importProductImages = async (
  offerId: string,
  shopId: number,
  imageUrls: string[],
  validateProperties: boolean = false,
) => {
  const response = await apiClient.post(
    `/ozon/listings/products/${offerId}/images`,
    {
      shop_id: shopId,
      image_urls: imageUrls,
      validate_properties: validateProperties,
    },
  );
  return response.data;
};

// 获取图片导入状态
export const getImagesStatus = async (
  offerId: string,
  shopId: number,
  state?: string,
) => {
  const response = await apiClient.get(
    `/ozon/listings/products/${offerId}/images/status`,
    {
      params: { shop_id: shopId, state },
    },
  );
  return response.data;
};

// 获取商品导入日志
export const getProductImportLogs = async (
  shopId: number,
  offerId?: string,
  state?: string,
  limit: number = 50,
) => {
  const response = await apiClient.get("/ozon/listings/logs/products", {
    params: { shop_id: shopId, offer_id: offerId, state, limit },
  });
  return response.data;
};

// ==================== 新建商品相关 API ====================

// 视频信息接口
export interface VideoInfo {
  url: string;              // 视频URL（YouTube、OZON视频平台等）
  name?: string;            // 视频名称
  is_cover?: boolean;       // 是否为封面视频（每个商品只能有1个封面视频）
}

// 创建商品记录到数据库
export interface CreateProductRequest {
  shop_id: number;
  offer_id: string;
  title: string;
  description?: string;
  barcode?: string;
  price?: string;
  old_price?: string;
  premium_price?: string;  // 会员价
  currency_code?: string;
  category_id?: number;
  type_id?: number;                  // 商品类型ID（第3层叶子类目）
  description_category_id?: number;  // 父类目ID（第2层）
  images?: string[];
  images360?: string[];    // 360度图片
  color_image?: string;    // 颜色营销图
  videos?: VideoInfo[];    // 视频列表
  pdf_list?: string[];     // PDF文档列表
  attributes?: unknown[];  // 类目属性
  variants?: unknown[];    // 变体数据
  promotions?: number[];   // 参与的促销活动ID
  height?: number;
  width?: number;
  depth?: number;
  dimension_unit?: string;
  weight?: number;
  weight_unit?: string;
  vat?: string;
}

export const createProduct = async (data: CreateProductRequest) => {
  const response = await apiClient.post("/ozon/listings/products/create", data);
  return response.data;
};

// 查询商品导入状态
export interface ProductImportStatusResponse {
  success: boolean;
  status?: 'imported' | 'failed' | 'processing' | 'pending' | 'unknown';
  product_id?: number;
  sku?: number;
  offer_id?: string;
  errors?: Array<{ code: string; message: string }>;
  error_messages?: string[];
  message?: string;
  error?: string;
}

export const getProductImportStatus = async (
  taskId: string,
  shopId: number
): Promise<ProductImportStatusResponse> => {
  const response = await apiClient.get(
    `/ozon/listings/products/import-status/${taskId}`,
    { params: { shop_id: shopId } }
  );
  return response.data;
};

// 上传图片/视频到图床
export interface UploadMediaRequest {
  shop_id: number;
  type: "base64" | "url";
  media_type?: "image" | "video";  // 媒体类型（默认为image）
  data?: string;      // For base64
  url?: string;       // For URL
  public_id?: string;
  folder?: string;
}

export const uploadMedia = async (data: UploadMediaRequest) => {
  const response = await apiClient.post("/ozon/listings/media/upload", data);
  return response.data;
};

// 上传文件（multipart/form-data）
export interface UploadMediaFileResponse {
  success: boolean;
  url?: string;
  public_id?: string;
  size_mb?: number;
  source?: string;
  error?: string;
}

export const uploadMediaFile = async (
  file: File,
  shopId: number,
  mediaType: "image" | "video" = "image",
  folder?: string
): Promise<UploadMediaFileResponse> => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("shop_id", shopId.toString());
  formData.append("media_type", mediaType);
  if (folder) {
    formData.append("folder", folder);
  }

  const response = await apiClient.post("/ozon/listings/media/upload-file", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
};

// ==================== 批量打印标签 API ====================

export interface FailedPosting {
  posting_number: string;
  error: string;
  suggestion: string;
}

export interface BatchPrintResult {
  success: boolean;
  message: string;
  pdf_url?: string;
  cached_count?: number;
  fetched_count?: number;
  total?: number;
  error?: string;
  failed_postings?: FailedPosting[];
  success_postings?: string[];
}

/**
 * 批量打印快递面单（70x125mm竖向标签）
 *
 * @param postingNumbers 货件编号列表（最多20个）
 * @returns 批量打印结果，包含PDF URL和详细错误信息
 * @note shop_id自动从posting记录中获取，无需手动指定
 */
export const batchPrintLabels = async (
  postingNumbers: string[],
): Promise<BatchPrintResult> => {
  if (postingNumbers.length > 20) {
    throw new Error("最多支持同时打印20个标签");
  }

  const response = await apiClient.post(
    "/ozon/packing/postings/batch-print-labels",
    {
      posting_numbers: postingNumbers,
    },
  );
  return response.data;
};

/**
 * 根据追踪号码查询货件
 * @param trackingNumber 追踪号码
 * @returns 货件详情（包含订单信息、商品列表）
 */
export const searchPostingByTracking = async (trackingNumber: string) => {
  const response = await apiClient.get(
    "/ozon/packing/postings/search-by-tracking",
    {
      params: { tracking_number: trackingNumber },
    },
  );
  return response.data;
};

/**
 * 标记货件为已打印状态
 * @param postingNumber 货件编号
 * @returns 操作结果
 */
export const markPostingPrinted = async (postingNumber: string) => {
  const response = await apiClient.post(
    `/ozon/packing/postings/${postingNumber}/mark-printed`,
  );
  return response.data;
};

/**
 * 从跨境巴士同步单个发货单的打包费用
 * @param postingNumber 货件编号
 * @returns 同步结果，包含更新后的打包费用、国内物流单号、利润等信息
 */
export const syncMaterialCost = async (postingNumber: string) => {
  const response = await apiClient.post(
    `/ozon/postings/${postingNumber}/sync-material-cost`,
  );
  return response.data;
};

/**
 * 从 OZON 同步单个发货单的财务费用
 * @param postingNumber 货件编号
 * @returns 同步结果，包含更新后的 OZON 佣金、物流费用、利润等信息
 */
export const syncFinance = async (postingNumber: string) => {
  const response = await apiClient.post(
    `/ozon/postings/${postingNumber}/sync-finance`,
  );
  return response.data;
};

// ==================== 财务交易相关 API ====================

export interface FinanceTransaction {
  id: number;
  shop_id: number;
  operation_id: number;
  operation_type: string;
  operation_type_name?: string;
  transaction_type: string;
  posting_number?: string;
  operation_date: string;
  accruals_for_sale: string;
  amount: string;
  delivery_charge: string;
  return_delivery_charge: string;
  sale_commission: string;
  ozon_sku?: string;
  item_name?: string;
  item_quantity?: number;
  item_price?: string;
  posting_delivery_schema?: string;
  posting_warehouse_name?: string;
  created_at: string;
}

export interface FinanceTransactionsResponse {
  items: FinanceTransaction[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface FinanceTransactionsSummary {
  total_amount: string;
  total_accruals_for_sale: string;
  total_sale_commission: string;
  total_delivery_charge: string;
  total_return_delivery_charge: string;
  transaction_count: number;
}

export interface FinanceTransactionsFilter {
  shop_id?: number | null;
  date_from?: string;
  date_to?: string;
  transaction_type?: string;
  operation_type?: string;
  posting_number?: string;
  posting_status?: string;
  page?: number;
  page_size?: number;
}

export interface FinanceTransactionDailySummary {
  operation_date: string;
  transaction_count: number;
  total_amount: string;
  total_accruals_for_sale: string;
  total_sale_commission: string;
  total_delivery_charge: string;
  total_return_delivery_charge: string;
}

export interface FinanceTransactionsDailySummaryResponse {
  items: FinanceTransactionDailySummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * 获取财务交易列表
 */
export const getFinanceTransactions = async (
  filter: FinanceTransactionsFilter,
): Promise<FinanceTransactionsResponse> => {
  const response = await apiClient.get("/ozon/finance/transactions", {
    params: filter,
  });
  return response.data;
};

/**
 * 获取财务交易汇总
 */
export const getFinanceTransactionsSummary = async (
  shopId: number | null,
  dateFrom?: string,
  dateTo?: string,
  transactionType?: string,
  postingStatus?: string,
): Promise<FinanceTransactionsSummary> => {
  const params: { shop_id?: number; date_from?: string; date_to?: string; transaction_type?: string; posting_status?: string } = {};
  if (shopId !== null) params.shop_id = shopId;
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  if (transactionType) params.transaction_type = transactionType;
  if (postingStatus) params.posting_status = postingStatus;

  const response = await apiClient.get("/ozon/finance/transactions/summary", {
    params,
  });
  return response.data;
};

/**
 * 获取财务交易按日期汇总
 */
export const getFinanceTransactionsDailySummary = async (
  filter: FinanceTransactionsFilter,
): Promise<FinanceTransactionsDailySummaryResponse> => {
  const response = await apiClient.get("/ozon/finance/transactions/daily-summary", {
    params: filter,
  });
  return response.data;
};

// ==================== 全局设置 ====================

/**
 * 获取所有全局设置
 */
export const getGlobalSettings = async (): Promise<any> => {
  const response = await apiClient.get("/ozon/global-settings");
  return response.data;
};

/**
 * 更新全局设置
 */
export const updateGlobalSetting = async (key: string, value: any): Promise<any> => {
  const response = await apiClient.put(`/ozon/global-settings/${key}`, {
    setting_value: value,
  });
  return response.data;
};

// ==================== 类目佣金 ====================

/**
 * 查询类目佣金列表
 */
export const getCategoryCommissions = async (params: {
  page: number;
  page_size: number;
  module?: string;
  search?: string;
}): Promise<any> => {
  const response = await apiClient.get("/ozon/category-commissions", { params });
  return response.data;
};

/**
 * 获取类目模块列表
 */
export const getCategoryModules = async (): Promise<string[]> => {
  const response = await apiClient.get("/ozon/category-commissions/modules");
  return response.data;
};

/**
 * 更新类目佣金
 */
export const updateCategoryCommission = async (
  id: number,
  data: {
    rfbs_tier1: number;
    rfbs_tier2: number;
    rfbs_tier3: number;
    fbp_tier1: number;
    fbp_tier2: number;
    fbp_tier3: number;
  }
): Promise<any> => {
  const response = await apiClient.put(`/ozon/category-commissions/${id}`, data);
  return response.data;
};

/**
 * 导入类目佣金CSV
 */
export const importCommissionsCsv = async (formData: FormData): Promise<any> => {
  const response = await apiClient.post("/ozon/category-commissions/import-csv", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
};

// ============ 促销活动接口 ============

export interface PromotionAction {
  action_id: number;
  title: string;
  description?: string;
  date_start?: string;
  date_end?: string;
  candidates_count?: number;
  products_count?: number;
}

/**
 * 获取店铺促销活动列表
 */
export const getPromotionActions = async (shopId: number): Promise<PromotionAction[]> => {
  const response = await apiClient.get(`/ozon/shops/${shopId}/promotions/actions`);
  return response.data?.data || [];
};

// ============ 取消和退货申请接口 ============

export interface Cancellation {
  id: number;
  cancellation_id: number;
  posting_number: string;
  order_date: string | null;
  cancelled_at: string | null;
  cancellation_initiator: string | null;
  cancellation_reason_name: string | null;
  state: string;
  state_name: string | null;
  auto_approve_date: string | null;
}

export interface Return {
  id: number;
  return_id: number;
  return_number: string;
  posting_number: string;
  order_number: string | null;
  client_name: string | null;
  product_name: string | null;
  offer_id: string | null;
  sku: number | null;
  price: string | null;
  currency_code: string | null;
  group_state: string;
  state: string; // 详细状态标识
  state_name: string | null;
  money_return_state_name: string | null;
  delivery_method_name: string | null; // 物流方式
  // 从详情API获取的字段
  return_reason_id: number | null;
  return_reason_name: string | null;
  rejection_reason_id: number | null;
  rejection_reason_name: string | null;
  return_method_description: string | null;
  created_at_ozon: string | null;
  // 商品图片（从商品表JOIN获取）
  image_url: string | null;
}

export interface CancellationListResponse {
  items: Cancellation[];
  total: number;
  page: number;
  limit: number;
}

export interface ReturnListResponse {
  items: Return[];
  total: number;
  page: number;
  limit: number;
}

export interface CancellationFilter {
  page?: number;
  limit?: number;
  shop_id?: number | null;
  state?: string;
  initiator?: string;
  posting_number?: string;
  date_from?: string;
  date_to?: string;
}

export interface ReturnFilter {
  page?: number;
  limit?: number;
  shop_id?: number | null;
  group_state?: string;
  posting_number?: string;
  offer_id?: string;
  date_from?: string;
  date_to?: string;
}

/**
 * 获取取消申请列表
 */
export const getCancellations = async (filter: CancellationFilter): Promise<CancellationListResponse> => {
  const response = await apiClient.get('/ozon/cancel-return/cancellations', { params: filter });
  return response.data;
};

/**
 * 获取退货申请列表
 */
export const getReturns = async (filter: ReturnFilter): Promise<ReturnListResponse> => {
  const response = await apiClient.get('/ozon/cancel-return/returns', { params: filter });
  return response.data;
};

/**
 * 获取退货申请详情
 */
export const getReturnDetail = async (returnId: number): Promise<Return> => {
  const response = await apiClient.get(`/ozon/cancel-return/returns/${returnId}`);
  return response.data;
};

/**
 * 手动同步取消申请
 */
export const syncCancellations = async (shopId: number | null): Promise<any> => {
  const response = await apiClient.post('/ozon/cancel-return/cancellations/sync', {
    shop_id: shopId
  });
  return response.data;
};

/**
 * 手动同步退货申请
 */
export const syncReturns = async (shopId: number | null): Promise<any> => {
  const response = await apiClient.post('/ozon/cancel-return/returns/sync', {
    shop_id: shopId
  });
  return response.data;
};

// ==================== 库存管理 API ====================

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
  notes?: string;
  updated_at: string;
}

export interface AddStockRequest {
  shop_id: number;
  sku: string;
  quantity: number;
  notes?: string;
}

export interface UpdateStockRequest {
  quantity: number;
  notes?: string;
}

export interface StockCheckItem {
  sku: string;
  product_title?: string;
  product_image?: string;
  stock_available: number;
  order_quantity: number;
  is_sufficient: boolean;
}

/**
 * 获取库存列表
 */
export const getStockList = async (params?: {
  shop_id?: number;
  sku?: string;
  page?: number;
  page_size?: number;
}): Promise<{
  items: StockItem[];
  total: number;
  page: number;
  page_size: number;
}> => {
  const response = await apiClient.get('/ozon/stock', { params });
  return response.data.data;
};

/**
 * 添加库存
 */
export const addStock = async (data: AddStockRequest): Promise<{ id: number; message: string }> => {
  const response = await apiClient.post('/ozon/stock', data);
  return response.data.data;
};

/**
 * 更新库存
 */
export const updateStock = async (stockId: number, data: UpdateStockRequest): Promise<{ message: string }> => {
  const response = await apiClient.put(`/ozon/stock/${stockId}`, data);
  return response.data.data;
};

/**
 * 删除库存
 */
export const deleteStock = async (stockId: number): Promise<{ message: string }> => {
  const response = await apiClient.delete(`/ozon/stock/${stockId}`);
  return response.data.data;
};

/**
 * 检查订单商品的库存情况（备货时使用）
 */
export const checkStockForPosting = async (postingNumber: string): Promise<{
  posting_number: string;
  items: StockCheckItem[];
}> => {
  const response = await apiClient.get(`/ozon/stock/check/${postingNumber}`);
  return response.data.data;
};
