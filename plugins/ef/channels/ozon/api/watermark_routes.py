"""
水印管理API路由
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, Body, Request
from typing import Optional, Dict, Any, List
from datetime import datetime
from uuid import uuid4
from pydantic import BaseModel, Field
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, update
import logging

from ef_core.database import get_async_session
from ef_core.middleware.auth import require_role
from ef_core.models.users import User
from ef_core.services.audit_service import AuditService
from ..models.watermark import WatermarkConfig, CloudinaryConfig, AliyunOssConfig, WatermarkTask
from ..models import OzonProduct, OzonShop
from ..services.cloudinary_service import CloudinaryService, CloudinaryConfigManager
from ..services.aliyun_oss_service import AliyunOssService, AliyunOssConfigManager
from ..services.image_storage_factory import ImageStorageFactory
from ..services.image_processing_service import ImageProcessingService, WatermarkPosition
from ..utils.datetime_utils import utcnow

router = APIRouter(prefix="/watermark", tags=["Watermark"])
logger = logging.getLogger(__name__)


# DTO 模型
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


# Cloudinary配置管理（全局配置）
@router.post("/cloudinary/config")
async def create_cloudinary_config(
    cloud_name: str = Form(...),
    api_key: str = Form(...),
    api_secret: str = Form(...),
    product_images_folder: str = Form("products"),
    watermark_images_folder: str = Form("watermarks"),
    auto_cleanup_days: int = Form(30),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """创建或更新Cloudinary配置（全局唯一）"""
    try:
        # 检查是否已存在全局配置
        existing = await db.execute(
            select(CloudinaryConfig).limit(1)
        )
        existing_config = existing.scalar_one_or_none()

        if existing_config:
            # 更新现有配置
            existing_config.cloud_name = cloud_name
            existing_config.api_key = api_key
            existing_config.api_secret_encrypted = api_secret  # TODO: 加密
            existing_config.product_images_folder = product_images_folder
            existing_config.watermark_images_folder = watermark_images_folder
            existing_config.auto_cleanup_days = auto_cleanup_days
            existing_config.updated_at = utcnow()
        else:
            # 创建新配置
            existing_config = CloudinaryConfig(
                cloud_name=cloud_name,
                api_key=api_key,
                api_secret_encrypted=api_secret,  # TODO: 加密
                product_images_folder=product_images_folder,
                watermark_images_folder=watermark_images_folder,
                auto_cleanup_days=auto_cleanup_days
            )
            db.add(existing_config)

        await db.commit()
        await db.refresh(existing_config)

        return CloudinaryConfigResponse(
            id=existing_config.id,
            shop_id=0,  # 全局配置，返回0作为标识
            cloud_name=existing_config.cloud_name,
            api_key=existing_config.api_key,
            product_images_folder=existing_config.product_images_folder,
            watermark_images_folder=existing_config.watermark_images_folder,
            auto_cleanup_days=existing_config.auto_cleanup_days,
            is_active=existing_config.is_active,
            is_default=existing_config.is_default,
            last_test_at=existing_config.last_test_at,
            last_test_success=existing_config.last_test_success,
            storage_used_bytes=existing_config.storage_used_bytes,
            bandwidth_used_bytes=existing_config.bandwidth_used_bytes
        )

    except Exception as e:
        logger.error(f"Failed to create/update Cloudinary config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cloudinary/config")
async def get_cloudinary_config(
    db: AsyncSession = Depends(get_async_session)
):
    """获取Cloudinary全局配置"""
    # 获取全局配置（包括未激活的，用于显示配置表单）
    result = await db.execute(
        select(CloudinaryConfig).limit(1)
    )
    config = result.scalar_one_or_none()

    if not config:
        # 返回 null，前端显示空表单
        return None

    return CloudinaryConfigResponse(
        id=config.id,
        shop_id=0,  # 全局配置，返回0
        cloud_name=config.cloud_name,
        api_key=config.api_key,
        product_images_folder=config.product_images_folder,
        watermark_images_folder=config.watermark_images_folder,
        auto_cleanup_days=config.auto_cleanup_days,
        is_active=config.is_active,
        is_default=config.is_default,
        last_test_at=config.last_test_at,
        last_test_success=config.last_test_success,
        storage_used_bytes=config.storage_used_bytes,
        bandwidth_used_bytes=config.bandwidth_used_bytes
    )


@router.post("/cloudinary/test")
async def test_cloudinary_connection(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """测试Cloudinary连接"""
    # 获取全局配置
    result = await db.execute(
        select(CloudinaryConfig).where(CloudinaryConfig.is_active == True).limit(1)
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(status_code=404, detail="Cloudinary configuration not found")

    service = await CloudinaryConfigManager.create_service_from_config(config)

    if not service:
        raise HTTPException(status_code=500, detail="Failed to create Cloudinary service")

    result = await service.test_connection()

    # 更新测试结果
    config.last_test_at = utcnow()
    config.last_test_success = result["success"]

    if result["success"]:
        config.storage_used_bytes = result["usage"]["storage_used_bytes"]
        config.bandwidth_used_bytes = result["usage"]["bandwidth_used_bytes"]
        config.last_quota_check = utcnow()

    await db.commit()

    return result


# 阿里云 OSS 配置管理
@router.post("/aliyun-oss/config")
async def create_aliyun_oss_config(
    access_key_id: str = Form(...),
    access_key_secret: str = Form(...),
    bucket_name: str = Form(...),
    endpoint: str = Form(...),
    region_id: str = Form("cn-shanghai"),
    product_images_folder: str = Form("products"),
    watermark_images_folder: str = Form("watermarks"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """创建或更新阿里云 OSS 配置（单例模式，ID 固定为 1）"""
    try:
        # 检查是否已存在配置（ID固定为1）
        existing = await db.get(AliyunOssConfig, 1)

        if existing:
            # 更新现有配置
            existing.access_key_id = access_key_id
            existing.access_key_secret_encrypted = access_key_secret  # TODO: 加密
            existing.bucket_name = bucket_name
            existing.endpoint = endpoint
            existing.region_id = region_id
            existing.product_images_folder = product_images_folder
            existing.watermark_images_folder = watermark_images_folder
            existing.updated_at = utcnow()
        else:
            # 创建新配置
            existing = AliyunOssConfig(
                id=1,  # 单例模式，ID 固定为 1
                access_key_id=access_key_id,
                access_key_secret_encrypted=access_key_secret,  # TODO: 加密
                bucket_name=bucket_name,
                endpoint=endpoint,
                region_id=region_id,
                product_images_folder=product_images_folder,
                watermark_images_folder=watermark_images_folder
            )
            db.add(existing)

        await db.commit()
        await db.refresh(existing)

        return AliyunOssConfigResponse(
            id=existing.id,
            access_key_id=existing.access_key_id,
            bucket_name=existing.bucket_name,
            endpoint=existing.endpoint,
            region_id=existing.region_id,
            product_images_folder=existing.product_images_folder,
            watermark_images_folder=existing.watermark_images_folder,
            is_default=existing.is_default,
            enabled=existing.enabled,
            last_test_at=existing.last_test_at,
            last_test_success=existing.last_test_success
        )

    except Exception as e:
        logger.error(f"Failed to create/update Aliyun OSS config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/aliyun-oss/config")
async def get_aliyun_oss_config(
    db: AsyncSession = Depends(get_async_session)
):
    """获取阿里云 OSS 配置"""
    config = await db.get(AliyunOssConfig, 1)

    if not config:
        # 返回 null，前端显示空表单
        return None

    return AliyunOssConfigResponse(
        id=config.id,
        access_key_id=config.access_key_id,
        bucket_name=config.bucket_name,
        endpoint=config.endpoint,
        region_id=config.region_id,
        product_images_folder=config.product_images_folder,
        watermark_images_folder=config.watermark_images_folder,
        is_default=config.is_default,
        enabled=config.enabled,
        last_test_at=config.last_test_at,
        last_test_success=config.last_test_success
    )


@router.post("/aliyun-oss/test")
async def test_aliyun_oss_connection(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """测试阿里云 OSS 连接"""
    config = await db.get(AliyunOssConfig, 1)

    if not config:
        raise HTTPException(status_code=404, detail="Aliyun OSS configuration not found")

    service = await AliyunOssConfigManager.create_service_from_config(config)

    result = await service.test_connection()

    # 更新测试结果
    config.last_test_at = utcnow()
    config.last_test_success = result["success"]

    await db.commit()

    return result


@router.put("/aliyun-oss/set-default")
async def set_aliyun_oss_default(
    enabled: bool = Form(True, description="是否启用阿里云 OSS"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """设置阿里云 OSS 为默认图床"""
    try:
        config = await db.get(AliyunOssConfig, 1)

        if not config:
            raise HTTPException(status_code=404, detail="Aliyun OSS configuration not found")

        # 取消 Cloudinary 的默认状态
        cloudinary_result = await db.execute(
            select(CloudinaryConfig).where(CloudinaryConfig.is_default == True)
        )
        cloudinary_config = cloudinary_result.scalar_one_or_none()
        if cloudinary_config:
            cloudinary_config.is_default = False

        # 设置阿里云 OSS 为默认并启用
        config.is_default = True
        config.enabled = enabled

        await db.commit()

        return {
            "success": True,
            "message": "Aliyun OSS set as default storage provider"
        }

    except Exception as e:
        logger.error(f"Failed to set Aliyun OSS as default: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/cloudinary/set-default")
async def set_cloudinary_default(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """设置 Cloudinary 为默认图床"""
    try:
        cloudinary_result = await db.execute(
            select(CloudinaryConfig).where(CloudinaryConfig.is_active == True).limit(1)
        )
        cloudinary_config = cloudinary_result.scalar_one_or_none()

        if not cloudinary_config:
            raise HTTPException(status_code=404, detail="Cloudinary configuration not found")

        # 取消阿里云 OSS 的默认状态
        oss_config = await db.get(AliyunOssConfig, 1)
        if oss_config:
            oss_config.is_default = False
            oss_config.enabled = False

        # 设置 Cloudinary 为默认
        cloudinary_config.is_default = True

        await db.commit()

        return {
            "success": True,
            "message": "Cloudinary set as default storage provider"
        }

    except Exception as e:
        logger.error(f"Failed to set Cloudinary as default: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 水印配置管理
@router.post("/configs")
async def create_watermark_config(
    request: Request,
    name: str = Form(...),
    scale_ratio: float = Form(0.2),
    opacity: float = Form(0.8),
    margin_pixels: int = Form(10),
    positions: str = Form('["bottom_right"]'),  # JSON字符串
    watermark_file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """创建水印配置"""
    try:
        # 解析positions JSON
        import json
        logger.info(f"Creating watermark config: name={name}, positions={positions}")
        positions_list = json.loads(positions)

        # 使用图片存储工厂获取当前激活的图床服务（自动选择 OSS 或 Cloudinary）
        logger.info("Getting image storage service from factory")
        try:
            service = await ImageStorageFactory.create_from_db(db)
            logger.info(f"Image storage service created: {type(service).__name__}")

            # 获取当前激活的图床类型，用于记录到 storage_provider 字段
            active_provider = await ImageStorageFactory.get_active_provider_type(db)
            if not active_provider:
                raise ValueError("无法确定当前激活的图床类型")
            logger.info(f"Active storage provider: {active_provider}")
        except ValueError as e:
            logger.error(f"Failed to get image storage service: {e}")
            raise HTTPException(status_code=400, detail=str(e))

        # 上传水印图片到图床
        watermark_data = await watermark_file.read()
        unique_id = uuid4().hex[:12]
        folder = service.watermark_images_folder or "watermarks"

        logger.info(f"Uploading watermark to folder: {folder}, public_id: {unique_id}, data_size: {len(watermark_data)} bytes")

        upload_result = await service.upload_image(
            watermark_data,
            public_id=unique_id,
            folder=folder,
            tags=["watermark"]
        )

        logger.info(f"Upload result: {upload_result}")

        if not upload_result["success"]:
            error_msg = upload_result.get("error", "Unknown error")
            logger.error(f"Failed to upload watermark image: {error_msg}")
            raise HTTPException(status_code=500, detail=f"Failed to upload watermark image: {error_msg}")

        # 创建水印配置（默认透明PNG水印）
        watermark_config = WatermarkConfig(
            name=name,
            storage_provider=active_provider,  # 自动关联当前激活的图床
            cloudinary_public_id=upload_result["public_id"],
            image_url=upload_result["url"],
            scale_ratio=Decimal(str(scale_ratio)),
            opacity=Decimal(str(opacity)),
            margin_pixels=margin_pixels,
            positions=positions_list
        )

        db.add(watermark_config)
        await db.commit()
        await db.refresh(watermark_config)

        # 立即读取所有属性以确保它们已加载（避免后续同步访问）
        config_id = watermark_config.id
        config_name = watermark_config.name
        config_image_url = watermark_config.image_url
        config_cloudinary_public_id = watermark_config.cloudinary_public_id
        config_scale_ratio = watermark_config.scale_ratio
        config_opacity = watermark_config.opacity
        config_margin_pixels = watermark_config.margin_pixels
        config_positions = watermark_config.positions
        config_is_active = watermark_config.is_active
        config_created_at = watermark_config.created_at
        config_updated_at = watermark_config.updated_at

        # 记录审计日志
        try:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="create",
                action_display="创建水印配置",
                table_name="watermark_configs",
                record_id=str(config_id),
                changes={
                    "name": name,
                    "cloudinary_public_id": upload_result["public_id"],
                    "scale_ratio": str(scale_ratio),
                    "opacity": str(opacity),
                    "margin_pixels": margin_pixels,
                    "positions": positions_list
                },
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
                request_id=getattr(request.state, "request_id", None)
            )
        except Exception as audit_error:
            logger.error(f"Failed to log audit: {audit_error}")

        response = WatermarkConfigResponse(
            id=config_id,
            name=config_name,
            image_url=config_image_url,
            cloudinary_public_id=config_cloudinary_public_id,
            scale_ratio=float(config_scale_ratio),
            opacity=float(config_opacity),
            margin_pixels=config_margin_pixels,
            positions=config_positions or [],
            is_active=config_is_active,
            created_at=config_created_at,
            updated_at=config_updated_at
        )
        return response

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        logger.error(f"Failed to create watermark config: {e}\n{tb}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/configs")
async def list_watermark_configs(
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取水印配置列表（全局）

    仅返回与当前激活图床匹配的水印配置。
    例如：当阿里云 OSS 激活时，只返回 storage_provider='aliyun_oss' 的水印配置。
    """
    # 获取当前激活的图床类型
    active_provider = await ImageStorageFactory.get_active_provider_type(db)

    if not active_provider:
        # 没有激活的图床配置，返回空列表
        logger.warning("没有找到激活的图床配置，返回空水印列表")
        return []

    logger.info(f"获取水印配置列表，筛选条件: storage_provider={active_provider}")

    # 根据图床类型筛选水印配置
    result = await db.execute(
        select(WatermarkConfig)
        .where(WatermarkConfig.storage_provider == active_provider)
        .order_by(WatermarkConfig.created_at.desc())
    )
    configs = result.scalars().all()

    logger.info(f"找到 {len(configs)} 个匹配的水印配置")

    return [
        WatermarkConfigResponse(
            id=config.id,
            name=config.name,
            image_url=config.image_url,
            cloudinary_public_id=config.cloudinary_public_id,
            scale_ratio=float(config.scale_ratio),
            opacity=float(config.opacity),
            margin_pixels=config.margin_pixels,
            positions=config.positions or [],
            is_active=config.is_active,
            created_at=config.created_at,
            updated_at=config.updated_at
        )
        for config in configs
    ]


@router.put("/configs/{config_id}")
async def update_watermark_config(
    request: Request,
    config_id: int,
    scale_ratio: float = Form(0.2),
    opacity: float = Form(0.8),
    margin_pixels: int = Form(10),
    positions: str = Form('["bottom_right"]'),  # JSON字符串
    is_active: bool = Form(True),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """更新水印配置"""
    try:
        # 解析positions JSON
        import json
        positions_list = json.loads(positions)

        # 获取水印配置
        config = await db.get(WatermarkConfig, config_id)
        if not config:
            raise HTTPException(status_code=404, detail="Watermark config not found")

        # 记录旧值
        old_values = {
            "scale_ratio": str(config.scale_ratio),
            "opacity": str(config.opacity),
            "margin_pixels": config.margin_pixels,
            "positions": config.positions,
            "is_active": config.is_active
        }

        # 更新配置
        config.scale_ratio = Decimal(str(scale_ratio))
        config.opacity = Decimal(str(opacity))
        config.margin_pixels = margin_pixels
        config.positions = positions_list
        config.is_active = is_active
        config.updated_at = utcnow()

        await db.commit()
        await db.refresh(config)

        # 立即读取所有属性以确保它们已加载（避免后续同步访问导致 greenlet_spawn 错误）
        config_id = config.id
        config_name = config.name
        config_image_url = config.image_url
        config_cloudinary_public_id = config.cloudinary_public_id
        config_scale_ratio = config.scale_ratio
        config_opacity = config.opacity
        config_margin_pixels = config.margin_pixels
        config_positions = config.positions
        config_is_active = config.is_active
        config_created_at = config.created_at
        config_updated_at = config.updated_at

        # 记录审计日志
        try:
            changes = {}
            if str(scale_ratio) != old_values["scale_ratio"]:
                changes["scale_ratio"] = {"old": old_values["scale_ratio"], "new": str(scale_ratio)}
            if str(opacity) != old_values["opacity"]:
                changes["opacity"] = {"old": old_values["opacity"], "new": str(opacity)}
            if margin_pixels != old_values["margin_pixels"]:
                changes["margin_pixels"] = {"old": old_values["margin_pixels"], "new": margin_pixels}
            if positions_list != old_values["positions"]:
                changes["positions"] = {"old": old_values["positions"], "new": positions_list}
            if is_active != old_values["is_active"]:
                changes["is_active"] = {"old": old_values["is_active"], "new": is_active}

            if changes:
                await AuditService.log_action(
                    db=db,
                    user_id=current_user.id,
                    username=current_user.username,
                    module="ozon",
                    action="update",
                    action_display="更新水印配置",
                    table_name="watermark_configs",
                    record_id=str(config_id),
                    changes=changes,
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                    request_id=getattr(request.state, "request_id", None)
                )
        except Exception as audit_error:
            logger.error(f"Failed to log audit: {audit_error}")

        return WatermarkConfigResponse(
            id=config_id,
            name=config_name,
            image_url=config_image_url,
            cloudinary_public_id=config_cloudinary_public_id,
            scale_ratio=float(config_scale_ratio),
            opacity=float(config_opacity),
            margin_pixels=config_margin_pixels,
            positions=config_positions or [],
            is_active=config_is_active,
            created_at=config_created_at,
            updated_at=config_updated_at
        )

    except Exception as e:
        logger.error(f"Failed to update watermark config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/configs/{config_id}")
async def delete_watermark_config(
    request: Request,
    config_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """删除水印配置"""
    config = await db.get(WatermarkConfig, config_id)

    if not config:
        raise HTTPException(status_code=404, detail="Watermark config not found")

    # 记录删除的数据
    deleted_data = {
        "name": config.name,
        "cloudinary_public_id": config.cloudinary_public_id,
        "image_url": config.image_url,
        "scale_ratio": str(config.scale_ratio),
        "opacity": str(config.opacity),
        "margin_pixels": config.margin_pixels,
        "positions": config.positions
    }

    # 根据水印配置的图床类型删除图片资源
    try:
        # 根据 storage_provider 选择对应的图床服务
        if config.storage_provider == "aliyun_oss":
            # 查询阿里云 OSS 配置
            stmt = select(AliyunOssConfig).where(AliyunOssConfig.enabled == True)
            oss_config = await db.scalar(stmt)
            if oss_config:
                from ..services.image_storage_factory import ImageStorageFactory
                service = await ImageStorageFactory._create_aliyun_oss_service(oss_config)
                await service.delete_resource(config.cloudinary_public_id)
                logger.info(f"已从阿里云 OSS 删除水印图片: {config.cloudinary_public_id}")
            else:
                logger.warning(f"阿里云 OSS 配置未找到，无法删除水印图片: {config.cloudinary_public_id}")
        else:  # cloudinary
            # 查询 Cloudinary 配置
            cloudinary_config = await CloudinaryConfigManager.get_config(db)
            if cloudinary_config:
                service = await CloudinaryConfigManager.create_service_from_config(cloudinary_config)
                await service.delete_resource(config.cloudinary_public_id)
                logger.info(f"已从 Cloudinary 删除水印图片: {config.cloudinary_public_id}")
            else:
                logger.warning(f"Cloudinary 配置未找到，无法删除水印图片: {config.cloudinary_public_id}")
    except Exception as e:
        # 删除图床资源失败不应阻断数据库删除操作，仅记录日志
        logger.error(f"删除图床资源失败（将继续删除数据库记录）: {e}", exc_info=True)

    await db.delete(config)
    await db.commit()

    # 记录审计日志
    try:
        await AuditService.log_action(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            module="ozon",
            action="delete",
            action_display="删除水印配置",
            table_name="watermark_configs",
            record_id=str(config_id),
            changes={"deleted_data": deleted_data},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_id=getattr(request.state, "request_id", None)
        )
    except Exception as audit_error:
        logger.error(f"Failed to log audit: {audit_error}")

    return {"success": True, "message": "Watermark config deleted"}


# 水印预览
@router.post("/preview")
async def preview_watermark(
    request: WatermarkPreviewRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """预览单图水印效果"""
    try:
        # 获取水印配置
        config = await db.get(WatermarkConfig, request.watermark_config_id)
        if not config:
            raise HTTPException(status_code=404, detail="Watermark config not found")

        # 创建图片处理服务
        processor = ImageProcessingService()

        # 处理图片（默认透明PNG水印）
        watermark_config_dict = {
            "opacity": float(config.opacity),
            "scale_ratio": float(config.scale_ratio),
            "margin_pixels": config.margin_pixels,
            "positions": config.positions
        }

        position = WatermarkPosition(request.position) if request.position else None

        result_image, metadata = await processor.process_image_with_watermark(
            request.image_url,
            config.image_url,
            watermark_config_dict,
            position
        )

        # 转换为base64（使用PNG格式保持质量，避免JPEG压缩）
        base64_image = processor.image_to_base64(result_image, format="PNG")

        return {
            "success": True,
            "preview_image": base64_image,
            "metadata": metadata
        }

    except Exception as e:
        logger.error(f"Failed to preview watermark: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/apply")
async def apply_watermark_to_url(
    request: ApplyWatermarkToUrlRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    URL方式应用水印（使用Cloudinary/阿里云transformation，不上传新文件）

    直接在原图URL上添加transformation参数，返回带水印的URL
    原图和水印图都已经在图床上，无需重新上传
    """
    try:
        # 获取水印配置
        config = await db.get(WatermarkConfig, request.watermark_config_id)
        if not config:
            raise HTTPException(status_code=404, detail="Watermark config not found")

        # 获取存储服务
        storage_service = await ImageStorageFactory.create_from_db(db)

        # 根据存储类型选择处理方式
        if isinstance(storage_service, CloudinaryService):
            # Cloudinary: 直接在URL上添加transformation参数（不上传新文件）
            from urllib.parse import urlparse

            # 从原图URL提取public_id
            parsed = urlparse(request.image_url)
            path_parts = parsed.path.split('/')

            # Cloudinary URL格式: /{cloud}/image/upload/v{version}/{folder}/{public_id}.{ext}
            # 找到 'upload' 后的部分
            try:
                upload_idx = path_parts.index('upload')
                # 跳过版本号(v开头)或直接到文件夹
                start_idx = upload_idx + 1
                if start_idx < len(path_parts) and path_parts[start_idx].startswith('v'):
                    start_idx += 1

                # 获取剩余路径（包括文件夹和文件名）
                public_id_with_ext = '/'.join(path_parts[start_idx:])
                # 移除文件扩展名
                public_id = public_id_with_ext.rsplit('.', 1)[0] if '.' in public_id_with_ext else public_id_with_ext
            except (ValueError, IndexError):
                raise HTTPException(status_code=400, detail="Invalid Cloudinary URL format")

            # 手动构建transformation URL
            # 标准格式: l_{overlay}/c_scale,fl_relative,w_{scale},o_{opacity}/fl_layer_apply,g_{gravity},x_{x},y_{y}
            watermark_public_id = config.cloudinary_public_id.replace("/", ":")
            opacity = int(float(config.opacity) * 100)
            scale = float(config.scale_ratio)
            gravity = _map_position_to_gravity(request.position)
            x = config.margin_pixels
            y = config.margin_pixels

            # 构建transformation字符串（分为3个步骤）
            transformation_str = f"l_{watermark_public_id}/c_scale,fl_relative,w_{scale},o_{opacity}/fl_layer_apply,g_{gravity},x_{x},y_{y}"

            # 重新组装URL：保留原始的cloud_name和版本号
            # 提取cloud_name
            cloud_name = None
            for part in path_parts:
                if part and not part.startswith('/'):
                    cloud_name = part
                    break

            if not cloud_name:
                raise HTTPException(status_code=400, detail="Cannot extract cloud name from URL")

            # 构建完整URL
            # 从netloc提取cloud_name：res.cloudinary.com -> 从原URL host中提取
            # 或者从URL路径中提取
            cloud_name_from_netloc = parsed.netloc.split('.')[0]  # 可能是 'res'

            # 更可靠的方式：从原始URL中提取
            # Cloudinary URL格式: https://res.cloudinary.com/{cloud_name}/...
            # 我们需要确保使用正确的cloudinary配置
            import cloudinary
            actual_cloud_name = cloudinary.config().cloud_name if cloudinary.config().cloud_name else cloud_name_from_netloc

            watermarked_url = f"https://res.cloudinary.com/{actual_cloud_name}/image/upload/{transformation_str}/{public_id_with_ext}"

            # 输出调试信息
            logger.info(f"Cloudinary watermark URL generation:")
            logger.info(f"  Original URL: {request.image_url}")
            logger.info(f"  Watermark public_id: {watermark_public_id}")
            logger.info(f"  Transformation: {transformation_str}")
            logger.info(f"  Final URL: {watermarked_url}")

            return {
                "success": True,
                "url": watermarked_url,
                "public_id": public_id
            }

        elif isinstance(storage_service, AliyunOssService):
            # 阿里云OSS: 在原URL上添加x-oss-process参数
            from ..services.watermark_processor import WatermarkProcessor
            processor = WatermarkProcessor(db)

            watermarked_url = await processor._build_aliyun_oss_watermark_url(
                request.image_url,
                config,
                position=request.position
            )

            # 从URL提取public_id
            from urllib.parse import urlparse
            parsed = urlparse(request.image_url)
            public_id = parsed.path.lstrip('/')

            return {
                "success": True,
                "url": watermarked_url,
                "public_id": public_id
            }
        else:
            raise HTTPException(status_code=500, detail="Unknown storage service type")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to apply watermark: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _map_position_to_gravity(position: str) -> str:
    """映射位置到Cloudinary gravity参数"""
    mapping = {
        "top_left": "north_west",
        "top_center": "north",
        "top_right": "north_east",
        "center_left": "west",
        "center": "center",
        "center_right": "east",
        "bottom_left": "south_west",
        "bottom_center": "south",
        "bottom_right": "south_east"
    }
    return mapping.get(position, "south_east")


@router.post("/batch/preview")
async def preview_watermark_batch(
    request: BatchPreviewRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """批量预览水印效果，返回每个商品所有图片的预览结果（不进行位置分析）"""
    try:
        # 限制最多10个商品
        if len(request.product_ids) > 10:
            raise HTTPException(
                status_code=400,
                detail="批量预览最多支持10个商品"
            )

        # 获取水印配置
        config = await db.get(WatermarkConfig, request.watermark_config_id)
        if not config:
            raise HTTPException(status_code=404, detail="Watermark config not found")

        # 获取商品信息
        products_result = await db.execute(
            select(OzonProduct).where(
                and_(
                    OzonProduct.shop_id == request.shop_id,
                    OzonProduct.id.in_(request.product_ids)
                )
            )
        )
        products = products_result.scalars().all()

        if len(products) != len(request.product_ids):
            raise HTTPException(status_code=400, detail="Some products not found")

        # 预览模式不需要处理服务，只返回原图信息

        preview_results = []
        total_images_processed = 0
        max_total_images = 30  # 限制总预览图片数量

        for product in products:
            # 收集商品所有图片
            product_images = []

            # 添加主图
            if product.images and product.images.get("primary"):
                product_images.append({
                    "url": product.images["primary"],
                    "type": "primary"
                })

            # 添加附加图片
            if product.images and product.images.get("additional"):
                for idx, img_url in enumerate(product.images["additional"][:5]):  # 限制每个商品最多5张附加图
                    product_images.append({
                        "url": img_url,
                        "type": "additional",
                        "index": idx
                    })

            if not product_images:
                preview_results.append({
                    "product_id": product.id,
                    "offer_id": product.offer_id,
                    "title": product.title,
                    "error": "No images available",
                    "images": []
                })
                continue

            # 处理商品的每张图片
            image_previews = []
            # 预览时不生成水印图片，只返回原图信息

            for img_info in product_images:
                # 检查是否超过总图片限制
                if total_images_processed >= max_total_images:
                    break

                try:
                    # 直接返回原图信息，不进行水印处理
                    image_previews.append({
                        "original_url": img_info["url"],
                        "image_type": img_info["type"],
                        "image_index": img_info.get("index", 0),
                        "suggested_position": "bottom_right",  # 默认建议位置
                        "metadata": {
                            "original_size": None,  # 前端根据需要获取
                            "watermark_size": None,
                            "position": "bottom_right",
                            "opacity": float(config.opacity),
                            "scale_ratio": float(config.scale_ratio),
                            "margin_pixels": config.margin_pixels
                        }
                    })

                    total_images_processed += 1

                except Exception as e:
                    logger.error(f"Failed to process image info for product {product.id}: {e}")
                    image_previews.append({
                        "original_url": img_info["url"],
                        "image_type": img_info["type"],
                        "image_index": img_info.get("index", 0),
                        "error": str(e)
                    })

            preview_results.append({
                "product_id": product.id,
                "offer_id": product.offer_id,
                "title": product.title,
                "images": image_previews,
                "total_images": len(product_images)
            })

            # 检查是否已达到总图片限制
            if total_images_processed >= max_total_images:
                break

        return {
            "success": True,
            "total_products": len(products),
            "total_images": total_images_processed,
            "previews": preview_results,
            "watermark_config": {
                "id": config.id,
                "name": config.name,
                "image_url": config.image_url
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to preview watermark batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 批量水印任务
@router.post("/batch/apply")
async def apply_watermark_batch(
    request: BatchWatermarkRequest,
    sync_mode: bool = Query(True, description="同步处理模式（True:立即处理，False:异步处理）"),
    analyze_mode: str = Query("individual", description="分析模式: 'individual'=每张图片单独分析, 'fast'=使用第一张图片的分析结果"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """批量应用水印"""
    try:
        # 验证水印配置
        config = await db.get(WatermarkConfig, request.watermark_config_id)
        if not config:
            raise HTTPException(status_code=404, detail="Watermark config not found")

        # 验证商品存在
        result = await db.execute(
            select(OzonProduct)
            .where(
                and_(
                    OzonProduct.shop_id == request.shop_id,
                    OzonProduct.id.in_(request.product_ids)
                )
            )
        )
        products = result.scalars().all()

        if len(products) != len(request.product_ids):
            raise HTTPException(status_code=400, detail="Some products not found")

        # 创建批次ID
        batch_id = str(uuid4())
        batch_total = len(request.product_ids)

        # 先清理同一商品的未完成任务
        await db.execute(
            update(WatermarkTask)
            .where(
                and_(
                    WatermarkTask.shop_id == request.shop_id,
                    WatermarkTask.product_id.in_(request.product_ids),
                    WatermarkTask.status.in_(["pending", "processing"])
                )
            )
            .values(
                status="cancelled",
                error_message="Cancelled due to new task",
                completed_at=utcnow()
            )
        )
        await db.commit()

        # 创建任务记录（统一用pending状态）
        tasks = []
        for i, product_id in enumerate(request.product_ids):
            task = WatermarkTask(
                shop_id=request.shop_id,
                product_id=product_id,
                watermark_config_id=request.watermark_config_id,
                task_type="apply",
                status="pending",  # 始终用pending状态
                batch_id=batch_id,
                batch_total=batch_total,
                batch_position=i + 1
            )
            db.add(task)
            tasks.append(task)

        await db.commit()

        if sync_mode:
            # 同步处理模式 - 立即处理
            from ..services.watermark_processor import WatermarkProcessor
            processor = WatermarkProcessor(db)

            success_count = 0
            failed_count = 0

            for task in tasks:
                try:
                    # 更新任务状态为处理中
                    task.status = "processing"
                    task.processing_started_at = utcnow()
                    await db.commit()

                    # 获取该商品的手动位置选择（如果有）
                    product_positions = None
                    if request.position_overrides:
                        product_positions = request.position_overrides.get(str(task.product_id))

                    # 处理单个商品
                    result = await processor.process_single_product(
                        task.product_id,
                        task.shop_id,
                        task.watermark_config_id,
                        str(task.id),
                        analyze_mode=analyze_mode,
                        position_overrides=product_positions
                    )

                    # 更新任务状态为完成
                    task.status = "completed"
                    task.completed_at = utcnow()
                    task.processed_images = result.get("processed_images", [])
                    task.original_images = result.get("original_images", [])
                    task.cloudinary_public_ids = result.get("cloudinary_ids", [])
                    success_count += 1

                except Exception as e:
                    # 更新任务状态为失败
                    logger.error(f"Failed to process task {task.id}: {e}")
                    task.status = "failed"
                    task.error_message = str(e)
                    task.completed_at = utcnow()
                    failed_count += 1

                await db.commit()

            return {
                "success": True,
                "batch_id": batch_id,
                "sync_mode": sync_mode,
                "task_count": len(tasks),
                "success_count": success_count,
                "failed_count": failed_count,
                "message": f"Watermark processing completed: {success_count} succeeded, {failed_count} failed"
            }
        else:
            # 异步模式 - 创建任务后返回，等待worker处理
            # TODO: 触发异步任务处理
            # from ..services.watermark_task_service import process_watermark_batch
            # process_watermark_batch.delay(batch_id, request.shop_id, request.product_ids, request.watermark_config_id)

            return {
                "success": True,
                "batch_id": batch_id,
                "sync_mode": sync_mode,
                "task_count": len(tasks),
                "message": "Watermark batch processing queued for async processing"
            }

    except Exception as e:
        logger.error(f"Failed to start watermark batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch/restore")
async def restore_original_batch(
    request: BatchRestoreRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """批量还原原图"""
    try:
        # 创建批次ID
        batch_id = str(uuid4())
        batch_total = len(request.product_ids)

        # 创建还原任务
        tasks = []
        for i, product_id in enumerate(request.product_ids):
            # 查找最近的水印任务以获取原图
            recent_task = await db.execute(
                select(WatermarkTask)
                .where(
                    and_(
                        WatermarkTask.shop_id == request.shop_id,
                        WatermarkTask.product_id == product_id,
                        WatermarkTask.task_type == "apply",
                        WatermarkTask.status == "completed"
                    )
                )
                .order_by(WatermarkTask.completed_at.desc())
                .limit(1)
            )
            recent = recent_task.scalar_one_or_none()

            if not recent or not recent.original_images:
                continue

            task = WatermarkTask(
                shop_id=request.shop_id,
                product_id=product_id,
                task_type="restore",
                status="pending",
                original_images=recent.original_images,
                batch_id=batch_id,
                batch_total=batch_total,
                batch_position=i + 1
            )
            db.add(task)
            tasks.append(task)

        await db.commit()

        # TODO: 触发异步还原任务

        return {
            "success": True,
            "batch_id": batch_id,
            "task_count": len(tasks),
            "message": "Restore batch processing started"
        }

    except Exception as e:
        logger.error(f"Failed to start restore batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tasks/{task_id}")
async def get_task_status(
    task_id: str,
    db: AsyncSession = Depends(get_async_session)
):
    """获取任务状态"""
    task = await db.get(WatermarkTask, task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return WatermarkTaskResponse(
        id=task.id,
        shop_id=task.shop_id,
        product_id=task.product_id,
        task_type=task.task_type,
        status=task.status,
        watermark_config_id=task.watermark_config_id,
        error_message=task.error_message,
        retry_count=task.retry_count,
        batch_id=task.batch_id,
        batch_total=task.batch_total,
        batch_position=task.batch_position,
        created_at=task.created_at,
        processing_started_at=task.processing_started_at,
        completed_at=task.completed_at
    )


@router.get("/tasks")
async def list_tasks(
    shop_id: Optional[int] = Query(None),
    batch_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_async_session)
):
    """获取任务列表"""
    query = select(WatermarkTask)

    if shop_id is not None:
        query = query.where(WatermarkTask.shop_id == shop_id)

    if batch_id:
        query = query.where(WatermarkTask.batch_id == batch_id)

    if status:
        query = query.where(WatermarkTask.status == status)

    query = query.order_by(WatermarkTask.created_at.desc()).limit(limit)

    result = await db.execute(query)
    tasks = result.scalars().all()

    return [
        WatermarkTaskResponse(
            id=task.id,
            shop_id=task.shop_id,
            product_id=task.product_id,
            task_type=task.task_type,
            status=task.status,
            watermark_config_id=task.watermark_config_id,
            error_message=task.error_message,
            retry_count=task.retry_count,
            batch_id=task.batch_id,
            batch_total=task.batch_total,
            batch_position=task.batch_position,
            created_at=task.created_at,
            processing_started_at=task.processing_started_at,
            completed_at=task.completed_at
        )
        for task in tasks
    ]


# 资源清理
@router.delete("/cleanup")
async def cleanup_old_resources(
    shop_id: Optional[int] = Query(None),
    days: int = Query(30, ge=1),
    dry_run: bool = Query(False),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """清理过期Cloudinary资源"""
    try:
        # 获取Cloudinary配置（全局配置）
        cloudinary_config = await CloudinaryConfigManager.get_config(db)
        if not cloudinary_config:
            raise HTTPException(status_code=400, detail="Cloudinary not configured")

        # 创建服务
        service = await CloudinaryConfigManager.create_service_from_config(cloudinary_config)

        # 执行清理（清理加水印后的商品图片）
        base_folder = f"{cloudinary_config.product_images_folder}/watermarked"
        folder = f"{base_folder}/{shop_id}" if shop_id is not None else base_folder
        result = await service.cleanup_old_resources(folder, days, dry_run)

        return result

    except Exception as e:
        logger.error(f"Failed to cleanup resources: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 资源管理
@router.get("/resources")
async def list_image_storage_resources(
    folder: Optional[str] = Query(None, description="文件夹路径筛选"),
    max_results: int = Query(500, le=500, description="每页最大结果数"),
    next_cursor: Optional[str] = Query(None, description="分页游标"),
    group_by_folder: bool = Query(True, description="是否按文件夹分组"),
    db: AsyncSession = Depends(get_async_session)
):
    """列出图床资源（自动选择当前激活的图床）"""
    try:
        # 使用图片存储工厂获取当前激活的图床服务
        try:
            service = await ImageStorageFactory.create_from_db(db)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # 列出资源
        result = await service.list_resources(
            folder=folder,
            max_results=max_results
        )

        if not result["success"]:
            raise HTTPException(status_code=500, detail=result.get("error", "Failed to list resources"))

        resources = result["resources"]

        # 按文件夹分组
        if group_by_folder:
            folder_tree = {}

            for resource in resources:
                # 优先使用 Cloudinary API 返回的 folder 字段
                # 注意：空字符串 "" 是有效值，表示根目录
                if resource.get("folder") is not None:
                    folder_path = resource.get("folder")
                elif resource.get("asset_folder") is not None:
                    folder_path = resource.get("asset_folder")
                else:
                    # 从 public_id 解析（兜底方案：当两个字段都不存在时）
                    public_id = resource["public_id"]
                    parts = public_id.split("/")
                    if len(parts) > 1:
                        folder_path = "/".join(parts[:-1])
                    else:
                        folder_path = ""

                # 标准化文件夹路径（去除前后斜杠）
                folder_path = folder_path.strip("/") if folder_path else ""

                if folder_path not in folder_tree:
                    folder_tree[folder_path] = {
                        "folder": folder_path,
                        "resources": []
                    }

                folder_tree[folder_path]["resources"].append(resource)

            # 转换为列表并排序
            folders = [
                {
                    "folder": folder_path if folder_path else "(根目录)",
                    "folder_path": folder_path,
                    "resource_count": len(data["resources"]),
                    "resources": data["resources"]
                }
                for folder_path, data in folder_tree.items()
            ]

            # 按文件夹路径排序
            folders.sort(key=lambda x: x["folder_path"])

            return {
                "success": True,
                "folders": folders,
                "total": result["total"],
                "next_cursor": result.get("next_cursor")
            }
        else:
            # 不分组，直接返回列表
            return {
                "success": True,
                "resources": resources,
                "total": result["total"],
                "next_cursor": result.get("next_cursor")
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list resources: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/resources")
async def delete_image_storage_resources(
    http_request: Request,
    request: Dict[str, List[str]] = Body(..., description='{"public_ids": ["id1", "id2"]}'),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """批量删除图床资源（自动选择当前激活的图床）"""
    try:
        public_ids = request.get("public_ids", [])

        if not public_ids:
            raise HTTPException(status_code=400, detail="No public_ids provided")

        if len(public_ids) > 100:
            raise HTTPException(status_code=400, detail="Cannot delete more than 100 resources at once")

        # 使用图片存储工厂获取当前激活的图床服务
        try:
            service = await ImageStorageFactory.create_from_db(db)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # 批量删除
        result = await service.delete_resources(public_ids)

        if not result["success"]:
            raise HTTPException(status_code=500, detail=result.get("error", "Failed to delete resources"))

        # 记录审计日志
        try:
            deleted_ids = result.get("deleted", [])
            if deleted_ids:
                await AuditService.log_action(
                    db=db,
                    user_id=current_user.id,
                    username=current_user.username,
                    module="ozon",
                    action="delete",
                    action_display="删除Cloudinary资源",
                    table_name="cloudinary_resources",
                    record_id=",".join(deleted_ids[:5]) + ("..." if len(deleted_ids) > 5 else ""),
                    changes={
                        "deleted_count": len(deleted_ids),
                        "deleted_public_ids": deleted_ids,
                        "not_found": result.get("not_found", [])
                    },
                    ip_address=http_request.client.host if http_request.client else None,
                    user_agent=http_request.headers.get("user-agent"),
                    request_id=getattr(http_request.state, "request_id", None)
                )
        except Exception as audit_error:
            logger.error(f"Failed to log audit: {audit_error}")

        return {
            "success": True,
            "deleted": result.get("deleted", []),
            "not_found": result.get("not_found", []),
            "deleted_count": len(result.get("deleted", [])),
            "total_requested": result.get("total_requested", 0)
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete resources: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload-refined-images", summary="上传精修后的图片到当前图床")
async def upload_refined_images(
    request_body: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
) -> Dict[str, Any]:
    """
    从象寄精修工具返回的URL异步上传图片到当前激活的图床

    Args:
        request_body: {
            "shop_id": int,
            "images": [
                {"xiangji_url": str, "request_id": str},
                ...
            ]
        }

    Returns:
        {
            "success": true,
            "results": [
                {"request_id": str, "xiangji_url": str, "storage_url": str, "success": true},
                ...
            ]
        }
    """
    try:
        shop_id = request_body.get("shop_id")
        images = request_body.get("images", [])

        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        if not images:
            raise HTTPException(status_code=400, detail="images is required")

        logger.info(f"开始上传精修图片到当前图床，shop_id={shop_id}, count={len(images)}")

        # 获取当前激活的图床服务
        try:
            service = await ImageStorageFactory.create_from_db(db)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # 异步上传所有图片
        results = []
        for img_data in images:
            xiangji_url = img_data.get("xiangji_url")
            request_id = img_data.get("request_id")

            if not xiangji_url or not request_id:
                results.append({
                    "request_id": request_id,
                    "xiangji_url": xiangji_url,
                    "storage_url": None,
                    "success": False,
                    "error": "Missing xiangji_url or request_id"
                })
                continue

            try:
                # 使用request_id作为public_id
                public_id = f"refined_{request_id}"

                # 上传到当前图床（from URL）
                result = await service.upload_image_from_url(
                    image_url=xiangji_url,
                    public_id=public_id,
                    folder="products"
                )

                if result.get("success"):
                    results.append({
                        "request_id": request_id,
                        "xiangji_url": xiangji_url,
                        "storage_url": result.get("url"),
                        "success": True
                    })
                    logger.info(f"成功上传精修图片: {request_id} -> {result.get('url')}")
                else:
                    results.append({
                        "request_id": request_id,
                        "xiangji_url": xiangji_url,
                        "storage_url": None,
                        "success": False,
                        "error": result.get("error", "Upload failed")
                    })
                    logger.error(f"上传精修图片失败: {request_id}, error: {result.get('error')}")

            except Exception as e:
                results.append({
                    "request_id": request_id,
                    "xiangji_url": xiangji_url,
                    "storage_url": None,
                    "success": False,
                    "error": str(e)
                })
                logger.error(f"上传精修图片异常: {request_id}, error: {str(e)}")

        # 统计成功和失败数量
        success_count = sum(1 for r in results if r["success"])
        fail_count = len(results) - success_count

        logger.info(f"精修图片上传完成，总数={len(results)}, 成功={success_count}, 失败={fail_count}")

        return {
            "success": True,
            "total": len(results),
            "success_count": success_count,
            "fail_count": fail_count,
            "results": results
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload refined images: {e}")
        raise HTTPException(status_code=500, detail=str(e))
