/**
 * 水印管理API服务
 */
import axios from './axios';

// ============ 类型定义 ============

export interface CloudinaryConfig {
  cloud_name: string;
  api_key: string;
  api_secret?: string;
  product_images_folder?: string;
  product_videos_folder?: string;
  watermark_images_folder?: string;
  auto_cleanup_days?: number;
}

export interface CloudinaryConfigResponse {
  id: number;
  shop_id: number;
  cloud_name: string;
  api_key: string;
  product_images_folder: string;
  product_videos_folder: string;
  watermark_images_folder: string;
  auto_cleanup_days: number;
  is_active: boolean;
  is_default: boolean;
  last_test_at?: string;
  last_test_success?: boolean;
  storage_used_bytes?: number;
  bandwidth_used_bytes?: number;
}

export interface AliyunOssConfig {
  access_key_id: string;
  access_key_secret: string;
  bucket_name: string;
  endpoint: string;
  region_id?: string;
  product_images_folder?: string;
  product_videos_folder?: string;
  watermark_images_folder?: string;
}

export interface AliyunOssConfigResponse {
  id: number;
  access_key_id: string;
  bucket_name: string;
  endpoint: string;
  region_id: string;
  product_images_folder: string;
  product_videos_folder: string;
  watermark_images_folder: string;
  is_default: boolean;
  enabled: boolean;
  last_test_at?: string;
  last_test_success?: boolean;
}

export interface WatermarkConfig {
  id: number;
  name: string;
  image_url: string;
  cloudinary_public_id: string;
  scale_ratio: number;
  opacity: number;
  margin_pixels: number;
  positions: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WatermarkTask {
  id: string;
  shop_id: number;
  product_id: number;
  task_type: string;
  status: string;
  watermark_config_id?: number;
  error_message?: string;
  retry_count: number;
  batch_id?: string;
  batch_total?: number;
  batch_position?: number;
  created_at: string;
  processing_started_at?: string;
  completed_at?: string;
}

export interface CloudinaryResource {
  public_id: string;
  url: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  created_at: string;
  folder?: string; // Cloudinary API 返回的文件夹字段
  asset_folder?: string; // 新版 API 字段
}

export interface CloudinaryFolder {
  folder: string;
  folder_path: string;
  resource_count: number;
  resources: CloudinaryResource[];
}

export interface CloudinaryResourcesResponse {
  success: boolean;
  resources?: CloudinaryResource[];
  folders?: CloudinaryFolder[];
  total: number;
  next_cursor?: string;
}

// ============ Cloudinary配置管理 ============

/**
 * 创建或更新Cloudinary配置（全局配置）
 */
export async function createCloudinaryConfig(config: CloudinaryConfig) {
  const formData = new FormData();
  formData.append('cloud_name', config.cloud_name);
  formData.append('api_key', config.api_key);
  formData.append('api_secret', config.api_secret || '');
  formData.append('product_images_folder', config.product_images_folder || 'products');
  formData.append('watermark_images_folder', config.watermark_images_folder || 'watermarks');
  formData.append('auto_cleanup_days', (config.auto_cleanup_days || 30).toString());

  const response = await axios.post<CloudinaryConfigResponse>(
    '/api/ef/v1/ozon/watermark/cloudinary/config',
    formData
  );
  return response.data;
}

/**
 * 获取Cloudinary配置（全局配置）
 */
export async function getCloudinaryConfig() {
  const response = await axios.get<CloudinaryConfigResponse>(
    `/api/ef/v1/ozon/watermark/cloudinary/config`
  );
  return response.data;
}

/**
 * 测试Cloudinary连接（全局配置）
 */
export async function testCloudinaryConnection() {
  const response = await axios.post<{
    success: boolean;
    cloud_name?: string;
    usage?: {
      storage_used_bytes?: number;
      object_count?: number;
      bandwidth_used_bytes?: number | null;
      transformations_used?: number | null;
      storage_limit_bytes?: number | null;
      bandwidth_limit_bytes?: number | null;
      transformations_limit?: number | null;
    };
    limits?: unknown;
    quota_usage_percent?: number;
    error?: string;
    tested_at: string;
  }>(`/api/ef/v1/ozon/watermark/cloudinary/test`);
  return response.data;
}

/**
 * 设置 Cloudinary 为默认图床
 */
export async function setCloudinaryDefault() {
  const response = await axios.put<{ success: boolean; message: string }>(
    '/api/ef/v1/ozon/watermark/cloudinary/set-default'
  );
  return response.data;
}

// ============ 阿里云 OSS 配置管理 ============

/**
 * 创建或更新阿里云 OSS 配置
 */
export async function createAliyunOssConfig(config: AliyunOssConfig) {
  const formData = new FormData();
  formData.append('access_key_id', config.access_key_id);
  formData.append('access_key_secret', config.access_key_secret);
  formData.append('bucket_name', config.bucket_name);
  formData.append('endpoint', config.endpoint);
  formData.append('region_id', config.region_id || 'cn-shanghai');
  formData.append('product_images_folder', config.product_images_folder || 'products');
  formData.append('watermark_images_folder', config.watermark_images_folder || 'watermarks');

  const response = await axios.post<AliyunOssConfigResponse>(
    '/api/ef/v1/ozon/watermark/aliyun-oss/config',
    formData
  );
  return response.data;
}

/**
 * 获取阿里云 OSS 配置
 */
export async function getAliyunOssConfig() {
  const response = await axios.get<AliyunOssConfigResponse>(
    '/api/ef/v1/ozon/watermark/aliyun-oss/config'
  );
  return response.data;
}

/**
 * 测试阿里云 OSS 连接
 */
export async function testAliyunOssConnection() {
  const response = await axios.post<{
    success: boolean;
    bucket?: string;
    region?: string;
    storage_used_bytes?: number;
    object_count?: number;
    usage?: {
      storage_used_bytes?: number;
      object_count?: number;
      bandwidth_used_bytes?: number | null;
      transformations_used?: number | null;
      storage_limit_bytes?: number | null;
      bandwidth_limit_bytes?: number | null;
      transformations_limit?: number | null;
    };
    error?: string;
    tested_at: string;
  }>('/api/ef/v1/ozon/watermark/aliyun-oss/test');
  return response.data;
}

/**
 * 设置阿里云 OSS 为默认图床
 */
export async function setAliyunOssDefault(enabled = true) {
  const formData = new FormData();
  formData.append('enabled', String(enabled));

  const response = await axios.put<{ success: boolean; message: string }>(
    '/api/ef/v1/ozon/watermark/aliyun-oss/set-default',
    formData
  );
  return response.data;
}

// ============ 水印配置管理 ============

/**
 * 创建水印配置
 */
export async function createWatermarkConfig(
  name: string,
  watermarkFile: File,
  options?: {
    scale_ratio?: number;
    opacity?: number;
    margin_pixels?: number;
    positions?: string[];
  }
) {
  const DEFAULT_POSITIONS = [
    'top_left',
    'top_center',
    'top_right',
    'center_left',
    'center_right',
    'bottom_left',
    'bottom_center',
    'bottom_right',
  ];
  const formData = new FormData();
  formData.append('name', name);
  formData.append('watermark_file', watermarkFile);
  formData.append('scale_ratio', (options?.scale_ratio || 0.1).toString());
  formData.append('opacity', (options?.opacity || 0.8).toString());
  formData.append('margin_pixels', (options?.margin_pixels || 20).toString());
  formData.append('positions', JSON.stringify(options?.positions || DEFAULT_POSITIONS));

  const response = await axios.post<WatermarkConfig>('/api/ef/v1/ozon/watermark/configs', formData);
  return response.data;
}

/**
 * 获取水印配置列表
 */
export async function getWatermarkConfigs() {
  const response = await axios.get<WatermarkConfig[]>('/api/ef/v1/ozon/watermark/configs');
  return response.data;
}

/**
 * 更新水印配置
 */
export async function updateWatermarkConfig(
  configId: number,
  options: {
    scale_ratio?: number;
    opacity?: number;
    margin_pixels?: number;
    positions?: string[];
    is_active?: boolean;
  }
) {
  const formData = new FormData();
  formData.append('scale_ratio', (options.scale_ratio || 0.1).toString());
  formData.append('opacity', (options.opacity || 0.8).toString());
  formData.append('margin_pixels', (options.margin_pixels || 20).toString());
  formData.append('positions', JSON.stringify(options.positions || ['bottom_right']));
  formData.append('is_active', (options.is_active ?? true).toString());

  const response = await axios.put<WatermarkConfig>(
    `/api/ef/v1/ozon/watermark/configs/${configId}`,
    formData
  );
  return response.data;
}

/**
 * 删除水印配置
 */
export async function deleteWatermarkConfig(configId: number) {
  const response = await axios.delete(`/api/ef/v1/ozon/watermark/configs/${configId}`);
  return response.data;
}

// ============ 水印预览 ============

/**
 * 预览水印效果
 */
export async function previewWatermark(
  imageUrl: string,
  watermarkConfigId: number,
  position?: string
) {
  const response = await axios.post<{
    success: boolean;
    preview_image: string;
    metadata: unknown;
  }>('/api/ef/v1/ozon/watermark/preview', {
    image_url: imageUrl,
    watermark_config_id: watermarkConfigId,
    position,
  });
  return response.data;
}

/**
 * URL方式应用水印（使用transformation参数，不使用base64）
 */
export async function applyWatermarkToUrl(
  imageUrl: string,
  watermarkConfigId: number,
  position: string,
  shopId: number
) {
  const response = await axios.post<{
    success: boolean;
    url: string;
    public_id: string;
  }>('/api/ef/v1/ozon/watermark/apply', {
    image_url: imageUrl,
    watermark_config_id: watermarkConfigId,
    position,
    shop_id: shopId,
  });
  return response.data;
}

/**
 * 批量预览水印效果
 */
export async function previewWatermarkBatch(
  shopId: number,
  productIds: number[],
  watermarkConfigId: number,
  analyzeEach: boolean = true
) {
  const response = await axios.post<{
    success: boolean;
    total_products: number;
    previews: Array<{
      product_id: number;
      sku: string;
      title: string;
      original_image?: string;
      preview_image?: string;
      suggested_position?: string;
      metadata?: unknown;
      error?: string;
    }>;
    watermark_config: {
      id: number;
      name: string;
      image_url: string;
    };
  }>('/api/ef/v1/ozon/watermark/batch/preview', {
    shop_id: shopId,
    product_ids: productIds,
    watermark_config_id: watermarkConfigId,
    analyze_each: analyzeEach,
  });
  return response.data;
}

// ============ 批量水印操作 ============

/**
 * 批量应用水印
 */
export async function applyWatermarkBatch(
  shopId: number,
  productIds: number[],
  watermarkConfigId: number,
  syncMode: boolean = true, // 默认使用同步模式
  analyzeMode: 'individual' | 'fast' = 'individual', // 默认使用精准模式
  positionOverrides?: Record<string, Record<string, string>> // 手动选择的位置 {productId: {imageIndex: position}}
) {
  const response = await axios.post<{
    success: boolean;
    batch_id: string;
    task_count: number;
    sync_mode: boolean;
    success_count?: number;
    failed_count?: number;
    message: string;
  }>(`/api/ef/v1/ozon/watermark/batch/apply?sync_mode=${syncMode}&analyze_mode=${analyzeMode}`, {
    shop_id: shopId,
    product_ids: productIds,
    watermark_config_id: watermarkConfigId,
    position_overrides: positionOverrides,
  });
  return response.data;
}

/**
 * 批量还原原图
 */
export async function restoreOriginalBatch(shopId: number, productIds: number[]) {
  const response = await axios.post<{
    success: boolean;
    batch_id: string;
    task_count: number;
    message: string;
  }>('/api/ef/v1/ozon/watermark/batch/restore', {
    shop_id: shopId,
    product_ids: productIds,
  });
  return response.data;
}

// ============ 任务管理 ============

/**
 * 获取任务状态
 */
export async function getTaskStatus(taskId: string) {
  const response = await axios.get<WatermarkTask>(`/api/ef/v1/ozon/watermark/tasks/${taskId}`);
  return response.data;
}

/**
 * 获取任务列表
 */
export async function getTasks(options?: {
  shop_id?: number;
  batch_id?: string;
  status?: string;
  limit?: number;
}) {
  const response = await axios.get<WatermarkTask[]>('/api/ef/v1/ozon/watermark/tasks', {
    params: {
      ...options,
    },
  });
  return response.data;
}

// ============ 资源清理 ============

/**
 * 清理过期资源
 */
export async function cleanupOldResources(days: number = 30, dryRun: boolean = false) {
  const response = await axios.delete<{
    success: boolean;
    deleted?: string[];
    would_delete?: string[];
    count: number;
    cutoff_date?: string;
    error?: string;
  }>('/api/ef/v1/ozon/watermark/cleanup', {
    params: {
      days,
      dry_run: dryRun,
    },
  });
  return response.data;
}

// ============ 资源管理 ============

/**
 * 列出Cloudinary资源
 */
export async function listCloudinaryResources(options?: {
  folder?: string;
  max_results?: number;
  next_cursor?: string;
  group_by_folder?: boolean;
}) {
  const response = await axios.get<CloudinaryResourcesResponse>(
    '/api/ef/v1/ozon/watermark/resources',
    {
      params: {
        folder: options?.folder,
        max_results: options?.max_results || 500,
        next_cursor: options?.next_cursor,
        group_by_folder: options?.group_by_folder ?? true,
      },
    }
  );
  return response.data;
}

/**
 * 批量删除Cloudinary资源
 */
export async function deleteCloudinaryResources(publicIds: string[]) {
  const response = await axios.delete<{
    success: boolean;
    deleted: string[];
    not_found: string[];
    deleted_count: number;
    total_requested: number;
  }>('/api/ef/v1/ozon/watermark/resources', {
    data: {
      public_ids: publicIds,
    },
  });
  return response.data;
}

// ============ 图片精修后上传 ============

export interface RefinedImageUploadRequest {
  xiangji_url: string;
  request_id: string;
}

export interface RefinedImageUploadResult {
  request_id: string;
  xiangji_url: string;
  storage_url: string | null;
  success: boolean;
  error?: string;
}

export interface RefinedImageUploadResponse {
  success: boolean;
  total: number;
  success_count: number;
  fail_count: number;
  results: RefinedImageUploadResult[];
}

/**
 * 上传精修后的图片到当前激活的图床
 * 从象寄精修工具返回的URL异步上传到OSS/Cloudinary
 */
export async function uploadRefinedImages(
  shopId: number,
  images: RefinedImageUploadRequest[]
): Promise<RefinedImageUploadResponse> {
  const response = await axios.post<RefinedImageUploadResponse>(
    '/api/ef/v1/ozon/watermark/upload-refined-images',
    {
      shop_id: shopId,
      images,
    }
  );
  return response.data;
}

/**
 * 上传Base64编码的图片到图床
 */
export async function uploadBase64Image(
  shopId: number,
  imageBase64: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  // 添加最外层的异常捕获，确保永远返回有效对象
  try {
    // 验证输入参数
    if (!shopId || !imageBase64) {
      return {
        success: false,
        error: '参数错误：shopId 或 imageBase64 为空',
      };
    }

    try {
      const response = await axios.post<{ success: boolean; url: string; error?: string }>(
        '/api/ef/v1/ozon/watermark/upload-base64-image',
        {
          shop_id: shopId,
          image_base64: imageBase64,
        }
      );

      // 确保返回值存在且格式正确
      if (!response || !response.data) {
        return {
          success: false,
          error: '服务器响应异常',
        };
      }

      // 确保返回的data包含必要字段
      const data = response.data;
      if (typeof data.success === 'undefined') {
        return {
          success: false,
          error: '服务器返回格式异常',
        };
      }

      return data;
    } catch (axiosError: unknown) {
      // 捕获axios异常
      const err = axiosError as { response?: { data?: { detail?: string } }; message?: string };
      const errorMessage = err?.response?.data?.detail || err?.message || '网络错误';
      return {
        success: false,
        error: errorMessage,
      };
    }
  } catch (outerError: unknown) {
    // 最外层异常捕获 - 确保永远返回有效对象
    const err = outerError as { message?: string };
    return {
      success: false,
      error: err?.message || '未知错误',
    };
  }
}
