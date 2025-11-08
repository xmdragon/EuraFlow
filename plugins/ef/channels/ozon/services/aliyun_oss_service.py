"""
阿里云OSS集成服务
处理图片上传、删除和资源管理
"""

import alibabacloud_oss_v2 as oss
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging
from io import BytesIO
import base64
import httpx
from urllib.parse import urljoin

from ef_core.utils.logger import get_logger

logger = get_logger(__name__)


class AliyunOssService:
    """阿里云OSS服务类"""

    def __init__(
        self,
        access_key_id: str = None,
        access_key_secret: str = None,
        bucket: str = None,
        endpoint: str = None,
        region: str = None
    ):
        """
        初始化阿里云OSS服务

        Args:
            access_key_id: 阿里云AccessKey ID
            access_key_secret: 阿里云AccessKey Secret
            bucket: OSS Bucket名称
            endpoint: OSS Endpoint地址
            region: 区域ID
        """
        self.bucket = bucket
        self.endpoint = endpoint
        self.region = region
        self.access_key_id = access_key_id
        self.access_key_secret = access_key_secret

        # 设置文件夹路径（与 Cloudinary 保持一致）
        self.product_images_folder = "products"
        self.watermark_images_folder = "watermarks"

        # 初始化OSS客户端
        if access_key_id and access_key_secret and bucket and region:
            self.configure(access_key_id, access_key_secret, bucket, endpoint, region)

    def configure(
        self,
        access_key_id: str,
        access_key_secret: str,
        bucket: str,
        endpoint: str,
        region: str
    ):
        """
        配置阿里云OSS凭证

        Args:
            access_key_id: AccessKey ID
            access_key_secret: AccessKey Secret
            bucket: Bucket名称
            endpoint: Endpoint地址
            region: 区域ID
        """
        try:
            # 创建配置
            cfg = oss.config.load_default()

            # 创建凭证提供者（直接传入 access_key_id 和 access_key_secret）
            cfg.credentials_provider = oss.credentials.StaticCredentialsProvider(
                access_key_id,
                access_key_secret
            )
            cfg.region = region

            # 设置自定义 endpoint（参考官方示例）
            if endpoint:
                cfg.endpoint = endpoint

            # 创建客户端
            self.client = oss.Client(cfg)
            self.bucket = bucket
            self.endpoint = endpoint
            self.region = region
            self.access_key_id = access_key_id
            self.access_key_secret = access_key_secret

            logger.info(f"阿里云OSS configured for bucket: {bucket}, region: {region}")

        except Exception as e:
            logger.error(f"Failed to configure Aliyun OSS: {e}")
            raise

    async def test_connection(self) -> Dict[str, Any]:
        """
        测试阿里云OSS连接

        Returns:
            包含连接状态和用量统计的字典
        """
        try:
            # 获取Bucket信息（验证连接和权限）
            result = self.client.get_bucket_info(oss.GetBucketInfoRequest(
                bucket=self.bucket
            ))

            # 获取用量统计
            usage_stats = await self.get_usage_stats()

            # 连接成功
            return {
                "success": True,
                "bucket": self.bucket,
                "region": self.region,
                "tested_at": datetime.utcnow().isoformat(),
                "usage": usage_stats.get("usage") if usage_stats.get("success") else None
            }

        except Exception as e:
            logger.error(f"Aliyun OSS connection test failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "tested_at": datetime.utcnow().isoformat()
            }

    async def get_usage_stats(self) -> Dict[str, Any]:
        """
        获取OSS Bucket用量统计（存储量、对象数量等）

        Returns:
            包含用量统计的字典，格式兼容Cloudinary
        """
        try:
            # 调用GetBucketStat API获取统计信息
            stat_result = self.client.get_bucket_stat(oss.GetBucketStatRequest(
                bucket=self.bucket
            ))

            # 解析返回结果
            storage_bytes = stat_result.storage_size if hasattr(stat_result, 'storage_size') else 0
            object_count = stat_result.object_count if hasattr(stat_result, 'object_count') else 0

            logger.info(f"OSS Bucket stats: storage={storage_bytes} bytes, objects={object_count}")

            # 格式化为与Cloudinary兼容的格式
            return {
                "success": True,
                "usage": {
                    "storage_used_bytes": storage_bytes,
                    "object_count": object_count,
                    "bandwidth_used_bytes": None,  # OSS不直接提供，需云监控API
                    "transformations_used": None,
                    "storage_limit_bytes": None,  # OSS按量计费，无硬性限制
                    "bandwidth_limit_bytes": None,
                    "transformations_limit": None,
                },
                "quota_usage_percent": None  # 无配额限制，返回None
            }

        except Exception as e:
            logger.error(f"Failed to get OSS bucket stats: {e}")
            return {
                "success": False,
                "error": str(e),
                "usage": {
                    "storage_used_bytes": 0,
                    "object_count": 0,
                    "bandwidth_used_bytes": None,
                    "transformations_used": None,
                    "storage_limit_bytes": None,
                    "bandwidth_limit_bytes": None,
                    "transformations_limit": None,
                }
            }

    def _upload_image_sync(
        self,
        image_data: bytes,
        public_id: str,
        folder: str,
        metadata: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        同步上传图片到OSS（内部方法）
        """
        # 构建对象键（类似 Cloudinary 的 public_id）
        object_key = f"{folder}/{public_id}.jpg"

        # 准备上传请求
        put_request = oss.PutObjectRequest(
            bucket=self.bucket,
            key=object_key,
            body=BytesIO(image_data)
        )

        # 设置元数据
        if metadata:
            put_request.metadata = metadata

        # 上传文件
        result = self.client.put_object(put_request)

        # 构建访问URL
        image_url = f"https://{self.bucket}.{self.endpoint}/{object_key}"

        logger.info(f"Image uploaded successfully to OSS: {object_key}, url: {image_url}")

        return {
            "success": True,
            "public_id": object_key,
            "url": image_url,
            "etag": result.etag,
            "created_at": datetime.utcnow().isoformat()
        }

    async def upload_image(
        self,
        image_data: bytes,
        public_id: str,
        folder: str = "products",
        tags: List[str] = None,
        metadata: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        上传图片到阿里云OSS

        Args:
            image_data: 图片二进制数据
            public_id: 公开ID（唯一标识符）
            folder: 文件夹路径
            tags: 标签列表（OSS使用对象标签）
            metadata: 元数据

        Returns:
            包含上传结果的字典
        """
        try:
            # 在线程池中执行同步的 OSS SDK 调用
            import asyncio
            result = await asyncio.to_thread(
                self._upload_image_sync,
                image_data,
                public_id,
                folder,
                metadata
            )
            return result

        except Exception as e:
            logger.error(f"Failed to upload image to OSS: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def upload_base64_image(
        self,
        base64_data: str,
        public_id: str,
        folder: str = "products"
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
            logger.error(f"Failed to upload base64 image to OSS: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def upload_image_from_url(
        self,
        image_url: str,
        public_id: str,
        folder: str = "products",
        transformations: List[Dict] = None
    ) -> Dict[str, Any]:
        """
        从URL下载图片并上传到阿里云OSS

        注意：阿里云OSS不支持Cloudinary那样的服务端转换
        transformations参数保留是为了接口兼容，但不会被使用

        Args:
            image_url: 图片URL
            public_id: 公开ID
            folder: 文件夹路径
            transformations: 转换参数（不使用，仅为接口兼容）

        Returns:
            包含上传结果的字典
        """
        try:
            # 下载图片
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(image_url)
                response.raise_for_status()
                image_data = response.content

            # 上传到OSS
            return await self.upload_image(image_data, public_id, folder)

        except Exception as e:
            logger.error(f"Failed to upload image from URL to OSS: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def delete_resource(self, public_id: str) -> Dict[str, Any]:
        """
        删除单个资源

        Args:
            public_id: 资源的object key

        Returns:
            删除结果
        """
        try:
            self.client.delete_object(oss.DeleteObjectRequest(
                bucket=self.bucket,
                key=public_id
            ))

            logger.info(f"OSS resource deleted: {public_id}")

            return {
                "success": True,
                "public_id": public_id
            }

        except Exception as e:
            logger.error(f"Failed to delete OSS resource {public_id}: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def delete_resources(self, public_ids: List[str]) -> Dict[str, Any]:
        """
        批量删除资源

        Args:
            public_ids: 资源object key列表

        Returns:
            批量删除结果
        """
        try:
            # OSS批量删除
            delete_request = oss.DeleteMultipleObjectsRequest(
                bucket=self.bucket,
                objects=[oss.DeleteObject(key=key) for key in public_ids]
            )

            result = self.client.delete_multiple_objects(delete_request)

            logger.info(f"Batch deleted {len(public_ids)} OSS resources")

            return {
                "success": True,
                "deleted_count": len(result.deleted_objects) if result.deleted_objects else len(public_ids)
            }

        except Exception as e:
            logger.error(f"Failed to batch delete OSS resources: {e}")
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
        列出资源（与Cloudinary接口兼容）

        Args:
            folder: 文件夹路径
            max_results: 最大返回数量
            tags: 标签筛选（OSS不支持，保留参数仅为接口兼容）

        Returns:
            资源列表
        """
        # 默认 folder
        if folder is None:
            folder = "products"

        try:
            # 构建前缀
            list_prefix = f"{folder}/" if folder else ""

            # 列出对象
            result = self.client.list_objects_v2(oss.ListObjectsV2Request(
                bucket=self.bucket,
                prefix=list_prefix,
                max_keys=max_results
            ))

            resources = []
            if result.contents:
                for obj in result.contents:
                    # 过滤掉目录占位符（0 字节且以 / 结尾）
                    if obj.size == 0 and obj.key.endswith('/'):
                        continue

                    resources.append({
                        "public_id": obj.key,
                        "url": f"https://{self.bucket}.{self.endpoint}/{obj.key}",
                        "bytes": obj.size,
                        "created_at": obj.last_modified.isoformat() if obj.last_modified else None
                    })

            logger.info(f"Listed {len(resources)} resources from OSS folder: {folder}")

            return {
                "success": True,
                "resources": resources,
                "total": len(resources)
            }

        except Exception as e:
            logger.error(f"Failed to list OSS resources: {e}")
            return {
                "success": False,
                "error": str(e),
                "resources": []
            }

    async def list_images(
        self,
        folder: str = "products",
        prefix: str = "",
        max_results: int = 100
    ) -> Dict[str, Any]:
        """
        列出指定文件夹下的图片（兼容旧接口）

        Args:
            folder: 文件夹路径
            prefix: 文件名前缀
            max_results: 最大返回数量

        Returns:
            图片列表
        """
        try:
            # 构建前缀
            list_prefix = f"{folder}/{prefix}" if prefix else f"{folder}/"

            # 列出对象
            result = self.client.list_objects_v2(oss.ListObjectsV2Request(
                bucket=self.bucket,
                prefix=list_prefix,
                max_keys=max_results
            ))

            resources = []
            if result.contents:
                for obj in result.contents:
                    # 过滤掉目录占位符（0 字节且以 / 结尾）
                    if obj.size == 0 and obj.key.endswith('/'):
                        continue

                    resources.append({
                        "public_id": obj.key,
                        "url": f"https://{self.bucket}.{self.endpoint}/{obj.key}",
                        "bytes": obj.size,
                        "created_at": obj.last_modified.isoformat() if obj.last_modified else None
                    })

            logger.info(f"Listed {len(resources)} resources from OSS folder: {folder}")

            return {
                "success": True,
                "resources": resources,
                "total": len(resources)
            }

        except Exception as e:
            logger.error(f"Failed to list OSS resources: {e}")
            return {
                "success": False,
                "error": str(e),
                "resources": []
            }


class AliyunOssConfigManager:
    """阿里云OSS配置管理器"""

    @staticmethod
    async def get_config(db):
        """获取阿里云OSS配置"""
        from sqlalchemy import select
        from ..models.watermark import AliyunOssConfig

        stmt = select(AliyunOssConfig).where(AliyunOssConfig.id == 1)
        config = await db.scalar(stmt)
        return config

    @staticmethod
    async def create_service_from_config(config) -> AliyunOssService:
        """从配置创建服务实例"""
        if not config:
            raise ValueError("AliyunOssConfig not found")

        # TODO: 解密 access_key_secret_encrypted
        access_key_secret = config.access_key_secret_encrypted

        service = AliyunOssService(
            access_key_id=config.access_key_id,
            access_key_secret=access_key_secret,
            bucket=config.bucket_name,
            endpoint=config.endpoint,
            region=config.region_id
        )

        # 设置文件夹路径
        service.product_images_folder = config.product_images_folder
        service.watermark_images_folder = config.watermark_images_folder

        return service
