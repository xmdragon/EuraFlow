"""
水印管理API路由
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, Body
from typing import Optional, Dict, Any, List
from datetime import datetime
from uuid import uuid4
from pydantic import BaseModel, Field
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, update
import logging

from ef_core.database import get_async_session
from ..models.watermark import WatermarkConfig, CloudinaryConfig, WatermarkTask
from ..models import OzonProduct, OzonShop
from ..services.cloudinary_service import CloudinaryService, CloudinaryConfigManager
from ..services.image_processing_service import ImageProcessingService, WatermarkPosition

router = APIRouter(prefix="/watermark", tags=["Watermark"])
logger = logging.getLogger(__name__)


# DTO 模型
class CloudinaryConfigDTO(BaseModel):
    """Cloudinary配置DTO"""
    cloud_name: str
    api_key: str
    api_secret: str
    folder_prefix: str = "euraflow"
    auto_cleanup_days: int = 30


class CloudinaryConfigResponse(BaseModel):
    """Cloudinary配置响应"""
    id: int
    shop_id: int
    cloud_name: str
    api_key: str
    folder_prefix: str
    auto_cleanup_days: int
    is_active: bool
    last_test_at: Optional[datetime]
    last_test_success: Optional[bool]
    storage_used_bytes: Optional[int]
    bandwidth_used_bytes: Optional[int]


class WatermarkConfigCreateDTO(BaseModel):
    """创建水印配置DTO"""
    name: str
    color_type: str = "white"
    scale_ratio: float = Field(default=0.1, ge=0.01, le=1.0)
    opacity: float = Field(default=0.8, ge=0.1, le=1.0)
    margin_pixels: int = Field(default=20, ge=0)
    positions: List[str] = Field(default=["bottom_right"])


class WatermarkConfigResponse(BaseModel):
    """水印配置响应"""
    id: int
    name: str
    image_url: str
    cloudinary_public_id: str
    color_type: str
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
    folder_prefix: str = Form("euraflow"),
    auto_cleanup_days: int = Form(30),
    db: AsyncSession = Depends(get_async_session)
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
            existing_config.folder_prefix = folder_prefix
            existing_config.auto_cleanup_days = auto_cleanup_days
            existing_config.updated_at = datetime.utcnow()
        else:
            # 创建新配置
            existing_config = CloudinaryConfig(
                cloud_name=cloud_name,
                api_key=api_key,
                api_secret_encrypted=api_secret,  # TODO: 加密
                folder_prefix=folder_prefix,
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
            folder_prefix=existing_config.folder_prefix,
            auto_cleanup_days=existing_config.auto_cleanup_days,
            is_active=existing_config.is_active,
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
    # 获取全局配置
    result = await db.execute(
        select(CloudinaryConfig).where(CloudinaryConfig.is_active == True).limit(1)
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(status_code=404, detail="Cloudinary configuration not found")

    return CloudinaryConfigResponse(
        id=config.id,
        shop_id=0,  # 全局配置，返回0
        cloud_name=config.cloud_name,
        api_key=config.api_key,
        folder_prefix=config.folder_prefix,
        auto_cleanup_days=config.auto_cleanup_days,
        is_active=config.is_active,
        last_test_at=config.last_test_at,
        last_test_success=config.last_test_success,
        storage_used_bytes=config.storage_used_bytes,
        bandwidth_used_bytes=config.bandwidth_used_bytes
    )


@router.post("/cloudinary/test")
async def test_cloudinary_connection(
    db: AsyncSession = Depends(get_async_session)
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
    config.last_test_at = datetime.utcnow()
    config.last_test_success = result["success"]

    if result["success"]:
        config.storage_used_bytes = result["usage"]["storage_used_bytes"]
        config.bandwidth_used_bytes = result["usage"]["bandwidth_used_bytes"]
        config.last_quota_check = datetime.utcnow()

    await db.commit()

    return result


# 水印配置管理
@router.post("/configs")
async def create_watermark_config(
    name: str = Form(...),
    color_type: str = Form("white"),
    scale_ratio: float = Form(0.1),
    opacity: float = Form(0.8),
    margin_pixels: int = Form(20),
    positions: str = Form('["bottom_right"]'),  # JSON字符串
    watermark_file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_session)
):
    """创建水印配置"""
    try:
        # 解析positions JSON
        import json
        positions_list = json.loads(positions)

        # 获取Cloudinary配置（全局配置）
        cloudinary_config = await CloudinaryConfigManager.get_config(db)
        if not cloudinary_config:
            raise HTTPException(status_code=400, detail="Cloudinary not configured")

        # 创建Cloudinary服务
        service = await CloudinaryConfigManager.create_service_from_config(cloudinary_config)

        # 上传水印图片到Cloudinary
        watermark_data = await watermark_file.read()
        unique_id = uuid4().hex[:12]
        folder_prefix = cloudinary_config.folder_prefix or "euraflow"
        folder = f"{folder_prefix}/watermarks".strip('/')

        upload_result = await service.upload_image(
            watermark_data,
            public_id=unique_id,
            folder=folder,
            tags=["watermark"]
        )

        if not upload_result["success"]:
            raise HTTPException(status_code=500, detail="Failed to upload watermark image")

        # 创建水印配置
        watermark_config = WatermarkConfig(
            name=name,
            cloudinary_public_id=upload_result["public_id"],
            image_url=upload_result["url"],
            color_type=color_type,
            scale_ratio=Decimal(str(scale_ratio)),
            opacity=Decimal(str(opacity)),
            margin_pixels=margin_pixels,
            positions=positions_list
        )

        db.add(watermark_config)
        await db.commit()
        await db.refresh(watermark_config)

        return WatermarkConfigResponse(
            id=watermark_config.id,
            name=watermark_config.name,
            image_url=watermark_config.image_url,
            cloudinary_public_id=watermark_config.cloudinary_public_id,
            color_type=watermark_config.color_type,
            scale_ratio=float(watermark_config.scale_ratio),
            opacity=float(watermark_config.opacity),
            margin_pixels=watermark_config.margin_pixels,
            positions=watermark_config.positions or [],
            is_active=watermark_config.is_active,
            created_at=watermark_config.created_at,
            updated_at=watermark_config.updated_at
        )

    except Exception as e:
        logger.error(f"Failed to create watermark config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/configs")
async def list_watermark_configs(
    db: AsyncSession = Depends(get_async_session)
):
    """获取水印配置列表（全局）"""
    result = await db.execute(
        select(WatermarkConfig)
        .order_by(WatermarkConfig.created_at.desc())
    )
    configs = result.scalars().all()

    return [
        WatermarkConfigResponse(
            id=config.id,
            name=config.name,
            image_url=config.image_url,
            cloudinary_public_id=config.cloudinary_public_id,
            color_type=config.color_type,
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
    config_id: int,
    scale_ratio: float = Form(0.1),
    opacity: float = Form(0.8),
    margin_pixels: int = Form(20),
    positions: str = Form('["bottom_right"]'),  # JSON字符串
    color_type: str = Form("white"),
    is_active: bool = Form(True),
    db: AsyncSession = Depends(get_async_session)
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

        # 更新配置
        config.scale_ratio = Decimal(str(scale_ratio))
        config.opacity = Decimal(str(opacity))
        config.margin_pixels = margin_pixels
        config.positions = positions_list
        config.color_type = color_type
        config.is_active = is_active
        config.updated_at = datetime.utcnow()

        await db.commit()
        await db.refresh(config)

        return WatermarkConfigResponse(
            id=config.id,
            name=config.name,
            image_url=config.image_url,
            cloudinary_public_id=config.cloudinary_public_id,
            color_type=config.color_type,
            scale_ratio=float(config.scale_ratio),
            opacity=float(config.opacity),
            margin_pixels=config.margin_pixels,
            positions=config.positions or [],
            is_active=config.is_active,
            created_at=config.created_at,
            updated_at=config.updated_at
        )

    except Exception as e:
        logger.error(f"Failed to update watermark config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/configs/{config_id}")
async def delete_watermark_config(
    config_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """删除水印配置"""
    config = await db.get(WatermarkConfig, config_id)

    if not config:
        raise HTTPException(status_code=404, detail="Watermark config not found")

    # 获取Cloudinary服务并删除图片（全局配置）
    cloudinary_config = await CloudinaryConfigManager.get_config(db)
    if cloudinary_config:
        service = await CloudinaryConfigManager.create_service_from_config(cloudinary_config)
        await service.delete_resource(config.cloudinary_public_id)

    await db.delete(config)
    await db.commit()

    return {"success": True, "message": "Watermark config deleted"}


# 水印预览
@router.post("/preview")
async def preview_watermark(
    request: WatermarkPreviewRequest,
    db: AsyncSession = Depends(get_async_session)
):
    """预览单图水印效果"""
    try:
        # 获取水印配置
        config = await db.get(WatermarkConfig, request.watermark_config_id)
        if not config:
            raise HTTPException(status_code=404, detail="Watermark config not found")

        # 创建图片处理服务
        processor = ImageProcessingService()

        # 处理图片
        watermark_config_dict = {
            "color_type": config.color_type,
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

        # 转换为base64
        base64_image = processor.image_to_base64(result_image)

        return {
            "success": True,
            "preview_image": base64_image,
            "metadata": metadata
        }

    except Exception as e:
        logger.error(f"Failed to preview watermark: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch/preview")
async def preview_watermark_batch(
    request: BatchPreviewRequest,
    db: AsyncSession = Depends(get_async_session)
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
                    "sku": product.sku,
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
                            "color_type": config.color_type,
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
                "sku": product.sku,
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
    db: AsyncSession = Depends(get_async_session)
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
                completed_at=datetime.utcnow()
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
                    task.processing_started_at = datetime.utcnow()
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
                    task.completed_at = datetime.utcnow()
                    task.processed_images = result.get("processed_images", [])
                    task.original_images = result.get("original_images", [])
                    task.cloudinary_public_ids = result.get("cloudinary_ids", [])
                    success_count += 1

                except Exception as e:
                    # 更新任务状态为失败
                    logger.error(f"Failed to process task {task.id}: {e}")
                    task.status = "failed"
                    task.error_message = str(e)
                    task.completed_at = datetime.utcnow()
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
    db: AsyncSession = Depends(get_async_session)
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
    db: AsyncSession = Depends(get_async_session)
):
    """清理过期Cloudinary资源"""
    try:
        # 获取Cloudinary配置（全局配置）
        cloudinary_config = await CloudinaryConfigManager.get_config(db)
        if not cloudinary_config:
            raise HTTPException(status_code=400, detail="Cloudinary not configured")

        # 创建服务
        service = await CloudinaryConfigManager.create_service_from_config(cloudinary_config)

        # 执行清理
        base_folder = f"{cloudinary_config.folder_prefix}/watermarked"
        folder = f"{base_folder}/{shop_id}" if shop_id is not None else base_folder
        result = await service.cleanup_old_resources(folder, days, dry_run)

        return result

    except Exception as e:
        logger.error(f"Failed to cleanup resources: {e}")
        raise HTTPException(status_code=500, detail=str(e))
