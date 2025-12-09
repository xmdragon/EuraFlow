"""
水印应用 API 路由（单个/批量）
"""

import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.middleware.auth import require_role
from ef_core.models.users import User

from ...models import OzonProduct
from ...models.watermark import WatermarkConfig, WatermarkTask
from ...services.aliyun_oss_service import AliyunOssService
from ...services.cloudinary_service import CloudinaryService
from ...services.image_processing_service import ImageProcessingService, WatermarkPosition
from ...services.image_storage_factory import ImageStorageFactory
from ...utils.datetime_utils import utcnow
from ...utils.image_utils import is_storage_url
from .dto import (
    ApplyWatermarkToUrlRequest,
    BatchPreviewRequest,
    BatchRestoreRequest,
    BatchWatermarkRequest,
    WatermarkPreviewRequest,
)

router = APIRouter(tags=["watermark-apply"])
logger = logging.getLogger(__name__)


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


@router.post("/preview")
async def preview_watermark(
    request: WatermarkPreviewRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
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
    current_user: User = Depends(require_role("sub_account"))
):
    """
    URL方式应用水印（使用Cloudinary/阿里云transformation，不上传新文件）

    直接在原图URL上添加transformation参数，返回带水印的URL
    原图和水印图都已经在图床上，无需重新上传

    如果图片URL不是图床URL（如象寄URL），会先上传到图床，再应用水印
    """
    try:
        # 检测图片URL是否是图床URL
        image_url = request.image_url

        if not is_storage_url(image_url):
            # 非图床URL，需要先上传到图床
            logger.info(f"检测到非图床URL，正在上传到图床: {image_url}")

            try:
                # 获取当前激活的图床服务
                storage_service = await ImageStorageFactory.create_from_db(db)

                # 生成唯一的public_id
                public_id = f"watermark_temp_{uuid4().hex[:12]}"

                # 上传图片到图床
                upload_result = await storage_service.upload_image_from_url(
                    image_url=image_url,
                    public_id=public_id,
                    folder="products"
                )

                if not upload_result.get("success") or not upload_result.get("url"):
                    raise HTTPException(
                        status_code=500,
                        detail=f"图片上传失败: {upload_result.get('error', '未知错误')}"
                    )

                # 使用上传后的URL
                image_url = upload_result["url"]
                logger.info(f"图片已上传到图床: {image_url}")

            except ValueError as e:
                raise HTTPException(status_code=400, detail=f"图床配置错误: {str(e)}")
            except Exception as e:
                logger.error(f"上传图片到图床失败: {e}")
                raise HTTPException(status_code=500, detail=f"上传图片失败: {str(e)}")

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
            parsed = urlparse(image_url)
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
            watermark_public_id = config.cloudinary_public_id.replace("/", ":")
            opacity = int(float(config.opacity) * 100)
            scale = float(config.scale_ratio)
            gravity = _map_position_to_gravity(request.position)
            x = config.margin_pixels
            y = config.margin_pixels

            # 构建transformation字符串（分为3个步骤）
            transformation_str = f"l_{watermark_public_id}/c_scale,fl_relative,w_{scale},o_{opacity}/fl_layer_apply,g_{gravity},x_{x},y_{y}"

            # 重新组装URL
            cloud_name = None
            for part in path_parts:
                if part and not part.startswith('/'):
                    cloud_name = part
                    break

            if not cloud_name:
                raise HTTPException(status_code=400, detail="Cannot extract cloud name from URL")

            cloud_name_from_netloc = parsed.netloc.split('.')[0]

            import cloudinary
            actual_cloud_name = cloudinary.config().cloud_name if cloudinary.config().cloud_name else cloud_name_from_netloc

            watermarked_url = f"https://res.cloudinary.com/{actual_cloud_name}/image/upload/{transformation_str}/{public_id_with_ext}"

            logger.info("Cloudinary watermark URL generation:")
            logger.info(f"  Original URL: {image_url}")
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
                image_url,
                config,
                position=request.position
            )

            # 从URL提取public_id
            from urllib.parse import urlparse
            parsed = urlparse(image_url)
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


@router.post("/batch/preview")
async def preview_watermark_batch(
    request: BatchPreviewRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
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

        preview_results = []
        total_images_processed = 0
        max_total_images = 30

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
                for idx, img_url in enumerate(product.images["additional"][:5]):
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

            for img_info in product_images:
                if total_images_processed >= max_total_images:
                    break

                try:
                    # 直接返回原图信息，不进行水印处理
                    image_previews.append({
                        "original_url": img_info["url"],
                        "image_type": img_info["type"],
                        "image_index": img_info.get("index", 0),
                        "suggested_position": "bottom_right",
                        "metadata": {
                            "original_size": None,
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


@router.post("/batch/apply")
async def apply_watermark_batch(
    request: BatchWatermarkRequest,
    sync_mode: bool = Query(True, description="同步处理模式（True:立即处理，False:异步处理）"),
    analyze_mode: str = Query("individual", description="分析模式: 'individual'=每张图片单独分析, 'fast'=使用第一张图片的分析结果"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
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

        # 创建任务记录
        tasks = []
        for i, product_id in enumerate(request.product_ids):
            task = WatermarkTask(
                shop_id=request.shop_id,
                product_id=product_id,
                watermark_config_id=request.watermark_config_id,
                task_type="apply",
                status="pending",
                batch_id=batch_id,
                batch_total=batch_total,
                batch_position=i + 1
            )
            db.add(task)
            tasks.append(task)

        await db.commit()

        if sync_mode:
            # 同步处理模式
            from ...services.watermark_processor import WatermarkProcessor
            processor = WatermarkProcessor(db)

            success_count = 0
            failed_count = 0

            for task in tasks:
                try:
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

                    task.status = "completed"
                    task.completed_at = utcnow()
                    task.processed_images = result.get("processed_images", [])
                    task.original_images = result.get("original_images", [])
                    task.cloudinary_public_ids = result.get("cloudinary_ids", [])
                    success_count += 1

                except Exception as e:
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
            # 异步模式
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
    current_user: User = Depends(require_role("sub_account"))
):
    """批量还原原图"""
    try:
        batch_id = str(uuid4())
        batch_total = len(request.product_ids)

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

        return {
            "success": True,
            "batch_id": batch_id,
            "task_count": len(tasks),
            "message": "Restore batch processing started"
        }

    except Exception as e:
        logger.error(f"Failed to start restore batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))
