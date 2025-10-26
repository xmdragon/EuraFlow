/**
 * 选品助手API服务
 */
import axios from './axios';

export interface ProductSelectionItem {
  id: number;
  product_id: string;
  product_name_ru: string;
  product_name_cn: string;
  ozon_link: string;
  image_url: string;
  brand: string;
  current_price: number;
  original_price: number;
  rfbs_commission_low: number;
  rfbs_commission_mid: number;
  rfbs_commission_high: number;
  fbp_commission_low: number;
  fbp_commission_mid: number;
  fbp_commission_high: number;
  monthly_sales_volume: number;
  monthly_sales_revenue?: number;        // 月销售额(RUB)
  daily_sales_volume?: number;           // 日销量
  daily_sales_revenue?: number;          // 日销售额(RUB)
  sales_dynamic_percent?: number;        // 月销售动态(%)
  conversion_rate?: number;              // 成交率(%)
  package_weight: number;
  package_volume?: number;               // 包装体积(升)
  package_length?: number;               // 包装长度(mm)
  package_width?: number;                // 包装宽度(mm)
  package_height?: number;               // 包装高度(mm)
  rating: number;
  review_count: number;
  seller_type: string;
  delivery_days?: number;                // 配送时间(天)
  availability_percent?: number;         // 可用性(%)
  ad_cost_share?: number;                // 广告费用份额(%)
  // 竞争对手数据
  competitor_count?: number;
  competitor_min_price?: number;
  market_min_price?: number;
  price_index?: number;
  // 营销分析字段（上品帮）
  card_views?: number;                   // 商品卡片浏览量
  card_add_to_cart_rate?: number;        // 商品卡片加购率(%)
  search_views?: number;                 // 搜索和目录浏览量
  search_add_to_cart_rate?: number;      // 搜索和目录加购率(%)
  click_through_rate?: number;           // 点击率(%)
  promo_days?: number;                   // 参与促销天数
  promo_discount_percent?: number;       // 参与促销的折扣(%)
  promo_conversion_rate?: number;        // 促销活动的转化率(%)
  paid_promo_days?: number;              // 付费推广天数
  return_cancel_rate?: number;           // 退货取消率(%)
  // 基础字段（上品帮）
  category_path?: string;                // 类目路径
  avg_price?: number;                    // 平均价格(RUB)
  listing_date?: string;                 // 上架时间
  listing_days?: number;                 // 上架天数
  seller_mode?: string;                  // 发货模式(FBS/FBO)
  // 批次管理
  batch_id?: number;
  is_read?: boolean;
  read_at?: string;
  // 商品上架时间
  product_created_date?: string;
  created_at: string;
  updated_at: string;
}

export interface ProductSearchParams {
  product_name?: string;
  brand?: string;
  rfbs_low_max?: number;
  rfbs_mid_max?: number;
  fbp_low_max?: number;
  fbp_mid_max?: number;
  monthly_sales_min?: number;
  monthly_sales_max?: number;
  weight_max?: number;
  competitor_count_min?: number;
  competitor_count_max?: number;
  competitor_min_price_min?: number;
  competitor_min_price_max?: number;
  created_at_start?: string; // 上架时间开始
  created_at_end?: string; // 上架时间结束
  batch_id?: number; // 批次ID过滤
  is_read?: boolean; // 已读状态过滤
  sort_by?:
    | 'sales_desc'
    | 'sales_asc'
    | 'weight_asc'
    | 'price_asc'
    | 'price_desc'
    | 'created_desc'
    | 'created_asc';
  page?: number;
  page_size?: number;
}

export interface SearchResponse {
  success: boolean;
  data: {
    items: ProductSelectionItem[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
  };
}

export interface ImportResponse {
  success: boolean;
  import_id?: number;
  total_rows?: number;
  success_rows?: number;
  failed_rows?: number;
  updated_rows?: number;
  skipped_rows?: number;
  duration?: number;
  error?: string;
  errors?: Array<{ row: number; error: string }>;
  missing_columns?: string[];
}

export interface PreviewResponse {
  success: boolean;
  total_rows?: number;
  columns?: string[];
  preview?: unknown[];
  column_mapping?: Record<string, string>;
  error?: string;
  missing_columns?: string[];
}

export interface ImportHistory {
  id: number;
  file_name: string;
  file_type: string;
  file_size: number;
  imported_by: number;
  import_time: string;
  import_strategy: string;
  total_rows: number;
  success_rows: number;
  failed_rows: number;
  updated_rows: number;
  skipped_rows: number;
  process_duration: number;
  created_at: string;
}

// 导入商品数据文件
export const importProducts = async (
  file: File,
  strategy: 'skip' | 'update' | 'append' = 'update',
  shopId: number = 1 // 默认使用店铺ID 1
): Promise<ImportResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('strategy', strategy);
  formData.append('shop_id', shopId.toString());

  const response = await axios.post<ImportResponse>(
    '/api/ef/v1/ozon/product-selection/import',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );
  return response.data;
};

// 预览导入文件
export const previewImport = async (file: File): Promise<PreviewResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await axios.post<PreviewResponse>(
    '/api/ef/v1/ozon/product-selection/preview',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );
  return response.data;
};

// 搜索商品
export const searchProducts = async (params: ProductSearchParams): Promise<SearchResponse> => {
  const response = await axios.post<SearchResponse>(
    '/api/ef/v1/ozon/product-selection/products/search',
    params
  );
  return response.data;
};

// 获取商品列表（GET方法）
export const getProducts = async (params: ProductSearchParams): Promise<SearchResponse> => {
  const response = await axios.get<SearchResponse>('/api/ef/v1/ozon/product-selection/products', {
    params,
  });
  return response.data;
};

// 获取品牌列表
export const getBrands = async (): Promise<{
  success: boolean;
  data: string[];
}> => {
  const response = await axios.get<{ success: boolean; data: string[] }>(
    '/api/ef/v1/ozon/product-selection/brands'
  );
  return response.data;
};

// 获取导入历史
export const getImportHistory = async (
  page = 1,
  pageSize = 10
): Promise<{
  success: boolean;
  data: {
    items: ImportHistory[];
    total: number;
    page: number;
    page_size: number;
  };
}> => {
  const response = await axios.get('/api/ef/v1/ozon/product-selection/import-history', {
    params: { page, page_size: pageSize },
  });
  return response.data;
};

// 获取商品详细信息
export const getProductDetail = async (
  productId: string
): Promise<{
  success: boolean;
  data: {
    product_id: number;
    offer_id: string;
    name: string;
    description: string;
    images: Array<{
      url: string;
      file_name: string;
      default: boolean;
    }>;
    brand: string;
    category_id: number;
    barcode: string;
    price: string;
    old_price: string;
    status: string;
  };
}> => {
  const response = await axios.get(`/api/ef/v1/ozon/product-selection/product/${productId}/detail`);
  return response.data;
};

// 清空所有选品数据
export const clearAllData = async (): Promise<{
  success: boolean;
  message: string;
  data: {
    deleted_products: number;
    deleted_history: number;
  };
  error?: string;
}> => {
  const response = await axios.post('/api/ef/v1/ozon/product-selection/clear-all-data');
  return response.data;
};

// 批量标记商品为已读
export const markProductsAsRead = async (
  productIds: number[]
): Promise<{
  success: boolean;
  marked_count: number;
  message?: string;
}> => {
  const response = await axios.post('/api/ef/v1/ozon/product-selection/products/mark-as-read', {
    product_ids: productIds,
  });
  return response.data;
};

// 删除批次数据
export const deleteBatch = async (
  batchId: number
): Promise<{
  success: boolean;
  message: string;
  data: {
    batch_id: number;
    deleted_products: number;
  };
}> => {
  const response = await axios.delete(`/api/ef/v1/ozon/product-selection/batch/${batchId}`);
  return response.data;
};
