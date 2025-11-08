"""
水印处理服务
同时支持同步和异步处理模式
"""
import asyncio
import logging
import base64
from datetime import datetime
from typing import Dict, List, Optional, Any
from uuid import uuid4
from urllib.parse import quote

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import OzonProduct, WatermarkConfig, WatermarkTask, OzonShop
from .image_storage_factory import ImageStorageFactory
from .ozon_api_service import OzonApiService
from .image_processing_service import ImageProcessingService, WatermarkPosition
from .cloudinary_service import CloudinaryService
from .aliyun_oss_service import AliyunOssService
from ..utils.datetime_utils import utcnow

logger = logging.getLogger(__name__)


class WatermarkProcessor:
    """水印处理器"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.storage_service = None  # 统一的存储服务接口（Cloudinary 或 阿里云 OSS）
        self.ozon_api: Optional[OzonApiService] = None
        self.image_service = ImageProcessingService()  # 初始化图片处理服务

    async def _init_services(self, shop_id: int):
        """初始化服务"""
        # 初始化图片存储服务（自动选择 Cloudinary 或阿里云 OSS）
        if not self.storage_service:
            self.storage_service = await ImageStorageFactory.create_from_db(self.db)

        # 初始化OZON API服务
        if not self.ozon_api:
            shop_result = await self.db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop = shop_result.scalar_one_or_none()
            if not shop:
                raise ValueError(f"Shop {shop_id} not found")

            self.ozon_api = OzonApiService(
                client_id=shop.client_id,
                api_key=shop.api_key_enc
            )

    async def process_single_product(
        self,
        product_id: int,
        shop_id: int,
        watermark_config_id: int,
        task_id: Optional[str] = None,
        analyze_mode: str = "individual",  # 'individual' or 'fast'
        position_overrides: Optional[Dict[str, Any]] = None  # 手动选择的位置和水印 {image_index: {watermark_config_id, position}}
    ) -> Dict[str, Any]:
        """
        处理单个商品的水印

        Returns:
            处理结果字典，包含处理后的图片URL等信息
        """
        try:
            # 初始化服务
            await self._init_services(shop_id)

            # 获取商品信息
            result = await self.db.execute(
                select(OzonProduct).where(
                    and_(
                        OzonProduct.id == product_id,
                        OzonProduct.shop_id == shop_id
                    )
                )
            )
            product = result.scalar_one_or_none()
            if not product:
                raise ValueError(f"Product {product_id} not found")

            # 获取水印配置
            watermark_config = await self.db.get(WatermarkConfig, watermark_config_id)
            if not watermark_config:
                raise ValueError(f"Watermark config {watermark_config_id} not found")

            # 收集所有图片URL
            original_images = []
            if product.images:
                # 主图
                if product.images.get("primary"):
                    original_images.append(product.images["primary"])
                # 附加图片
                if product.images.get("additional"):
                    original_images.extend(product.images["additional"])

            if not original_images:
                logger.warning(f"Product {product_id} has no images")
                return {
                    "success": False,
                    "message": "Product has no images",
                    "images": []
                }

            # 下载水印图片一次，供所有图片分析使用
            watermark_image = None
            if original_images and analyze_mode == "individual":
                try:
                    watermark_image = await self.image_service.download_image(watermark_config.image_url)
                except Exception as e:
                    logger.error(f"Failed to download watermark image: {e}")

            # 快速模式：分析第一张图片，应用到所有图片
            fast_mode_position = None
            fast_mode_color = None
            if analyze_mode == "fast" and original_images:
                try:
                    watermark_image = await self.image_service.download_image(watermark_config.image_url)
                    first_image = await self.image_service.download_image(original_images[0])
                    best_position_enum, best_color = await self.image_service.find_best_watermark_position(
                        first_image,
                        watermark_image,
                        [{"color_type": watermark_config.color_type}],
                        watermark_config.positions
                    )
                    fast_mode_position = best_position_enum.value
                    fast_mode_color = best_color.value
                    logger.info(f"Fast mode: Using position {fast_mode_position} with color {fast_mode_color} for all images")
                except Exception as e:
                    logger.warning(f"Failed to analyze first image in fast mode: {e}, using defaults")

            # 处理每张图片
            processed_images = []
            cloudinary_public_ids = []
            position_metadata = []  # 记录每张图片使用的位置

            for idx, image_url in enumerate(original_images):
                try:
                    # 决定使用的位置和水印配置
                    best_position = None
                    image_watermark_config = watermark_config  # 默认使用传入的水印配置

                    # 优先使用手动选择的位置和水印
                    if position_overrides and str(idx) in position_overrides:
                        override_data = position_overrides[str(idx)]

                        # 如果override_data是字符串，兼容旧格式（只有位置）
                        if isinstance(override_data, str):
                            best_position = override_data
                        # 如果是字典，支持新格式（水印ID和位置）
                        elif isinstance(override_data, dict):
                            best_position = override_data.get('position')

                            # 如果指定了不同的水印配置，加载它
                            custom_watermark_id = override_data.get('watermark_config_id')
                            if custom_watermark_id and custom_watermark_id != watermark_config_id:
                                custom_config = await self.db.get(WatermarkConfig, custom_watermark_id)
                                if custom_config:
                                    image_watermark_config = custom_config
                                    logger.info(f"Image {idx+1}: using custom watermark config {custom_watermark_id}")

                        position_metadata.append({
                            "image_index": idx,
                            "position": best_position,
                            "watermark_config_id": image_watermark_config.id,
                            "mode": "manual"
                        })
                        logger.info(f"Image {idx+1}: using manually selected position: {best_position}")
                    elif analyze_mode == "fast":
                        # 快速模式：使用第一张图片的分析结果
                        best_position = fast_mode_position
                        position_metadata.append({
                            "image_index": idx,
                            "position": best_position or "default",
                            "color": fast_mode_color or watermark_config.color_type,
                            "mode": "fast"
                        })
                        if best_position:
                            logger.info(f"Image {idx+1}: using fast mode position: {best_position}")

                    elif analyze_mode == "individual" and watermark_image:
                        # 精准模式：为每张图片单独分析最佳位置
                        try:
                            logger.info(f"Analyzing image {idx+1}/{len(original_images)} for best watermark position...")

                            # 下载当前图片进行分析
                            current_image = await self.image_service.download_image(image_url)

                            # 智能选择最佳位置
                            best_position_enum, best_color = await self.image_service.find_best_watermark_position(
                                current_image,
                                watermark_image,
                                [{"color_type": watermark_config.color_type}],
                                watermark_config.positions  # 使用配置的所有允许位置
                            )

                            best_position = best_position_enum.value
                            position_metadata.append({
                                "image_index": idx,
                                "position": best_position,
                                "color": best_color.value,
                                "mode": "individual"
                            })
                            logger.info(f"Image {idx+1}: selected position: {best_position} with color: {best_color.value}")

                        except Exception as e:
                            logger.warning(f"Failed to analyze image {idx+1} for best position: {e}, using default")
                            best_position = None
                            position_metadata.append({
                                "image_index": idx,
                                "position": "default",
                                "error": str(e),
                                "mode": "individual"
                            })

                    # 生成唯一ID
                    unique_id = f"{product.offer_id}_{uuid4().hex[:8]}_{idx}"
                    folder = f"{self.storage_service.product_images_folder}/{shop_id}"

                    # 根据存储类型选择不同的处理方式
                    if isinstance(self.storage_service, CloudinaryService):
                        # Cloudinary: 使用transformation上传
                        transformation = self._build_watermark_transformation(
                            image_watermark_config,
                            position=best_position
                        )

                        result = await self.storage_service.upload_image_from_url(
                            image_url,
                            public_id=unique_id,
                            folder=folder,
                            transformations=transformation
                        )

                        if result["success"]:
                            processed_images.append(result["url"])
                            cloudinary_public_ids.append(result["public_id"])
                            logger.info(f"Processed image {idx+1}/{len(original_images)} with Cloudinary transformation")
                        else:
                            logger.error(f"Failed to process image {idx+1}: {result.get('error')}")
                            processed_images.append(image_url)

                    elif isinstance(self.storage_service, AliyunOssService):
                        # 阿里云OSS: 先上传原图，然后生成带水印的URL
                        result = await self.storage_service.upload_image_from_url(
                            image_url,
                            public_id=unique_id,
                            folder=folder
                        )

                        if result["success"]:
                            # 生成带水印的URL（使用x-oss-process参数）
                            base_url = result["url"]
                            watermarked_url = await self._build_aliyun_oss_watermark_url(
                                base_url,
                                image_watermark_config,
                                position=best_position
                            )
                            processed_images.append(watermarked_url)
                            cloudinary_public_ids.append(result["public_id"])
                            logger.info(f"Processed image {idx+1}/{len(original_images)} with Aliyun OSS watermark URL")
                        else:
                            logger.error(f"Failed to process image {idx+1}: {result.get('error')}")
                            processed_images.append(image_url)

                    else:
                        # 未知存储类型，使用原图
                        logger.warning(f"Unknown storage service type: {type(self.storage_service)}")
                        processed_images.append(image_url)

                except Exception as e:
                    logger.error(f"Error processing image {idx+1} for product {product_id}: {e}")
                    processed_images.append(image_url)  # 使用原图

            # 更新OZON商品图片
            update_result = await self._update_ozon_product_images(
                product,
                processed_images,
                original_images
            )

            # 如果有任务ID，更新任务状态
            if task_id:
                await self._update_task_status(
                    task_id,
                    "completed",
                    original_images=original_images,
                    processed_images=processed_images,
                    cloudinary_public_ids=cloudinary_public_ids
                )

            return {
                "success": True,
                "product_id": product_id,
                "offer_id": product.offer_id,
                "original_images": original_images,
                "processed_images": processed_images,
                "cloudinary_ids": cloudinary_public_ids,
                "position_metadata": position_metadata,  # 每张图片的位置信息
                "ozon_update": update_result
            }

        except Exception as e:
            logger.error(f"Failed to process product {product_id}: {e}")

            # 更新任务状态为失败
            if task_id:
                await self._update_task_status(
                    task_id,
                    "failed",
                    error_message=str(e)
                )

            raise

    def _build_watermark_transformation(
        self,
        config: WatermarkConfig,
        position: Optional[str] = None
    ) -> List[Dict]:
        """
        构建Cloudinary水印转换参数

        Args:
            config: 水印配置
            position: 指定的水印位置（来自智能分析），如果为None则使用默认
        """
        # Cloudinary transformation格式
        # 参考: https://cloudinary.com/documentation/image_transformations#overlay_images

        # 使用智能分析的位置，或者使用配置的第一个位置作为默认
        if position is None:
            position = config.positions[0] if config.positions else "bottom_right"
            logger.info(f"Using default position: {position}")
        else:
            logger.info(f"Using intelligent position: {position}")

        transformation = [{
            "overlay": config.cloudinary_public_id.replace("/", ":"),  # 使用已上传的水印图片
            "opacity": int(float(config.opacity) * 100),  # 转换为0-100的整数
            "width": float(config.scale_ratio),  # 相对于主图的比例
            "flags": "relative",  # 使用相对尺寸
            "gravity": self._map_position_to_gravity(position),
            "x": config.margin_pixels,
            "y": config.margin_pixels
        }]

        return transformation

    def _map_position_to_gravity(self, position: str) -> str:
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

    def _map_position_to_aliyun_gravity(self, position: str) -> str:
        """
        映射位置到阿里云OSS gravity参数

        Args:
            position: 水印位置字符串

        Returns:
            阿里云OSS的g参数值
        """
        mapping = {
            "top_left": "nw",
            "top_center": "north",
            "top_right": "ne",
            "center_left": "west",
            "center": "center",
            "center_right": "east",
            "bottom_left": "sw",
            "bottom_center": "south",
            "bottom_right": "se"
        }
        return mapping.get(position, "se")

    async def _build_aliyun_oss_watermark_url(
        self,
        base_url: str,
        config: WatermarkConfig,
        position: Optional[str] = None
    ) -> str:
        """
        构建阿里云OSS水印URL（使用x-oss-process参数）

        阿里云OSS支持通过URL参数实现云端水印处理，无需本地处理

        Args:
            base_url: 原图URL
            config: 水印配置
            position: 指定的水印位置

        Returns:
            带水印参数的完整URL

        Reference:
            https://help.aliyun.com/zh/oss/user-guide/add-watermarks
        """
        # 使用智能分析的位置，或者使用配置的第一个位置作为默认
        if position is None:
            position = config.positions[0] if config.positions else "bottom_right"
            logger.info(f"Using default position: {position}")
        else:
            logger.info(f"Using intelligent position: {position}")

        # 获取水印图片URL并编码为Base64
        watermark_url = config.image_url

        # 阿里云OSS水印图片必须在同一个Bucket中，提取object key
        # 格式: https://{bucket}.{endpoint}/{object_key}
        # 我们需要从URL中提取object_key部分
        try:
            # 假设水印图片URL格式: https://bucket.endpoint/path/to/watermark.png
            # 提取 /path/to/watermark.png 部分
            from urllib.parse import urlparse
            parsed = urlparse(watermark_url)
            watermark_object_key = parsed.path.lstrip('/')  # 移除开头的 /

            # 将object key编码为Base64（阿里云OSS要求）
            watermark_base64 = base64.b64encode(watermark_object_key.encode('utf-8')).decode('utf-8')

            # 构建水印参数
            # 格式: image/watermark,image_{base64},t_{透明度},g_{位置},x_{x边距},y_{y边距},P_{缩放比例}/format,png
            params = [
                "image/watermark",
                f"image_{watermark_base64}",
                f"t_{int(float(config.opacity) * 100)}",  # 透明度 0-100
                f"g_{self._map_position_to_aliyun_gravity(position)}",  # 位置
                f"x_{config.margin_pixels}",  # X边距
                f"y_{config.margin_pixels}",  # Y边距
                f"P_{int(float(config.scale_ratio) * 100)}"  # 缩放比例（相对于原图的百分比）
            ]

            # 拼接参数，并添加format,png以保持PNG透明度
            process_param = ",".join(params) + "/format,png"

            # 构建完整URL
            separator = "&" if "?" in base_url else "?"
            watermark_url_final = f"{base_url}{separator}x-oss-process={quote(process_param)}"

            logger.info(f"Generated Aliyun OSS watermark URL with position {position}")
            return watermark_url_final

        except Exception as e:
            logger.error(f"Failed to build Aliyun OSS watermark URL: {e}")
            # 失败时返回原图URL
            return base_url

    async def _update_ozon_product_images(
        self,
        product: OzonProduct,
        processed_images: List[str],
        original_images: List[str]
    ) -> Dict[str, Any]:
        """更新OZON商品图片"""
        try:
            # 准备更新数据
            update_data = {
                "product_id": product.ozon_product_id,  # 添加OZON产品ID
                "offer_id": product.offer_id,
                "images": processed_images[:15]  # OZON最多支持15张图片
            }

            # 调试日志
            logger.info(f"Updating OZON product images - product_id: {product.ozon_product_id}, offer_id: {product.offer_id}")
            logger.info(f"Update data: {update_data}")

            # 调用OZON API更新商品图片
            result = await self.ozon_api.update_product_images(
                [update_data]
            )

            # 更新本地数据库
            if result.get("success"):
                product.images = {
                    "primary": processed_images[0] if processed_images else None,
                    "additional": processed_images[1:] if len(processed_images) > 1 else []
                }
                product.watermark_applied = True
                product.watermark_applied_at = utcnow()
                await self.db.commit()

            return result

        except Exception as e:
            logger.error(f"Failed to update OZON product images: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def _update_task_status(
        self,
        task_id: str,
        status: str,
        original_images: Optional[List[str]] = None,
        processed_images: Optional[List[str]] = None,
        cloudinary_public_ids: Optional[List[str]] = None,
        error_message: Optional[str] = None
    ):
        """更新任务状态"""
        task = await self.db.get(WatermarkTask, task_id)
        if task:
            task.status = status
            if original_images:
                task.original_images = original_images
            if processed_images:
                task.processed_images = processed_images
            if cloudinary_public_ids:
                task.cloudinary_public_ids = cloudinary_public_ids
            if error_message:
                task.error_message = error_message

            if status == "processing":
                task.processing_started_at = utcnow()
            elif status in ["completed", "failed"]:
                task.completed_at = utcnow()

            await self.db.commit()

    async def process_batch(
        self,
        batch_id: str,
        shop_id: int,
        product_ids: List[int],
        watermark_config_id: int
    ) -> Dict[str, Any]:
        """
        批量处理商品水印

        Returns:
            批量处理结果
        """
        results = {
            "batch_id": batch_id,
            "total": len(product_ids),
            "success": 0,
            "failed": 0,
            "details": []
        }

        # 获取批次中的所有任务
        result = await self.db.execute(
            select(WatermarkTask).where(
                WatermarkTask.batch_id == batch_id
            )
        )
        tasks = result.scalars().all()

        for task in tasks:
            try:
                # 更新任务状态为处理中
                task.status = "processing"
                task.processing_started_at = utcnow()
                await self.db.commit()

                # 处理单个商品
                result = await self.process_single_product(
                    task.product_id,
                    task.shop_id,
                    task.watermark_config_id,
                    task.id
                )

                results["success"] += 1
                results["details"].append(result)

            except Exception as e:
                logger.error(f"Failed to process task {task.id}: {e}")
                results["failed"] += 1
                results["details"].append({
                    "product_id": task.product_id,
                    "success": False,
                    "error": str(e)
                })

        return results