"""
图片存储工厂
根据数据库配置选择 Cloudinary 或 阿里云 OSS
"""

from typing import Union, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.utils.logger import get_logger
from ..models.watermark import CloudinaryConfig, AliyunOssConfig
from .cloudinary_service import CloudinaryService
from .aliyun_oss_service import AliyunOssService

logger = get_logger(__name__)


class ImageStorageFactory:
    """图片存储工厂类"""

    @staticmethod
    async def create_from_db(db: AsyncSession) -> Union[CloudinaryService, AliyunOssService]:
        """
        从数据库配置创建图片存储服务实例

        优先级：
        1. 启用且默认的阿里云 OSS
        2. 启用且默认的 Cloudinary
        3. 任何启用的阿里云 OSS
        4. 任何启用的 Cloudinary
        5. 抛出异常（无可用配置）

        Args:
            db: 数据库会话

        Returns:
            CloudinaryService 或 AliyunOssService 实例

        Raises:
            ValueError: 没有找到可用的图片存储配置
        """
        # 1. 查找启用且默认的阿里云 OSS
        stmt = select(AliyunOssConfig).where(
            AliyunOssConfig.enabled == True,
            AliyunOssConfig.is_default == True
        )
        oss_config = await db.scalar(stmt)

        if oss_config:
            logger.info("使用阿里云 OSS 作为默认图片存储")
            return await ImageStorageFactory._create_aliyun_oss_service(oss_config)

        # 2. 查找启用且默认的 Cloudinary
        stmt = select(CloudinaryConfig).where(
            CloudinaryConfig.is_active == True,
            CloudinaryConfig.is_default == True
        )
        cloudinary_config = await db.scalar(stmt)

        if cloudinary_config:
            logger.info("使用 Cloudinary 作为默认图片存储")
            return await ImageStorageFactory._create_cloudinary_service(cloudinary_config)

        # 3. 查找任何启用的阿里云 OSS
        stmt = select(AliyunOssConfig).where(AliyunOssConfig.enabled == True)
        oss_config = await db.scalar(stmt)

        if oss_config:
            logger.info("使用阿里云 OSS 作为图片存储（无默认标记，但已启用）")
            return await ImageStorageFactory._create_aliyun_oss_service(oss_config)

        # 4. 查找任何启用的 Cloudinary
        stmt = select(CloudinaryConfig).where(CloudinaryConfig.is_active == True)
        cloudinary_config = await db.scalar(stmt)

        if cloudinary_config:
            logger.info("使用 Cloudinary 作为图片存储（无默认标记，但已启用）")
            return await ImageStorageFactory._create_cloudinary_service(cloudinary_config)

        # 5. 没有找到任何可用配置
        logger.error("没有找到可用的图片存储配置（Cloudinary 或阿里云 OSS）")
        raise ValueError("没有找到可用的图片存储配置，请先在系统设置中配置 Cloudinary 或阿里云 OSS")

    @staticmethod
    async def _create_aliyun_oss_service(config: AliyunOssConfig) -> AliyunOssService:
        """
        从配置创建阿里云 OSS 服务实例

        Args:
            config: 阿里云 OSS 配置对象

        Returns:
            AliyunOssService 实例
        """
        # TODO: 解密 access_key_secret
        # from ef_core.utils.crypto import decrypt
        # access_key_secret = decrypt(config.access_key_secret_encrypted)

        # 暂时直接使用（生产环境必须解密）
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

        logger.info(f"阿里云 OSS 服务创建成功: bucket={config.bucket_name}, region={config.region_id}")

        return service

    @staticmethod
    async def _create_cloudinary_service(config: CloudinaryConfig) -> CloudinaryService:
        """
        从配置创建 Cloudinary 服务实例

        Args:
            config: Cloudinary 配置对象

        Returns:
            CloudinaryService 实例
        """
        # TODO: 解密 API Secret
        # from ef_core.utils.crypto import decrypt
        # api_secret = decrypt(config.api_secret_encrypted)

        # 暂时直接使用（生产环境必须解密）
        api_secret = config.api_secret_encrypted

        service = CloudinaryService(
            cloud_name=config.cloud_name,
            api_key=config.api_key,
            api_secret=api_secret
        )

        # 设置文件夹属性
        service.product_images_folder = config.product_images_folder or "products"
        service.watermark_images_folder = config.watermark_images_folder or "watermarks"

        logger.info(f"Cloudinary 服务创建成功: cloud_name={config.cloud_name}")

        return service

    @staticmethod
    async def get_active_provider_type(db: AsyncSession) -> Optional[str]:
        """
        获取当前激活的图片存储提供商类型

        Args:
            db: 数据库会话

        Returns:
            "aliyun_oss" 或 "cloudinary" 或 None
        """
        # 检查阿里云 OSS
        stmt = select(AliyunOssConfig).where(
            AliyunOssConfig.enabled == True,
            AliyunOssConfig.is_default == True
        )
        oss_config = await db.scalar(stmt)

        if oss_config:
            return "aliyun_oss"

        # 检查 Cloudinary
        stmt = select(CloudinaryConfig).where(
            CloudinaryConfig.is_active == True,
            CloudinaryConfig.is_default == True
        )
        cloudinary_config = await db.scalar(stmt)

        if cloudinary_config:
            return "cloudinary"

        # 检查任何启用的配置
        stmt = select(AliyunOssConfig).where(AliyunOssConfig.enabled == True)
        oss_config = await db.scalar(stmt)
        if oss_config:
            return "aliyun_oss"

        stmt = select(CloudinaryConfig).where(CloudinaryConfig.is_active == True)
        cloudinary_config = await db.scalar(stmt)
        if cloudinary_config:
            return "cloudinary"

        return None
