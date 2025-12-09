"""
图床资源管理 API 路由
"""

import logging
import random
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.middleware.auth import require_role
from ef_core.models.users import User
from ef_core.services.audit_service import AuditService

from ...services.cloudinary_service import CloudinaryConfigManager
from ...services.image_storage_factory import ImageStorageFactory

router = APIRouter(tags=["watermark-resources"])
logger = logging.getLogger(__name__)


@router.delete("/cleanup")
async def cleanup_old_resources(
    shop_id: Optional[int] = Query(None),
    days: int = Query(30, ge=1),
    dry_run: bool = Query(False),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
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
            folder_tree: Dict[str, Dict[str, Any]] = {}

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
    current_user: User = Depends(require_role("sub_account"))
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
    current_user: User = Depends(require_role("sub_account"))
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


@router.post("/upload-base64-image", summary="上传Base64编码的图片到图床")
async def upload_base64_image(
    request_body: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
) -> Dict[str, Any]:
    """
    上传Base64编码的图片到当前激活的图床

    Args:
        request_body: {
            "shop_id": int,
            "image_base64": str  # data:image/jpeg;base64,/9j/4AAQ... 或纯Base64
        }

    Returns:
        {
            "success": true,
            "url": str  # 图床URL
        }
    """
    try:
        shop_id = request_body.get("shop_id")
        image_base64 = request_body.get("image_base64")

        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        if not image_base64:
            raise HTTPException(status_code=400, detail="image_base64 is required")

        logger.info(f"开始上传Base64图片到图床，shop_id={shop_id}")

        # 获取当前激活的图床服务
        try:
            service = await ImageStorageFactory.create_from_db(db)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # 生成唯一的public_id
        public_id = f"resized_{int(time.time())}_{random.randint(1000, 9999)}"

        # 上传Base64图片到图床
        result = await service.upload_base64_image(
            base64_data=image_base64,
            public_id=public_id,
            folder="products"
        )

        if result.get("success"):
            logger.info(f"成功上传Base64图片: {public_id} -> {result.get('url')}")
            return {
                "success": True,
                "url": result.get("url")
            }
        else:
            logger.error(f"上传Base64图片失败: {result.get('error')}")
            raise HTTPException(status_code=500, detail=result.get("error", "Upload failed"))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload base64 image: {e}")
        raise HTTPException(status_code=500, detail=str(e))
