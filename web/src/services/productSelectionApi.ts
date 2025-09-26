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
  fbp_commission_low: number;
  fbp_commission_mid: number;
  monthly_sales_volume: number;
  package_weight: number;
  rating: number;
  review_count: number;
  seller_type: string;
  // 竞争对手数据
  competitor_count?: number;
  competitor_min_price?: number;
  market_min_price?: number;
  price_index?: number;
  competitor_data?: any;
  competitor_updated_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ProductSearchParams {
  brand?: string;
  rfbs_low_max?: number;
  rfbs_mid_max?: number;
  fbp_low_max?: number;
  fbp_mid_max?: number;
  monthly_sales_min?: number;
  monthly_sales_max?: number;
  weight_max?: number;
  sort_by?: 'sales_desc' | 'sales_asc' | 'weight_asc' | 'price_asc' | 'price_desc';
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
}

export interface PreviewResponse {
  success: boolean;
  total_rows?: number;
  columns?: string[];
  preview?: any[];
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
  strategy: 'skip' | 'update' | 'append' = 'update'
): Promise<ImportResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('strategy', strategy);

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
  const response = await axios.get<SearchResponse>(
    '/api/ef/v1/ozon/product-selection/products',
    { params }
  );
  return response.data;
};

// 获取品牌列表
export const getBrands = async (): Promise<{ success: boolean; data: string[] }> => {
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
  const response = await axios.get(
    '/api/ef/v1/ozon/product-selection/import-history',
    {
      params: { page, page_size: pageSize },
    }
  );
  return response.data;
};

// 更新竞争对手数据
export const updateCompetitorData = async (params: {
  shop_id: number;
  product_ids?: string[];
  force?: boolean;
}): Promise<{
  success: boolean;
  message: string;
  task: {
    shop_id: number;
    product_count: number | string;
    force: boolean;
    started_at: string;
  };
}> => {
  const response = await axios.post('/api/ef/v1/ozon/product-selection/competitor-update', null, {
    params
  });
  return response.data;
};

// 获取竞争对手数据更新状态
export const getCompetitorStatus = async (): Promise<{
  success: boolean;
  data: {
    total_products: number;
    updated_products: number;
    outdated_products: number;
    oldest_update: string | null;
    latest_update: string | null;
    update_threshold_hours: number;
  };
}> => {
  const response = await axios.get('/api/ef/v1/ozon/product-selection/competitor-status');
  return response.data;
};