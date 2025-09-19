/* eslint-disable no-unused-vars */
/**
 * Ozon API 服务
 * 处理与后端 Ozon 接口的通信
 */
import axios from 'axios';

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
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器：处理错误
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 未授权，跳转登录
      window.location.href = '/login';
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
export const syncProducts = async (shopId?: number | null, _fullSync: boolean = false) => {
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
      sync_type: 'products'
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
    street?: string;
    building?: string;
    apartment?: string;
    postal_code?: string;
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
  mode: 'full' | 'incremental' = 'incremental',
  _dateFrom?: string,
  _dateTo?: string
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
