"""
Cloudinary集成服务
处理图片上传、删除和资源管理
"""

import cloudinary
import cloudinary.uploader
import cloudinary.api
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import logging
from io import BytesIO
import base64

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.utils.logger import get_logger
from ..models.watermark import CloudinaryConfig
from ..utils.datetime_utils import parse_datetime

logger = get_logger(__name__)


class CloudinaryService:
    """Cloudinary服务类"""

    def __init__(self, cloud_name: str = None, api_key: str = None, api_secret: str = None):
        """
        初始化Cloudinary服务

        Args:
            cloud_name: Cloudinary Cloud Name
            api_key: API Key
            api_secret: API Secret
        """
        if cloud_name and api_key and api_secret:
            self.configure(cloud_name, api_key, api_secret)

    def configure(self, cloud_name: str, api_key: str, api_secret: str):
        """
        配置Cloudinary凭证

        Args:
            cloud_name: Cloudinary Cloud Name
            api_key: API Key
            api_secret: API Secret
        """
        cloudinary.config(
            cloud_name=cloud_name,
            api_key=api_key,
            api_secret=api_secret,
            secure=True
        )
        self.cloud_name = cloud_name
        logger.info(f"Cloudinary configured for cloud: {cloud_name}")

    async def test_connection(self) -> Dict[str, Any]:
        """
        测试Cloudinary连接

        Returns:
            包含连接状态和配额信息的字典
        """
        try:
            # 获取账户使用信息
            usage = cloudinary.api.usage()

            # 获取配额限制
            # 注意：某些账户可能没有这些限制信息
            result = {
                "success": True,
                "cloud_name": self.cloud_name,
                "usage": {
                    "storage_used_bytes": usage.get("storage", {}).get("usage", 0),
                    "bandwidth_used_bytes": usage.get("bandwidth", {}).get("usage", 0),
                    "transformations_used": usage.get("transformations", {}).get("usage", 0),
                },
                "limits": {
                    "storage_limit_bytes": usage.get("storage", {}).get("limit"),
                    "bandwidth_limit_bytes": usage.get("bandwidth", {}).get("limit"),
                    "transformations_limit": usage.get("transformations", {}).get("limit"),
                },
                "quota_usage_percent": self._calculate_quota_usage(usage),
                "tested_at": datetime.utcnow().isoformat()
            }

            logger.info(f"Cloudinary connection test successful: {result}")
            return result

        except Exception as e:
            logger.error(f"Cloudinary connection test failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "tested_at": datetime.utcnow().isoformat()
            }

    def _calculate_quota_usage(self, usage: Dict) -> Optional[float]:
        """计算配额使用百分比"""
        try:
            storage_usage = usage.get("storage", {})
            if storage_usage.get("limit") and storage_usage.get("usage"):
                return (storage_usage["usage"] / storage_usage["limit"]) * 100
            return None
        except:
            return None

    async def upload_image(
        self,
        image_data: bytes,
        public_id: str,
        folder: str = "watermarked",
        tags: List[str] = None,
        metadata: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        上传图片到Cloudinary

        Args:
            image_data: 图片二进制数据
            public_id: 公开ID（唯一标识符）
            folder: 文件夹路径
            tags: 标签列表
            metadata: 元数据

        Returns:
            包含上传结果的字典
        """
        try:
            # 准备上传参数
            upload_params = {
                "public_id": f"{folder}/{public_id}",
                "resource_type": "image",
                "format": "jpg",
                "quality": "auto:good",
                "fetch_format": "auto",
                "flags": "lossy",
            }

            if tags:
                upload_params["tags"] = tags

            if metadata:
                upload_params["context"] = metadata

            # 上传图片
            result = cloudinary.uploader.upload(
                BytesIO(image_data),
                **upload_params
            )

            logger.info(f"Image uploaded successfully: {result['public_id']}")

            return {
                "success": True,
                "public_id": result["public_id"],
                "url": result["secure_url"],
                "width": result.get("width"),
                "height": result.get("height"),
                "bytes": result.get("bytes"),
                "format": result.get("format"),
                "created_at": result.get("created_at")
            }

        except Exception as e:
            logger.error(f"Failed to upload image: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def upload_base64_image(
        self,
        base64_data: str,
        public_id: str,
        folder: str = "watermarked"
    ) -> Dict[str, Any]:
        """
        上传Base64编码的图片

        Args:
            base64_data: Base64编码的图片数据
            public_id: 公开ID
            folder: 文件夹路径

        Returns:
            包含上传结果的字典
        """
        try:
            # 解码Base64数据
            if base64_data.startswith("data:image"):
                # 移除data URL前缀
                base64_data = base64_data.split(",")[1]

            image_data = base64.b64decode(base64_data)
            return await self.upload_image(image_data, public_id, folder)

        except Exception as e:
            logger.error(f"Failed to upload base64 image: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def upload_image_from_url(
        self,
        image_url: str,
        public_id: str,
        folder: str = "watermarked",
        transformations: List[Dict] = None
    ) -> Dict[str, Any]:
        """
        从URL上传图片到Cloudinary（支持转换）

        Args:
            image_url: 图片URL
            public_id: 公开ID
            folder: 文件夹路径
            transformations: Cloudinary转换参数列表

        Returns:
            包含上传结果的字典
        """
        try:
            # 准备上传参数
            upload_params = {
                "public_id": f"{folder}/{public_id}",
                "resource_type": "image",
                "format": "jpg",
                "quality": "auto:good",
                "fetch_format": "auto",
            }

            # 添加转换参数
            if transformations:
                upload_params["transformation"] = transformations

            # 从URL上传
            result = cloudinary.uploader.upload(
                image_url,
                **upload_params
            )

            logger.info(f"Image uploaded from URL successfully: {result['public_id']}")

            return {
                "success": True,
                "public_id": result["public_id"],
                "url": result["secure_url"],
                "width": result.get("width"),
                "height": result.get("height"),
                "bytes": result.get("bytes"),
                "format": result.get("format")
            }

        except Exception as e:
            logger.error(f"Failed to upload image from URL: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def delete_resource(self, public_id: str) -> Dict[str, Any]:
        """
        删除单个资源

        Args:
            public_id: 资源的public_id

        Returns:
            删除结果
        """
        try:
            result = cloudinary.uploader.destroy(public_id)
            logger.info(f"Resource deleted: {public_id}, result: {result}")

            return {
                "success": result.get("result") == "ok",
                "public_id": public_id,
                "result": result
            }

        except Exception as e:
            logger.error(f"Failed to delete resource {public_id}: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def delete_resources(self, public_ids: List[str]) -> Dict[str, Any]:
        """
        批量删除资源

        Args:
            public_ids: 资源public_id列表

        Returns:
            删除结果
        """
        try:
            if not public_ids:
                return {"success": True, "deleted": []}

            # Cloudinary API限制每次最多100个
            batch_size = 100
            all_results = []

            for i in range(0, len(public_ids), batch_size):
                batch = public_ids[i:i + batch_size]
                result = cloudinary.api.delete_resources(batch)
                all_results.append(result)

            # 合并结果
            deleted = []
            not_found = []

            for result in all_results:
                deleted.extend(result.get("deleted", {}).keys())
                not_found.extend(result.get("not_found", []))

            logger.info(f"Batch delete completed: {len(deleted)} deleted, {len(not_found)} not found")

            return {
                "success": True,
                "deleted": deleted,
                "not_found": not_found,
                "total_requested": len(public_ids)
            }

        except Exception as e:
            logger.error(f"Failed to batch delete resources: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def delete_folder(self, folder_path: str) -> Dict[str, Any]:
        """
        删除整个文件夹

        Args:
            folder_path: 文件夹路径

        Returns:
            删除结果
        """
        try:
            result = cloudinary.api.delete_folder(folder_path)
            logger.info(f"Folder deleted: {folder_path}")

            return {
                "success": True,
                "folder": folder_path,
                "result": result
            }

        except Exception as e:
            logger.error(f"Failed to delete folder {folder_path}: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def list_resources(
        self,
        folder: Optional[str] = None,
        max_results: int = 100,
        tags: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        列出资源

        Args:
            folder: 文件夹路径
            max_results: 最大结果数
            tags: 标签筛选

        Returns:
            资源列表
        """
        try:
            params = {
                "max_results": max_results,
                "resource_type": "image"
            }

            if folder:
                params["prefix"] = folder

            if tags:
                params["tags"] = tags

            result = cloudinary.api.resources(**params)

            resources = []
            for resource in result.get("resources", []):
                resources.append({
                    "public_id": resource["public_id"],
                    "url": resource["secure_url"],
                    "format": resource.get("format"),
                    "bytes": resource.get("bytes"),
                    "width": resource.get("width"),
                    "height": resource.get("height"),
                    "created_at": resource.get("created_at"),
                })

            return {
                "success": True,
                "resources": resources,
                "total": len(resources),
                "next_cursor": result.get("next_cursor")
            }

        except Exception as e:
            logger.error(f"Failed to list resources: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def cleanup_old_resources(
        self,
        folder: str,
        days_old: int = 30,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """
        清理过期资源

        Args:
            folder: 文件夹路径
            days_old: 超过多少天的资源
            dry_run: 是否仅模拟运行

        Returns:
            清理结果
        """
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days_old)

            # 列出文件夹中的所有资源
            list_result = await self.list_resources(folder=folder, max_results=500)

            if not list_result["success"]:
                return list_result

            # 筛选过期资源
            old_resources = []
            for resource in list_result["resources"]:
                created_at = parse_datetime(resource["created_at"])
                if created_at and created_at < cutoff_date:
                    old_resources.append(resource["public_id"])

            if not old_resources:
                return {
                    "success": True,
                    "message": "No old resources found",
                    "count": 0
                }

            # 执行删除
            if dry_run:
                logger.info(f"Dry run: Would delete {len(old_resources)} resources")
                return {
                    "success": True,
                    "dry_run": True,
                    "would_delete": old_resources,
                    "count": len(old_resources)
                }
            else:
                delete_result = await self.delete_resources(old_resources)
                return {
                    "success": delete_result["success"],
                    "deleted": delete_result.get("deleted", []),
                    "count": len(delete_result.get("deleted", [])),
                    "cutoff_date": cutoff_date.isoformat()
                }

        except Exception as e:
            logger.error(f"Failed to cleanup old resources: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def get_resource_info(self, public_id: str) -> Dict[str, Any]:
        """
        获取资源详细信息

        Args:
            public_id: 资源public_id

        Returns:
            资源信息
        """
        try:
            result = cloudinary.api.resource(public_id)

            return {
                "success": True,
                "public_id": result["public_id"],
                "url": result["secure_url"],
                "format": result.get("format"),
                "bytes": result.get("bytes"),
                "width": result.get("width"),
                "height": result.get("height"),
                "created_at": result.get("created_at"),
                "tags": result.get("tags", []),
                "context": result.get("context", {})
            }

        except Exception as e:
            logger.error(f"Failed to get resource info for {public_id}: {e}")
            return {
                "success": False,
                "error": str(e)
            }


class CloudinaryConfigManager:
    """Cloudinary配置管理器"""

    @staticmethod
    async def get_config(db: AsyncSession) -> Optional[CloudinaryConfig]:
        """
        获取全局Cloudinary配置

        Args:
            db: 数据库会话

        Returns:
            Cloudinary配置对象
        """
        result = await db.execute(
            select(CloudinaryConfig)
            .where(CloudinaryConfig.is_active == True)
            .limit(1)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def create_service_from_config(
        config: CloudinaryConfig
    ) -> Optional[CloudinaryService]:
        """
        从配置创建Cloudinary服务实例

        Args:
            config: Cloudinary配置对象

        Returns:
            CloudinaryService实例
        """
        if not config:
            return None

        # TODO: 解密API Secret
        # from ef_core.utils.crypto import decrypt
        # api_secret = decrypt(config.api_secret_encrypted)

        # 暂时直接使用（生产环境必须解密）
        api_secret = config.api_secret_encrypted

        service = CloudinaryService(
            cloud_name=config.cloud_name,
            api_key=config.api_key,
            api_secret=api_secret
        )

        # 设置folder_prefix属性
        service.folder_prefix = config.folder_prefix if config.folder_prefix else "euraflow"

        return service

    @staticmethod
    async def update_usage_stats(
        config: CloudinaryConfig,
        service: CloudinaryService,
        db: AsyncSession
    ) -> None:
        """
        更新配额使用统计

        Args:
            config: Cloudinary配置对象
            service: CloudinaryService实例
            db: 数据库会话
        """
        try:
            test_result = await service.test_connection()

            if test_result["success"]:
                config.storage_used_bytes = test_result["usage"]["storage_used_bytes"]
                config.bandwidth_used_bytes = test_result["usage"]["bandwidth_used_bytes"]
                config.last_quota_check = datetime.utcnow()
                config.last_test_at = datetime.utcnow()
                config.last_test_success = True

                await db.commit()
                logger.info(f"Updated usage stats for shop {config.shop_id}")

        except Exception as e:
            logger.error(f"Failed to update usage stats: {e}")