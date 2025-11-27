/**
 * OZON 商品上架类型定义
 */

/**
 * 商品上架状态
 */
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

/**
 * 媒体导入日志
 */
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

/**
 * 商品导入日志
 */
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

/**
 * 视频信息接口
 */
export interface VideoInfo {
  url: string;              // 视频URL（YouTube、OZON视频平台等）
  name?: string;            // 视频名称
  is_cover?: boolean;       // 是否为封面视频（每个商品只能有1个封面视频）
}

/**
 * 创建商品请求
 */
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
  // 采购信息（仅保存到本地，不提交OZON）
  purchase_url?: string;
  suggested_purchase_price?: number;
  purchase_note?: string;
}

/**
 * 商品导入状态响应
 */
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

/**
 * 上传媒体请求
 */
export interface UploadMediaRequest {
  shop_id: number;
  type: "base64" | "url";
  media_type?: "image" | "video";  // 媒体类型（默认为image）
  data?: string;      // For base64
  url?: string;       // For URL
  public_id?: string;
  folder?: string;
}

/**
 * 上传媒体文件响应
 */
export interface UploadMediaFileResponse {
  success: boolean;
  url?: string;
  public_id?: string;
  size_mb?: number;
  source?: string;
  error?: string;
}
