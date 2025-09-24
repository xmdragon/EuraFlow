/**
 * 水印管理API服务
 */
import axios from './axios';

// ============ 类型定义 ============

export interface CloudinaryConfig {
  cloud_name: string;
  api_key: string;
  api_secret?: string;
  folder_prefix?: string;
  auto_cleanup_days?: number;
}

export interface CloudinaryConfigResponse {
  id: number;
  shop_id: number;
  cloud_name: string;
  api_key: string;
  folder_prefix: string;
  auto_cleanup_days: number;
  is_active: boolean;
  last_test_at?: string;
  last_test_success?: boolean;
  storage_used_bytes?: number;
  bandwidth_used_bytes?: number;
}

export interface WatermarkConfig {
  id: number;
  name: string;
  image_url: string;
  cloudinary_public_id: string;
  color_type: string;
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

// ============ Cloudinary配置管理 ============

/**
 * 创建或更新Cloudinary配置（全局配置）
 */
export async function createCloudinaryConfig(config: CloudinaryConfig) {
  const formData = new FormData();
  formData.append('cloud_name', config.cloud_name);
  formData.append('api_key', config.api_key);
  formData.append('api_secret', config.api_secret || '');
  formData.append('folder_prefix', config.folder_prefix || 'euraflow');
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
    usage?: any;
    limits?: any;
    quota_usage_percent?: number;
    error?: string;
    tested_at: string;
  }>(`/api/ef/v1/ozon/watermark/cloudinary/test`);
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
    color_type?: string;
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
  formData.append('color_type', options?.color_type || 'white');
  formData.append('scale_ratio', (options?.scale_ratio || 0.1).toString());
  formData.append('opacity', (options?.opacity || 0.8).toString());
  formData.append('margin_pixels', (options?.margin_pixels || 20).toString());
  formData.append('positions', JSON.stringify(options?.positions || DEFAULT_POSITIONS));

  const response = await axios.post<WatermarkConfig>(
    '/api/ef/v1/ozon/watermark/configs',
    formData
  );
  return response.data;
}

/**
 * 获取水印配置列表
 */
export async function getWatermarkConfigs() {
  const response = await axios.get<WatermarkConfig[]>(
    '/api/ef/v1/ozon/watermark/configs'
  );
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
    color_type?: string;
    is_active?: boolean;
  }
) {
  const formData = new FormData();
  formData.append('scale_ratio', (options.scale_ratio || 0.1).toString());
  formData.append('opacity', (options.opacity || 0.8).toString());
  formData.append('margin_pixels', (options.margin_pixels || 20).toString());
  formData.append('positions', JSON.stringify(options.positions || ['bottom_right']));
  formData.append('color_type', options.color_type || 'white');
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
  const response = await axios.delete(
    `/api/ef/v1/ozon/watermark/configs/${configId}`
  );
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
    metadata: any;
  }>('/api/ef/v1/ozon/watermark/preview', {
    image_url: imageUrl,
    watermark_config_id: watermarkConfigId,
    position
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
  syncMode: boolean = true  // 默认使用同步模式
) {
  const response = await axios.post<{
    success: boolean;
    batch_id: string;
    task_count: number;
    sync_mode: boolean;
    success_count?: number;
    failed_count?: number;
    message: string;
  }>(`/api/ef/v1/ozon/watermark/batch/apply?sync_mode=${syncMode}`, {
    shop_id: shopId,
    product_ids: productIds,
    watermark_config_id: watermarkConfigId
  });
  return response.data;
}

/**
 * 批量还原原图
 */
export async function restoreOriginalBatch(
  shopId: number,
  productIds: number[]
) {
  const response = await axios.post<{
    success: boolean;
    batch_id: string;
    task_count: number;
    message: string;
  }>('/api/ef/v1/ozon/watermark/batch/restore', {
    shop_id: shopId,
    product_ids: productIds
  });
  return response.data;
}

// ============ 任务管理 ============

/**
 * 获取任务状态
 */
export async function getTaskStatus(taskId: string) {
  const response = await axios.get<WatermarkTask>(
    `/api/ef/v1/ozon/watermark/tasks/${taskId}`
  );
  return response.data;
}

/**
 * 获取任务列表
 */
export async function getTasks(
  options?: {
    shop_id?: number;
    batch_id?: string;
    status?: string;
    limit?: number;
  }
) {
  const response = await axios.get<WatermarkTask[]>(
    '/api/ef/v1/ozon/watermark/tasks',
    {
      params: {
        ...options,
      },
    }
  );
  return response.data;
}

// ============ 资源清理 ============

/**
 * 清理过期资源
 */
export async function cleanupOldResources(
  days: number = 30,
  dryRun: boolean = false
) {
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
    }
  });
  return response.data;
}
