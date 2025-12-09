"""
图片上传 API 路由
"""

import asyncio
import logging
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.middleware.auth import require_role
from ef_core.models.users import User

from ...api.client import OzonAPIClient
from ...models import OzonShop
from ...services.media_import_service import MediaImportService

router = APIRouter(tags=["ozon-listing-media"])
logger = logging.getLogger(__name__)


async def get_ozon_client(shop_id: int, db: AsyncSession) -> OzonAPIClient:
    """获取OZON API客户端"""
    shop = await db.scalar(select(OzonShop).where(OzonShop.id == shop_id))
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return OzonAPIClient(client_id=shop.client_id, api_key=shop.api_key_enc)


@router.post("/listings/products/{offer_id}/images")
async def import_product_images(
    offer_id: str,
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """
    导入商品图片（需要操作员权限）

    从Cloudinary URL导入图片到OZON
    """
    try:
        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        image_urls = request.get("image_urls", [])
        validate_properties = request.get("validate_properties", False)

        if not image_urls:
            raise HTTPException(status_code=400, detail="image_urls is required")

        client = await get_ozon_client(shop_id, db)
        media_service = MediaImportService(client, db)

        result = await media_service.import_images_for_product(
            shop_id=shop_id,
            offer_id=offer_id,
            image_urls=image_urls,
            validate_properties=validate_properties
        )

        return result

    except Exception as e:
        logger.error(f"Import images failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/products/{offer_id}/images/status")
async def get_images_status(
    offer_id: str,
    shop_id: int = Query(..., description="店铺ID"),
    state: Optional[str] = Query(None, description="状态过滤"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取商品图片导入状态
    """
    try:
        client = await get_ozon_client(shop_id, db)
        media_service = MediaImportService(client, db)

        logs = await media_service.get_import_logs(
            shop_id=shop_id,
            offer_id=offer_id,
            state=state
        )

        return {
            "success": True,
            "data": [
                {
                    "id": log.id,
                    "source_url": log.source_url,
                    "file_name": log.file_name,
                    "position": log.position,
                    "state": log.state,
                    "ozon_file_id": log.ozon_file_id,
                    "ozon_url": log.ozon_url,
                    "error_code": log.error_code,
                    "error_message": log.error_message,
                    "retry_count": log.retry_count,
                    "created_at": log.created_at.isoformat() if log.created_at else None
                }
                for log in logs
            ],
            "total": len(logs)
        }

    except Exception as e:
        logger.error(f"Get images status failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/media/upload")
async def upload_media(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """
    上传图片/视频到图床（自动选择当前激活的图床，需要操作员权限）

    支持Base64和URL两种方式上传
    支持图片和视频两种媒体类型
    """
    try:
        from ...services.image_storage_factory import ImageStorageFactory

        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        # 使用图片存储工厂获取当前激活的图床服务
        try:
            service = await ImageStorageFactory.create_from_db(db)
        except ValueError as e:
            return {
                "success": False,
                "error": str(e)
            }

        # 获取上传参数
        upload_type = request.get("type", "base64")  # base64 or url
        media_type = request.get("media_type", "image")  # image or video

        # 根据媒体类型选择文件夹
        if media_type == "video":
            default_folder = getattr(service, 'product_videos_folder', 'videos')
        else:
            default_folder = service.product_images_folder or "products"

        folder = request.get("folder", default_folder)

        if upload_type == "base64":
            # Base64上传
            if media_type == "video":
                # 视频暂不支持Base64上传（文件太大）
                return {
                    "success": False,
                    "error": "视频暂不支持Base64上传，请使用URL方式或稍后支持文件上传"
                }

            base64_data = request.get("data")
            if not base64_data:
                raise HTTPException(status_code=400, detail="data is required for base64 upload")

            public_id = request.get("public_id", str(uuid.uuid4()))
            result = await service.upload_base64_image(
                base64_data=base64_data,
                public_id=public_id,
                folder=folder
            )

        elif upload_type == "url":
            # URL上传
            media_url = request.get("url")
            if not media_url:
                raise HTTPException(status_code=400, detail="url is required for url upload")

            if media_type == "video":
                # 视频URL直接返回（不上传到图床，直接使用外部链接）
                # 验证URL格式
                if not (media_url.startswith("http://") or media_url.startswith("https://")):
                    return {
                        "success": False,
                        "error": "视频URL格式不正确，必须以http://或https://开头"
                    }

                result = {
                    "success": True,
                    "url": media_url,
                    "public_id": None,
                    "source": "external_url"
                }
            else:
                # 图片上传到图床
                public_id = request.get("public_id", str(uuid.uuid4()))
                result = await service.upload_image_from_url(
                    image_url=media_url,
                    public_id=public_id,
                    folder=folder
                )

        else:
            return {
                "success": False,
                "error": f"Unsupported upload type: {upload_type}"
            }

        if result["success"]:
            logger.info(f"Image uploaded to image storage: {result['url']}")

        return result

    except Exception as e:
        logger.error(f"Upload media failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/media/upload-file")
async def upload_media_file(
    file: UploadFile = File(...),
    shop_id: int = Form(...),
    media_type: str = Form("image"),
    folder: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """
    上传文件到图床（支持图片和视频，multipart/form-data方式）

    注意：视频上传较慢，需要经过服务器中转到图床，建议使用URL方式
    """
    try:
        from ...services.image_storage_factory import ImageStorageFactory

        # 验证文件类型
        if media_type == "video":
            # 视频验证
            allowed_video_types = ["video/mp4", "video/quicktime", "video/x-msvideo"]
            if file.content_type not in allowed_video_types:
                return {
                    "success": False,
                    "error": f"不支持的视频格式: {file.content_type}，仅支持 MP4, MOV"
                }

            # 文件大小限制（100MB）
            file_content = await file.read()
            file_size_mb = len(file_content) / 1024 / 1024
            if file_size_mb > 100:
                return {
                    "success": False,
                    "error": f"视频文件过大: {file_size_mb:.1f}MB，最大支持100MB"
                }
        else:
            # 图片验证
            allowed_image_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
            if file.content_type not in allowed_image_types:
                return {
                    "success": False,
                    "error": f"不支持的图片格式: {file.content_type}"
                }

            file_content = await file.read()
            file_size_mb = len(file_content) / 1024 / 1024
            if file_size_mb > 10:
                return {
                    "success": False,
                    "error": f"图片文件过大: {file_size_mb:.1f}MB，最大支持10MB"
                }

        # 获取当前激活的图床服务
        try:
            service = await ImageStorageFactory.create_from_db(db)
        except ValueError as e:
            return {
                "success": False,
                "error": str(e)
            }

        # 确定上传文件夹
        if not folder:
            if media_type == "video":
                folder = getattr(service, 'product_videos_folder', 'videos')
            else:
                folder = service.product_images_folder or "products"

        # 生成文件名
        file_ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
        public_id = f"{uuid.uuid4().hex[:12]}"

        # 上传到图床
        if media_type == "video":
            # 视频上传（暂时存储为文件）
            # TODO: 优化为流式上传，避免内存占用过大
            object_key = f"{folder}/{public_id}.{file_ext}"

            # 直接使用OSS/Cloudinary的put_object上传
            from ...services.aliyun_oss_service import AliyunOssService
            from ...services.cloudinary_service import CloudinaryService

            if isinstance(service, AliyunOssService):
                # 阿里云OSS上传视频
                import alibabacloud_oss_v2 as oss
                from io import BytesIO

                put_request = oss.PutObjectRequest(
                    bucket=service.bucket,
                    key=object_key,
                    body=BytesIO(file_content)
                )

                await asyncio.to_thread(
                    service.client.put_object,
                    put_request
                )

                video_url = f"https://{service.bucket}.{service.endpoint}/{object_key}"

                logger.info(f"Video uploaded to OSS: {object_key}, size: {file_size_mb:.1f}MB")

                return {
                    "success": True,
                    "url": video_url,
                    "public_id": object_key,
                    "size_mb": round(file_size_mb, 2),
                    "source": "aliyun_oss"
                }

            elif isinstance(service, CloudinaryService):
                # Cloudinary上传视频
                import cloudinary.uploader

                result = await asyncio.to_thread(
                    cloudinary.uploader.upload,
                    file_content,
                    public_id=public_id,
                    folder=folder,
                    resource_type="video",
                    chunk_size=6000000  # 6MB分块上传
                )

                logger.info(f"Video uploaded to Cloudinary: {public_id}, size: {file_size_mb:.1f}MB")

                return {
                    "success": True,
                    "url": result["secure_url"],
                    "public_id": result["public_id"],
                    "size_mb": round(file_size_mb, 2),
                    "source": "cloudinary"
                }
            else:
                return {
                    "success": False,
                    "error": "当前图床服务不支持视频上传"
                }
        else:
            # 图片上传（使用现有方法）
            result = await service.upload_image(
                image_data=file_content,
                public_id=public_id,
                folder=folder
            )

            if result.get("success"):
                result["size_mb"] = round(file_size_mb, 2)

            return result

    except Exception as e:
        logger.error(f"Upload file failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }
