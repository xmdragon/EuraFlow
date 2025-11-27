"""
水印管理 DTO 模型
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class CloudinaryConfigDTO(BaseModel):
    """Cloudinary配置DTO"""
    cloud_name: str
    api_key: str
    api_secret: str
    product_images_folder: str = "products"
    watermark_images_folder: str = "watermarks"
    auto_cleanup_days: int = 30


class CloudinaryConfigResponse(BaseModel):
    """Cloudinary配置响应"""
    id: int
    shop_id: int
    cloud_name: str
    api_key: str
    product_images_folder: str
    watermark_images_folder: str
    auto_cleanup_days: int
    is_active: bool
    is_default: bool
    last_test_at: Optional[datetime]
    last_test_success: Optional[bool]
    storage_used_bytes: Optional[int]
    bandwidth_used_bytes: Optional[int]


class AliyunOssConfigDTO(BaseModel):
    """阿里云OSS配置DTO"""
    access_key_id: str
    access_key_secret: str
    bucket_name: str
    endpoint: str
    region_id: str = "cn-shanghai"
    product_images_folder: str = "products"
    watermark_images_folder: str = "watermarks"


class AliyunOssConfigResponse(BaseModel):
    """阿里云OSS配置响应"""
    id: int
    access_key_id: str
    bucket_name: str
    endpoint: str
    region_id: str
    product_images_folder: str
    watermark_images_folder: str
    is_default: bool
    enabled: bool
    last_test_at: Optional[datetime]
    last_test_success: Optional[bool]


class WatermarkConfigCreateDTO(BaseModel):
    """创建水印配置DTO"""
    name: str
    scale_ratio: float = Field(default=0.2, ge=0.01, le=1.0)
    opacity: float = Field(default=0.8, ge=0.1, le=1.0)
    margin_pixels: int = Field(default=10, ge=0)
    positions: List[str] = Field(default=["bottom_right"])


class WatermarkConfigResponse(BaseModel):
    """水印配置响应"""
    id: int
    name: str
    image_url: str
    cloudinary_public_id: str
    scale_ratio: float
    opacity: float
    margin_pixels: int
    positions: List[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime


class WatermarkPreviewRequest(BaseModel):
    """水印预览请求"""
    image_url: str
    watermark_config_id: int
    position: Optional[str] = None


class ApplyWatermarkToUrlRequest(BaseModel):
    """URL方式应用水印请求（使用transformation参数，不使用base64）"""
    image_url: str
    watermark_config_id: int
    position: str
    shop_id: int


class BatchWatermarkRequest(BaseModel):
    """批量水印请求"""
    shop_id: int
    product_ids: List[int]
    watermark_config_id: int
    position_overrides: Optional[Dict[str, Dict[str, Any]]] = Field(
        default=None,
        description="手动选择的位置和水印 {product_id: {image_index: {position, watermark_config_id}}}"
    )


class BatchPreviewRequest(BaseModel):
    """批量预览水印请求"""
    shop_id: int
    product_ids: List[int]  # 限制最多10个商品
    watermark_config_id: int
    analyze_each: bool = Field(default=True, description="是否为每张图片单独分析位置")


class BatchRestoreRequest(BaseModel):
    """批量还原请求"""
    shop_id: int
    product_ids: List[int]


class WatermarkTaskResponse(BaseModel):
    """水印任务响应"""
    id: str
    shop_id: int
    product_id: int
    task_type: str
    status: str
    watermark_config_id: Optional[int]
    error_message: Optional[str]
    retry_count: int
    batch_id: Optional[str]
    batch_total: Optional[int]
    batch_position: Optional[int]
    created_at: datetime
    processing_started_at: Optional[datetime]
    completed_at: Optional[datetime]
