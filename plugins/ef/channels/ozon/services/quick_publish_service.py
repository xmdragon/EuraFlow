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
        快速上架商品到OZON

        流程：
        1. 验证店铺
        2. 处理图片（转存Cloudinary）
        3. 调用OZON API导入商品
        4. 保存本地草稿记录
        5. 返回任务ID

        Args:
            db: 数据库会话
            dto: 上架数据DTO
            user_id: 用户ID

        Returns:
            {success, task_id, message}
        """
        try:
            logger.info(f"Quick publish started: offer_id={dto.offer_id}, shop_id={dto.shop_id}")

            # 1. 获取店铺信息
            shop = await self._get_shop(db, dto.shop_id)
            logger.info(f"Shop found: {shop.shop_name}")

            # 2. 创建API客户端
            api_client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            # 3. 处理图片（转存到Cloudinary）
            logger.info(f"Processing {len(dto.images)} images...")
            image_urls = await self._process_images(
                db, dto.images, dto.offer_id, shop.id
            )
            logger.info(f"Images processed: {len(image_urls)} URLs ready")

            # 4. 准备OZON API数据
            product_data = self._build_ozon_product_data(dto, image_urls)
            logger.info(f"Product data built: {product_data.get('name')}")

            # 5. 调用OZON API导入商品
            logger.info("Calling OZON API /v2/product/import...")
            import_result = await api_client.import_products([product_data])

            if not import_result.get('result'):
                error_msg = f"OZON API error: {import_result}"
                logger.error(error_msg)
                return {
                    "success": False,
                    "error": error_msg
                }

            task_id = import_result['result']['task_id']
            logger.info(f"OZON import task created: {task_id}")

            # 6. 保存本地记录（草稿状态）
            await self._save_local_product(db, dto, shop.id, task_id)
            logger.info(f"Local product record saved: offer_id={dto.offer_id}")

            return {
                "success": True,
                "task_id": task_id,
                "message": "商品已提交到OZON，等待审核中..."
            }

        except Exception as e:
            logger.error(f"Quick publish failed: {e}", exc_info=True)
            return {
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
        查询OZON导入任务状态

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

        for idx, ozon_url in enumerate(ozon_image_urls):
            # 生成唯一的public_id
            public_id = f"{shop_id}_{offer_id}_{idx}_{int(datetime.now().timestamp())}"

            # 创建上传任务
            task = cloudinary_service.upload_image_from_url(
                image_url=ozon_url,
                public_id=public_id,
                folder=f"ozon_{shop_id}/quick_publish"
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
            sku=dto.offer_id,  # 使用offer_id作为SKU
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
