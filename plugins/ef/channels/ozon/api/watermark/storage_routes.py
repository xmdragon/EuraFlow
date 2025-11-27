"""
图床存储配置 API 路由
"""

import logging

from fastapi import APIRouter, Depends, Form, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.middleware.auth import require_role
from ef_core.models.users import User

from ...models.watermark import AliyunOssConfig, CloudinaryConfig
from ...services.aliyun_oss_service import AliyunOssConfigManager
from ...services.cloudinary_service import CloudinaryConfigManager
from ...utils.datetime_utils import utcnow
from .dto import AliyunOssConfigResponse, CloudinaryConfigResponse

router = APIRouter(tags=["watermark-storage"])
logger = logging.getLogger(__name__)


# ========== Cloudinary 配置 ==========

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
        select(CloudinaryConfig).where(CloudinaryConfig.is_active.is_(True)).limit(1)
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


@router.put("/cloudinary/set-default")
async def set_cloudinary_default(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """设置 Cloudinary 为默认图床"""
    try:
        cloudinary_result = await db.execute(
            select(CloudinaryConfig).where(CloudinaryConfig.is_active.is_(True)).limit(1)
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


# ========== 阿里云 OSS 配置 ==========

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
            select(CloudinaryConfig).where(CloudinaryConfig.is_default.is_(True))
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
