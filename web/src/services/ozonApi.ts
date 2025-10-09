/* eslint-disable no-unused-vars */
/**
 * Ozon API 服务
 * 处理与后端 Ozon 接口的通信
 */
import axios from 'axios';
import authService from './authService';

const API_BASE = '/api/ef/v1';

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
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
  }
);

// 响应拦截器：处理错误和token刷新
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // 尝试刷新token
      const refreshed = await authService.refreshToken();
      if (refreshed) {
        // 重新设置认证头并重试请求
        const authHeaders = authService.getAuthHeader();
        originalRequest.headers.Authorization = authHeaders.Authorization;
        return apiClient(originalRequest);
      } else {
        // 刷新失败，跳转登录
        authService.logout();
      }
    }
    return Promise.reject(error);
  }
);

// ==================== 商品相关 API ====================

export interface ProductImages {
  primary?: string;
  additional?: string[];
  count?: number;
}

// ==================== 店铺 API ====================

// 获取店铺列表
export const getShops = async () => {
  const response = await apiClient.get('/ozon/shops');
  return response.data;
};

// 创建店铺
interface ShopData {
  name: string;
  client_id: string;
  api_key: string;
  [key: string]: unknown;
}

export const createShop = async (data: ShopData) => {
  const response = await apiClient.post('/ozon/shops', data);
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
  const response = await apiClient.post(`/ozon/shops/${shopId}/test-connection`);
  return response.data;
};

// 测试API连接
export const testApiConnection = async (credentials: { client_id: string; api_key: string }) => {
  const response = await apiClient.post('/ozon/test-connection', credentials);
  return response.data;
};

// ==================== 商品 API ====================

export interface ProductAttributes {
  [key: string]: unknown;
}

export interface Product {
  id: number;
  shop_id: number;
  sku: string;
  offer_id: string;
  ozon_product_id?: number;
  ozon_sku?: number;
  title: string;
  description?: string;
  barcode?: string;
  category_id?: number;
  category_name?: string;
  brand?: string;
  status: 'on_sale' | 'ready_to_sell' | 'error' | 'pending_modification' | 'inactive' | 'archived';
  ozon_status?: string;
  status_reason?: string;
  ozon_visibility_details?: {
    has_price?: boolean;
    has_stock?: boolean;
    [key: string]: any;
  };
  visibility: boolean;
  is_archived: boolean;
  price?: string;
  old_price?: string;
  premium_price?: string;
  cost?: string;
  min_price?: string;
  stock: number;
  reserved: number;
  available: number;
  weight?: number;
  width?: number;
  height?: number;
  depth?: number;
  ozon_archived?: boolean;
  ozon_has_fbo_stocks?: boolean;
  ozon_has_fbs_stocks?: boolean;
  ozon_is_discounted?: boolean;
  ozon_visibility_status?: string;
  images?: ProductImages;
  attributes?: ProductAttributes;
  last_sync_at?: string;
  sync_status: 'pending' | 'syncing' | 'success' | 'failed' | 'imported';
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
  search?: string;  // 通用搜索
  price_min?: number;
  price_max?: number;
  has_stock?: boolean;
  visibility?: string;
  archived?: boolean;
  brand?: string;
}

export interface PriceUpdate {
  sku: string;
  price: string;
  old_price?: string;
  premium_price?: string;
  reason?: string;
}

export interface StockUpdate {
  sku: string;
  stock: number;
  warehouse_id?: number;
}

// 获取商品列表
export const getProducts = async (
  page: number = 1,
  pageSize: number = 20,
  filter?: ProductFilter
) => {
  const params: any = {
    page: page,
    page_size: pageSize,
    ...filter,
  };
  // 如果shop_id为null（全部店铺），不传递该参数
  if (params.shop_id === null) {
    delete params.shop_id;
  }
  const response = await apiClient.get('/ozon/products', { params });
  return response.data;
};

// 获取商品详情
export const getProduct = async (productId: number) => {
  const response = await apiClient.get(`/ozon/products/${productId}`);
  return response.data;
};

// 同步商品
export const syncProducts = async (shopId?: number | null, fullSync: boolean = false) => {
  // 如果没有指定店铺，获取第一个店铺
  if (!shopId) {
    const shopsResponse = await apiClient.get('/ozon/shops');
    const shops = shopsResponse.data.data;
    if (!shops || shops.length === 0) {
      throw new Error('没有找到可用的店铺');
    }
    shopId = shops[0].id;
  }

  const response = await apiClient.post(`/ozon/shops/${shopId}/sync`, null, {
    params: {
      sync_type: 'products',
      products_mode: fullSync ? 'full' : 'incremental'
    },
  });
  return response.data;
};

// 批量更新价格
export const updatePrices = async (updates: PriceUpdate[], shopId?: number) => {
  const data: any = { updates };
  if (shopId) {
    data.shop_id = shopId;
  }
  const response = await apiClient.post('/ozon/products/prices', data);
  return response.data;
};

// 批量更新库存
export const updateStocks = async (updates: StockUpdate[], shopId?: number) => {
  const data: any = { updates };
  if (shopId) {
    data.shop_id = shopId;
  }
  const response = await apiClient.post('/ozon/products/stocks', data);
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
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  ozon_status?: string;
  payment_status?: string;
  order_type: 'FBS' | 'FBO' | 'CrossDock';
  is_express: boolean;
  is_premium: boolean;
  total_amount: string;
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
  ordered_at: string;
  in_process_at?: string; // Added for compatibility
  confirmed_at?: string;
  shipped_at?: string;
  delivered_at?: string;
  cancelled_at?: string;
  purchase_price?: string;
  domestic_tracking_number?: string;
  material_cost?: string;
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

export interface Posting {
  id: number;
  posting_number: string;
  ozon_posting_number?: string;
  status: string;
  substatus?: string;
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

// 获取订单列表
export const getOrders = async (page: number = 1, pageSize: number = 50, filter?: OrderFilter) => {
  const params: any = {
    offset: (page - 1) * pageSize,
    limit: pageSize,
    ...filter,
  };
  // 如果shop_id为null（全部店铺），不传递该参数
  if (params.shop_id === null) {
    delete params.shop_id;
  }
  const response = await apiClient.get('/ozon/orders', { params });
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
  dateTo?: string
) => {
  // 如果没有指定店铺，获取第一个店铺
  if (!shopId) {
    const shopsResponse = await apiClient.get('/ozon/shops');
    const shops = shopsResponse.data.data;
    if (!shops || shops.length === 0) {
      throw new Error('没有找到可用的店铺');
    }
    shopId = shops[0].id;
  }

  // 根据是否有日期范围决定同步模式
  const mode = dateFrom && dateTo ? 'full' : 'incremental';

  const response = await apiClient.post(`/ozon/shops/${shopId}/sync`, null, {
    params: {
      sync_type: 'orders',
      orders_mode: mode
    },
  });
  return response.data;
};

// 直接同步订单（新接口）
export const syncOrdersDirect = async (
  shopId: number,
  mode: 'full' | 'incremental' = 'incremental'
) => {
  const response = await apiClient.post('/ozon/orders/sync', {
    shop_id: shopId,
    mode: mode
  });
  return response.data;
};

// 获取同步任务状态
export const getSyncStatus = async (taskId: string) => {
  const response = await apiClient.get(`/ozon/sync/status/${taskId}`);
  return response.data;
};

// 发货
export const shipOrder = async (shipment: ShipmentRequest) => {
  const response = await apiClient.post('/ozon/orders/ship', shipment);
  return response.data;
};

// 取消订单
export const cancelOrder = async (postingNumber: string, reason: string) => {
  const response = await apiClient.post('/ozon/orders/cancel', {
    posting_number: postingNumber,
    reason,
  });
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
  };
  revenue: {
    today: string;
    week: string;
    month: string;
  };
}

// 获取统计数据
export const getStatistics = async (shopId?: number | null) => {
  const params: any = {};
  if (shopId) {
    params.shop_id = shopId;
  }
  const response = await apiClient.get('/ozon/statistics', { params });
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
  const response = await apiClient.get('/ozon/sync-logs', { params });
  return response.data;
};

// 获取同步任务状态
export const getSyncTaskStatus = async (taskId: string) => {
  const response = await apiClient.get(`/ozon/sync/task/${taskId}`);
  return response.data;
};

// 订单详情API
export const getOrderDetail = async (postingNumber: string, shopId?: number) => {
  const params: any = {};
  if (shopId) {
    params.shop_id = shopId;
  }
  const response = await apiClient.get(`/ozon/orders/${postingNumber}`, { params });
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
  status: 'pending' | 'processing' | 'processed' | 'failed' | 'ignored';
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
export const getWebhookConfig = async (shopId: number): Promise<WebhookConfig> => {
  const response = await apiClient.get(`/ozon/shops/${shopId}/webhook`);
  return response.data;
};

// 配置Webhook
export const configureWebhook = async (shopId: number, config: { webhook_url: string; webhook_secret?: string }) => {
  const response = await apiClient.post(`/ozon/shops/${shopId}/webhook`, config);
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
  offset: number = 0
): Promise<{ events: WebhookEvent[]; total: number; limit: number; offset: number }> => {
  const params: any = {
    shop_id: shopId,
    limit,
    offset,
  };
  if (status) {
    params.status = status;
  }

  const response = await apiClient.get('/ozon/webhook/events', { params });
  return response.data;
};

// 重试失败的Webhook事件
export const retryWebhookEvent = async (eventId: string) => {
  const response = await apiClient.post(`/ozon/webhook/events/${eventId}/retry`);
  return response.data;
};

// ==================== 聊天相关 API ====================

export interface OzonChat {
  id: number;
  chat_id: string;
  chat_type?: string;
  subject?: string;
  customer_id?: string;
  customer_name?: string;
  status: string;
  is_closed: boolean;
  order_number?: string;
  product_id?: number;
  message_count: number;
  unread_count: number;
  last_message_at?: string;
  last_message_preview?: string;
  closed_at?: string;
  created_at: string;
  updated_at?: string;
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
  content_data?: any;
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
  shopId: number,
  params?: {
    status?: string;
    has_unread?: boolean;
    order_number?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ items: OzonChat[]; total: number; limit: number; offset: number }> => {
  const response = await apiClient.get(`/ozon/chats/${shopId}`, { params });
  return response.data.data;
};

// 获取聊天详情
export const getChatDetail = async (shopId: number, chatId: string): Promise<OzonChat> => {
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
  }
): Promise<{ items: OzonChatMessage[]; total: number; chat_id: string }> => {
  const response = await apiClient.get(`/ozon/chats/${shopId}/${chatId}/messages`, { params });
  return response.data.data;
};

// 发送消息
export const sendChatMessage = async (
  shopId: number,
  chatId: string,
  content: string
): Promise<any> => {
  const response = await apiClient.post(`/ozon/chats/${shopId}/${chatId}/messages`, { content });
  return response.data.data;
};

// 发送文件
export const sendChatFile = async (
  shopId: number,
  chatId: string,
  fileUrl: string,
  fileName: string
): Promise<any> => {
  const response = await apiClient.post(`/ozon/chats/${shopId}/${chatId}/files`, {
    file_url: fileUrl,
    file_name: fileName,
  });
  return response.data.data;
};

// 标记聊天为已读
export const markChatAsRead = async (shopId: number, chatId: string): Promise<any> => {
  const response = await apiClient.post(`/ozon/chats/${shopId}/${chatId}/read`);
  return response.data.data;
};

// 关闭聊天
export const closeChat = async (shopId: number, chatId: string): Promise<any> => {
  const response = await apiClient.post(`/ozon/chats/${shopId}/${chatId}/close`);
  return response.data.data;
};

// 同步聊天数据
export const syncChats = async (shopId: number, chatIdList?: string[]): Promise<any> => {
  const response = await apiClient.post(`/ozon/chats/${shopId}/sync`, chatIdList || null);
  return response.data.data;
};

// 获取聊天统计信息
export const getChatStats = async (shopId: number): Promise<ChatStats> => {
  const response = await apiClient.get(`/ozon/chats/${shopId}/stats`);
  return response.data.data;
};
