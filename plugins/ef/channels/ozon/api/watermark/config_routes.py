"""
水印配置 CRUD API 路由
"""

import logging
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.middleware.auth import require_role
from ef_core.models.users import User
from ef_core.services.audit_service import AuditService

from ...models.watermark import AliyunOssConfig, WatermarkConfig
from ...services.cloudinary_service import CloudinaryConfigManager
from ...services.image_storage_factory import ImageStorageFactory
from ...utils.datetime_utils import utcnow
from .dto import WatermarkConfigResponse

router = APIRouter(tags=["watermark-config"])
logger = logging.getLogger(__name__)


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
            stmt = select(AliyunOssConfig).where(AliyunOssConfig.enabled.is_(True))
            oss_config = await db.scalar(stmt)
            if oss_config:
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
