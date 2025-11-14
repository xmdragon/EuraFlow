"""
一键上架服务
处理从OZON商品页采集数据并上架到OZON的业务逻辑
"""
import asyncio
import logging
from typing import Dict, Any, List
from decimal import Decimal
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..models import OzonShop, OzonProduct
from ..api.client import OzonAPIClient
from .cloudinary_service import CloudinaryService, CloudinaryConfigManager
from ..utils.datetime_utils import utcnow

logger = logging.getLogger(__name__)


class QuickPublishService:
    """一键上架服务"""

    async def quick_publish(
        self,
        db: AsyncSession,
        dto: Any,  # QuickPublishDTO
        user_id: int
    ) -> Dict[str, Any]:
        """
        快速上架商品到OZON (异步版本)

        新流程 (Celery 任务链):
        1. 验证店铺
        2. 触发异步任务链:
           a. 通过 SKU 创建商品
           b. 上传图片到图库 (Cloudinary/Aliyun OSS)
           c. 更新 OZON 商品图片
           d. 更新库存
        3. 立即返回 task_id 供前端轮询

        Args:
            db: 数据库会话
            dto: 上架数据DTO
            user_id: 用户ID

        Returns:
            {task_id, status, message}
        """
        try:
            logger.info(f"Quick publish started (async): offer_id={dto.offer_id}, shop_id={dto.shop_id}")

            # 1. 验证店铺存在
            shop = await self._get_shop(db, dto.shop_id)
            logger.info(f"Shop validated: {shop.shop_name}")

            # 2. 序列化 DTO (Celery 需要 JSON-serializable)
            dto_dict = dto.model_dump() if hasattr(dto, 'model_dump') else dto.dict()

            # 3. 生成任务 ID
            import time
            task_id = f"quick_publish_{shop.id}_{dto.offer_id}_{int(time.time())}"

            # 4. 触发 Celery 任务链
            from ..tasks.quick_publish_task import quick_publish_chain_task

            quick_publish_chain_task.apply_async(
                args=[dto_dict, user_id, shop.id],
                task_id=task_id
            )

            logger.info(f"Celery task chain triggered: task_id={task_id}")

            # 5. 立即返回 task_id
            return {
                "task_id": task_id,
                "status": "pending",
                "message": "商品上架任务已提交，正在处理中..."
            }

        except Exception as e:
            logger.error(f"Quick publish failed: {e}", exc_info=True)
            return {
                "task_id": "",
                "status": "error",
                "message": "商品上架失败",
                "error": str(e)
            }

    async def quick_publish_batch(
        self,
        db: AsyncSession,
        dto: Any,  # QuickPublishBatchDTO
        user_id: int
    ) -> Dict[str, Any]:
        """
        批量上架商品到OZON (多个变体)

        流程:
        1. 验证店铺
        2. 为每个变体创建独立的 Celery 任务
        3. 返回所有任务ID供前端并发轮询

        Args:
            db: 数据库会话
            dto: 批量上架数据DTO
            user_id: 用户ID

        Returns:
            {task_ids: List[str], task_count: int, message: str, success: bool}
        """
        try:
            logger.info(f"[QuickPublishService] 批量上架开始: shop_id={dto.shop_id}, 变体数量={len(dto.variants)}")

            # 1. 验证店铺存在
            shop = await self._get_shop(db, dto.shop_id)
            logger.info(f"[QuickPublishService] 店铺验证通过: {shop.shop_name}")

            # 2. 为每个变体创建任务
            from ..tasks.quick_publish_task import quick_publish_chain_task
            import time

            task_ids = []
            for idx, variant in enumerate(dto.variants):
                # 合并共享数据和变体数据
                # 构建图片列表：变体主图（如果有）+ 共享图片
                variant_images = []
                if variant.primary_image:
                    variant_images.append(variant.primary_image)
                # 添加共享图片（去重）
                for img in dto.images:
                    if img not in variant_images:
                        variant_images.append(img)

                variant_dto = {
                    "shop_id": dto.shop_id,
                    "warehouse_ids": dto.warehouse_ids,
                    "sku": variant.sku,
                    "offer_id": variant.offer_id,
                    "price": str(variant.price),  # Decimal → str
                    "stock": variant.stock,
                    "old_price": str(variant.old_price) if variant.old_price else None,
                    "ozon_product_id": dto.ozon_product_id,
                    "title": dto.title,
                    "description": dto.description,
                    "images": variant_images,  # 变体主图 + 共享图片
                    "brand": dto.brand,
                    "barcode": dto.barcode,
                    "category_id": dto.category_id,
                    "dimensions": dto.dimensions.model_dump() if hasattr(dto.dimensions, 'model_dump') else dto.dimensions.dict(),
                    "attributes": [attr.model_dump() if hasattr(attr, 'model_dump') else attr.dict() for attr in dto.attributes],
                }

                # 生成唯一任务ID
                task_id = f"quick_publish_{shop.id}_{variant.offer_id}_{int(time.time() * 1000)}_{idx}"

                # 触发 Celery 任务
                quick_publish_chain_task.apply_async(
                    args=[variant_dto, user_id, shop.id],
                    task_id=task_id
                )

                task_ids.append(task_id)
                logger.info(f"[QuickPublishService] 变体 {idx+1}/{len(dto.variants)} 任务已创建: task_id={task_id}, SKU={variant.sku}")

            logger.info(f"[QuickPublishService] 批量上架完成: 共创建 {len(task_ids)} 个任务")

            return {
                "task_ids": task_ids,
                "task_count": len(task_ids),
                "message": f"已提交 {len(task_ids)} 个变体上架",
                "success": True
            }

        except Exception as e:
            logger.error(f"[QuickPublishService] 批量上架失败: {e}", exc_info=True)
            return {
                "task_ids": [],
                "task_count": 0,
                "message": "批量上架失败",
                "success": False,
                "error": str(e)
            }

    async def get_task_status(
        self,
        db: AsyncSession,
        task_id: str,
        shop_id: int
    ) -> Dict[str, Any]:
        """
        查询 Celery 任务状态 (从 Redis 读取)

        Args:
            db: 数据库会话
            task_id: Celery 任务 ID
            shop_id: 店铺ID (用于验证权限)

        Returns:
            {
                task_id, status, current_step, progress,
                steps, created_at, updated_at, error
            }
        """
        try:
            import redis
            import json

            redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

            # 从 Redis 读取任务进度
            key = f"celery-task-progress:{task_id}"
            data = redis_client.get(key)

            if not data:
                # 任务不存在或已过期
                return {
                    "task_id": task_id,
                    "status": "not_found",
                    "error": "任务不存在或已过期"
                }

            # 解析任务进度
            progress_data = json.loads(data)

            return {
                "task_id": task_id,
                "status": progress_data.get("status", "unknown"),
                "current_step": progress_data.get("current_step"),
                "progress": progress_data.get("progress", 0),
                "steps": progress_data.get("steps", {}),
                "created_at": progress_data.get("created_at"),
                "updated_at": progress_data.get("updated_at"),
                "error": progress_data.get("error")
            }

        except Exception as e:
            logger.error(f"Get task status failed: {e}", exc_info=True)
            return {
                "task_id": task_id,
                "status": "error",
                "error": str(e)
            }

    async def get_ozon_import_task_status(
        self,
        db: AsyncSession,
        task_id: str,
        shop_id: int
    ) -> Dict[str, Any]:
        """
        查询OZON导入任务状态 (旧方法,保留用于兼容)

        Args:
            db: 数据库会话
            task_id: OZON任务ID
            shop_id: 店铺ID

        Returns:
            {success, task_id, status, items, error}
        """
        try:
            # 获取店铺和API客户端
            shop = await self._get_shop(db, shop_id)
            api_client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            # 查询OZON导入状态
            result = await api_client.get_import_product_info(task_id)

            if not result.get('result'):
                return {
                    "success": False,
                    "task_id": task_id,
                    "status": "error",
                    "error": "无法获取任务状态"
                }

            items = result['result'].get('items', [])

            # 判断整体状态
            if not items:
                status = "processing"
            else:
                # 检查所有商品的状态
                all_imported = all(item.get('status') == 'imported' for item in items)
                any_failed = any(item.get('status') == 'failed' for item in items)

                if all_imported:
                    status = "imported"
                    # 更新本地商品记录
                    await self._update_local_product_status(db, items)
                elif any_failed:
                    status = "failed"
                else:
                    status = "processing"

            return {
                "success": True,
                "task_id": task_id,
                "status": status,
                "items": items
            }

        except Exception as e:
            logger.error(f"Get task status failed: {e}", exc_info=True)
            return {
                "success": False,
                "task_id": task_id,
                "status": "error",
                "error": str(e)
            }

    async def _process_images(
        self,
        db: AsyncSession,
        ozon_image_urls: List[str],
        offer_id: str,
        shop_id: int
    ) -> List[str]:
        """
        处理图片：OZON URL → Cloudinary → 新URL

        Args:
            db: 数据库会话
            ozon_image_urls: 原始OZON图片URL列表
            offer_id: 商品SKU
            shop_id: 店铺ID

        Returns:
            Cloudinary图片URL列表（或原始URL如果Cloudinary未配置）
        """
        if not ozon_image_urls:
            logger.warning("No images provided")
            return []

        # 限制最多15张（OZON限制）
        ozon_image_urls = ozon_image_urls[:15]

        # 获取Cloudinary配置
        cloudinary_config = await CloudinaryConfigManager.get_config(db)
        if not cloudinary_config:
            logger.warning("Cloudinary not configured, using original OZON URLs")
            return ozon_image_urls

        cloudinary_service = await CloudinaryConfigManager.create_service_from_config(
            cloudinary_config
        )

        # 并发上传图片到Cloudinary
        uploaded_urls = []
        tasks = []

        # 使用配置的商品图片文件夹
        base_folder = cloudinary_service.product_images_folder or "products"

        for idx, ozon_url in enumerate(ozon_image_urls):
            # 生成唯一的public_id
            public_id = f"{shop_id}_{offer_id}_{idx}_{int(datetime.now().timestamp())}"

            # 创建上传任务
            task = cloudinary_service.upload_image_from_url(
                image_url=ozon_url,
                public_id=public_id,
                folder=f"{base_folder}/{shop_id}/quick_publish"
            )
            tasks.append((idx, task))

        # 等待所有上传完成
        results = await asyncio.gather(*[task for _, task in tasks], return_exceptions=True)

        # 处理结果
        for idx, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Image {idx} upload failed: {result}")
                # 失败时使用原始URL
                uploaded_urls.append(ozon_image_urls[idx])
            elif result.get('success'):
                uploaded_urls.append(result['url'])
                logger.info(f"Image {idx} uploaded successfully")
            else:
                logger.error(f"Image {idx} upload failed: {result.get('error')}")
                uploaded_urls.append(ozon_image_urls[idx])

        if not uploaded_urls:
            # 如果全部失败，返回原始URL
            logger.warning("All Cloudinary uploads failed, falling back to original URLs")
            return ozon_image_urls

        return uploaded_urls

    def _build_ozon_product_data(
        self,
        dto: Any,
        image_urls: List[str]
    ) -> Dict[str, Any]:
        """
        构建OZON API商品数据

        OZON /v2/product/import 必填字段：
        - offer_id: 商家SKU（唯一标识）
        - category_id: 类目ID（必须是叶子类目）
        - name: 商品名称
        - dimensions: {weight, height, width, length}
        - attributes: 属性列表（根据类目要求）

        Args:
            dto: QuickPublishDTO
            image_urls: 处理后的图片URL列表

        Returns:
            OZON API商品数据
        """
        data = {
            "offer_id": dto.offer_id,
            "category_id": dto.category_id,
            "name": dto.title,
        }

        # 描述
        if dto.description:
            data["description"] = dto.description

        # 条码
        if dto.barcode:
            data["barcode"] = dto.barcode

        # 图片（OZON需要file_name格式）
        if image_urls:
            # 对于OZON import API，images需要是URL数组
            data["images"] = image_urls

        # 尺寸重量（必填）
        data["dimensions"] = {
            "weight": dto.dimensions.weight,
            "height": dto.dimensions.height,
            "width": dto.dimensions.width,
            "length": dto.dimensions.length
        }

        # 属性（必填，即使为空数组）
        if dto.attributes:
            data["attributes"] = [
                {
                    "attribute_id": attr.attribute_id,
                    "value": attr.value if attr.value else None,
                    "dictionary_value_id": attr.dictionary_value_id if attr.dictionary_value_id else None
                }
                for attr in dto.attributes
            ]
        else:
            data["attributes"] = []

        return data

    async def _get_shop(self, db: AsyncSession, shop_id: int) -> OzonShop:
        """获取店铺"""
        result = await db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        shop = result.scalar_one_or_none()
        if not shop:
            raise ValueError(f"店铺 {shop_id} 不存在")
        return shop

    async def _save_local_product(
        self,
        db: AsyncSession,
        dto: Any,
        shop_id: int,
        task_id: str
    ):
        """
        保存本地商品记录（草稿状态）

        Args:
            db: 数据库会话
            dto: QuickPublishDTO
            shop_id: 店铺ID
            task_id: OZON任务ID
        """
        product = OzonProduct(
            shop_id=shop_id,
            offer_id=dto.offer_id,
            title=dto.title,
            description=dto.description,
            price=dto.price,
            old_price=dto.old_price,
            stock=dto.stock,
            category_id=dto.category_id,
            barcode=dto.barcode,
            brand=dto.brand,
            status='pending',  # 待审核
            sync_status='importing',  # 导入中
            sync_error=f"Import task: {task_id}",
            visibility=False,
            created_at=utcnow(),
            updated_at=utcnow()
        )
        db.add(product)
        await db.commit()
        logger.info(f"Local product saved: {product.id}")

    async def _update_local_product_status(
        self,
        db: AsyncSession,
        items: List[Dict[str, Any]]
    ):
        """
        更新本地商品状态（导入成功后）

        Args:
            db: 数据库会话
            items: OZON返回的商品列表
        """
        for item in items:
            offer_id = item.get('offer_id')
            status = item.get('status')
            product_id = item.get('product_id')

            if not offer_id:
                continue

            # 查找本地商品
            result = await db.execute(
                select(OzonProduct).where(OzonProduct.offer_id == offer_id)
            )
            product = result.scalar_one_or_none()

            if product:
                if status == 'imported':
                    product.ozon_product_id = product_id
                    product.sync_status = 'success'
                    product.status = 'active'  # 或根据OZON实际状态
                    product.sync_error = None
                elif status == 'failed':
                    product.sync_status = 'failed'
                    errors = item.get('errors', [])
                    product.sync_error = '; '.join([e.get('message', '') for e in errors])

                product.updated_at = utcnow()

        await db.commit()
        logger.info(f"Updated {len(items)} local products")
