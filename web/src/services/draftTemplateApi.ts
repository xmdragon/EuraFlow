/**
 * 草稿与模板 API 服务
 * 处理商品创建页面的草稿保存和模板管理功能
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

      try {
        await authService.refresh();
        const authHeaders = authService.getAuthHeader();
        originalRequest.headers.Authorization = authHeaders.Authorization;
        return apiClient(originalRequest);
      } catch {
        authService.logout();
      }
    }
    return Promise.reject(error);
  },
);

// ==================== 类型定义 ====================

export interface FormData {
  shop_id?: number;
  category_id?: number;
  title?: string;
  description?: string;
  offer_id?: string;
  price?: number;
  old_price?: number;
  premium_price?: number;
  width?: number;
  height?: number;
  depth?: number;
  weight?: number;
  dimension_unit?: string;
  weight_unit?: string;
  barcode?: string;
  vat?: string;
  attributes?: Record<string, any>;
  images?: string[];
  videos?: any[];
  images360?: string;
  color_image?: string;
  pdf_list?: string;
  promotions?: number[];
  variantDimensions?: any[];
  variants?: any[];
  hiddenFields?: string[];
  variantSectionExpanded?: boolean;
  variantTableCollapsed?: boolean;
  optionalFieldsExpanded?: boolean;
  autoColorSample?: boolean;
}

export interface DraftDetail {
  id: number;
  shop_id?: number;
  category_id?: number;
  form_data: FormData;
  updated_at: string;
}

export interface TemplateListItem {
  id: number;
  template_name: string;
  shop_id?: number;
  category_id?: number;
  tags?: string[];
  used_count: number;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateDetail extends TemplateListItem {
  form_data: FormData;
}

// ==================== 草稿相关 API ====================

/**
 * 保存或更新草稿（幂等）
 */
export const saveDraft = async (data: {
  shop_id?: number;
  category_id?: number;
  form_data: FormData;
}): Promise<{ id: number; updated_at: string }> => {
  const response = await apiClient.post("/ozon/listings/drafts", data);
  return response.data.data;
};

/**
 * 获取最新草稿
 */
export const getLatestDraft = async (): Promise<DraftDetail | null> => {
  const response = await apiClient.get("/ozon/listings/drafts/latest");
  return response.data.data;
};

/**
 * 删除草稿
 */
export const deleteDraft = async (draftId: number): Promise<void> => {
  await apiClient.delete(`/ozon/listings/drafts/${draftId}`);
};

// ==================== 模板相关 API ====================

/**
 * 创建模板
 */
export const createTemplate = async (data: {
  template_name: string;
  shop_id?: number;
  category_id?: number;
  form_data: FormData;
  tags?: string[];
}): Promise<{ id: number; created_at: string }> => {
  const response = await apiClient.post("/ozon/listings/templates", data);
  return response.data.data;
};

/**
 * 获取模板列表
 */
export const getTemplates = async (params?: {
  shop_id?: number;
  category_id?: number;
  tag?: string;
}): Promise<TemplateListItem[]> => {
  const response = await apiClient.get("/ozon/listings/templates", { params });
  return response.data.data;
};

/**
 * 获取模板详情
 */
export const getTemplate = async (
  templateId: number,
): Promise<TemplateDetail> => {
  const response = await apiClient.get(
    `/ozon/listings/templates/${templateId}`,
  );
  return response.data.data;
};

/**
 * 更新模板（重命名/编辑）
 */
export const updateTemplate = async (
  templateId: number,
  data: {
    template_name?: string;
    form_data?: FormData;
    tags?: string[];
  },
): Promise<{ updated_at: string }> => {
  const response = await apiClient.put(
    `/ozon/listings/templates/${templateId}`,
    data,
  );
  return response.data.data;
};

/**
 * 删除模板
 */
export const deleteTemplate = async (templateId: number): Promise<void> => {
  await apiClient.delete(`/ozon/listings/templates/${templateId}`);
};
