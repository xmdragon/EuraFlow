"""
图片异步上传任务
从象寄URL上传到当前激活的图床（Cloudinary/阿里云OSS）
"""
import asyncio
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.tasks.celery_app import celery_app
from ef_core.database import get_db_manager
from ef_core.utils.logger import get_logger

from ..models.products import OzonProduct, OzonProductVariant
from ..services.image_storage_factory import ImageStorageFactory
from ..utils.image_utils import has_xiangji_urls, extract_xiangji_urls, replace_urls

logger = get_logger(__name__)

# 创建线程池用于运行异步任务
_thread_pool = ThreadPoolExecutor(max_workers=2)


@celery_app.task(
    bind=True,
    name="ef.ozon.images.upload_to_storage",
    max_retries=3,
    default_retry_delay=60  # 失败后60秒重试
)
def upload_xiangji_images_to_storage(
    self,
    product_id: int,
    variant_id: Optional[int] = None
):
    """
    异步上传象寄URL到图床并更新数据库

    Args:
        product_id: 商品ID
        variant_id: 变体ID（可选，如果不提供则更新主商品图片）

    Returns:
        dict: {
            "success": bool,
            "product_id": int,
            "variant_id": int | None,
            "uploaded_count": int,
            "failed_count": int
        }
    """
    task_id = self.request.id if self.request.id else "unknown"

    logger.info(f"[Task {task_id}] 开始上传图片任务: product_id={product_id}, variant_id={variant_id}")

    def run_async_in_thread():
        """在新线程中运行异步代码"""
        # 创建新的event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(
                _upload_images_async(product_id, variant_id, task_id)
            )
        finally:
            loop.close()

    try:
        result = run_async_in_thread()
        logger.info(f"[Task {task_id}] 任务完成: {result}")
        return result
    except Exception as exc:
        logger.error(f"[Task {task_id}] 任务失败: {exc}", exc_info=True)
        # 重试
        raise self.retry(exc=exc)


async def _upload_images_async(product_id: int, variant_id: Optional[int], task_id: str) -> dict:
    """
    异步上传图片的核心逻辑

    Args:
        product_id: 商品ID
        variant_id: 变体ID（可选）
        task_id: Celery任务ID

    Returns:
        dict: 上传结果
    """
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        try:
            # 1. 查询商品或变体的images字段
            if variant_id:
                # 查询变体
                stmt = select(OzonProductVariant).where(OzonProductVariant.id == variant_id)
                result = await db.execute(stmt)
                entity = result.scalar_one_or_none()
                entity_type = "variant"
            else:
                # 查询主商品
                stmt = select(OzonProduct).where(OzonProduct.id == product_id)
                result = await db.execute(stmt)
                entity = result.scalar_one_or_none()
                entity_type = "product"

            if not entity:
                logger.error(f"[Task {task_id}] {entity_type} not found: product_id={product_id}, variant_id={variant_id}")
                return {
                    "success": False,
                    "product_id": product_id,
                    "variant_id": variant_id,
                    "error": f"{entity_type} not found"
                }

            images = entity.images or []

            if not images:
                logger.info(f"[Task {task_id}] 无图片，跳过")
                return {
                    "success": True,
                    "product_id": product_id,
                    "variant_id": variant_id,
                    "uploaded_count": 0,
                    "failed_count": 0
                }

            # 2. 检测是否包含象寄URL
            if not has_xiangji_urls(images):
                logger.info(f"[Task {task_id}] 无象寄URL，跳过")
                return {
                    "success": True,
                    "product_id": product_id,
                    "variant_id": variant_id,
                    "uploaded_count": 0,
                    "failed_count": 0
                }

            xiangji_urls = extract_xiangji_urls(images)
            logger.info(f"[Task {task_id}] 检测到 {len(xiangji_urls)} 个象寄URL，开始上传")

            # 3. 获取当前激活的图床服务
            try:
                storage_service = await ImageStorageFactory.create_from_db(db)
            except ValueError as e:
                logger.error(f"[Task {task_id}] 无法获取图床服务: {e}")
                return {
                    "success": False,
                    "product_id": product_id,
                    "variant_id": variant_id,
                    "error": str(e)
                }

            # 4. 异步上传所有象寄URL
            url_mapping = {}  # {象寄URL: 图床URL}
            uploaded_count = 0
            failed_count = 0

            for index, xiangji_url in xiangji_urls:
                try:
                    public_id = f"product_{product_id}_img{index}"
                    if variant_id:
                        public_id = f"product_{product_id}_variant_{variant_id}_img{index}"

                    result = await storage_service.upload_image_from_url(
                        image_url=xiangji_url,
                        public_id=public_id,
                        folder="products"
                    )

                    if result.get("success"):
                        storage_url = result.get("url")
                        url_mapping[xiangji_url] = storage_url
                        uploaded_count += 1
                        logger.info(f"[Task {task_id}] 上传成功: {xiangji_url} -> {storage_url}")
                    else:
                        failed_count += 1
                        logger.error(f"[Task {task_id}] 上传失败: {xiangji_url}, 原因: {result.get('error')}")
                except Exception as e:
                    failed_count += 1
                    logger.error(f"[Task {task_id}] 上传异常: {xiangji_url}, 错误: {e}")

            # 5. 更新数据库中的images字段
            if uploaded_count > 0:
                new_images = replace_urls(images, url_mapping)

                if variant_id:
                    stmt = update(OzonProductVariant).where(
                        OzonProductVariant.id == variant_id
                    ).values(images=new_images)
                else:
                    stmt = update(OzonProduct).where(
                        OzonProduct.id == product_id
                    ).values(images=new_images)

                await db.execute(stmt)
                await db.commit()

                logger.info(f"[Task {task_id}] 数据库更新成功，替换了 {uploaded_count} 个URL")

            return {
                "success": True,
                "product_id": product_id,
                "variant_id": variant_id,
                "uploaded_count": uploaded_count,
                "failed_count": failed_count
            }

        except Exception as e:
            await db.rollback()
            logger.error(f"[Task {task_id}] 异步上传失败: {e}", exc_info=True)
            raise
