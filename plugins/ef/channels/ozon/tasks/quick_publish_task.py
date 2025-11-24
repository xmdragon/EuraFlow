"""
OZON 一键跟卖 Celery 任务
处理商品创建、图片上传、库存更新的异步流程
"""
import asyncio
import json
import time
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, UTC

from celery import chain
from sqlalchemy import select, create_engine
from sqlalchemy.orm import sessionmaker

from ef_core.tasks.celery_app import celery_app
from ef_core.config import get_settings
from ef_core.utils.logger import get_logger

from ..models import OzonShop, OzonProduct
from ..api.client import OzonAPIClient
from ..services.cloudinary_service import CloudinaryService, CloudinaryConfigManager
from ..utils.datetime_utils import utcnow

logger = get_logger(__name__)

# Redis 键前缀
REDIS_TASK_PROGRESS_PREFIX = "celery-task-progress:"


# ========== 辅助函数 ==========

def run_async_in_celery(coro):
    """
    在 Celery 任务中安全执行异步函数
    避免 Event loop is closed 错误
    """
    try:
        # 尝试获取当前事件循环
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            # 如果已关闭，创建新的
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
    except RuntimeError:
        # 没有事件循环，创建新的
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    try:
        return loop.run_until_complete(coro)
    except Exception as e:
        logger.error(f"Async execution failed: {e}", exc_info=True)
        raise
    finally:
        loop.close()
        asyncio.set_event_loop(None)


def get_sync_db_session():
    """创建同步数据库会话 (用于 Celery 任务)"""
    settings = get_settings()
    sync_db_url = settings.database_url.replace('+asyncpg', '')
    engine = create_engine(sync_db_url, pool_pre_ping=True, pool_recycle=3600)
    return sessionmaker(bind=engine)


def update_task_progress(task_id: str, status: str, current_step: str, progress: int,
                        step_details: Dict = None, error: str = None):
    """更新任务进度到 Redis"""
    try:
        import redis
        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

        key = f"{REDIS_TASK_PROGRESS_PREFIX}{task_id}"
        existing_data = redis_client.get(key)

        if existing_data:
            data = json.loads(existing_data)
        else:
            data = {
                "task_id": task_id,
                "status": status,
                "current_step": current_step,
                "progress": 0,
                "steps": {
                    "create_product": {"status": "pending"},
                    "upload_images": {"status": "pending"},
                    "update_images": {"status": "pending"},
                    "update_stock": {"status": "pending"}
                },
                "created_at": datetime.now(UTC).isoformat(),
                "updated_at": datetime.now(UTC).isoformat()
            }

        data["status"] = status
        data["current_step"] = current_step
        data["progress"] = progress
        data["updated_at"] = datetime.now(UTC).isoformat()

        if error:
            data["error"] = error

        if step_details and current_step in data["steps"]:
            data["steps"][current_step].update(step_details)

        redis_client.setex(key, 3600, json.dumps(data))
        logger.info(f"Task progress updated: {task_id}, step={current_step}, progress={progress}%")

    except Exception as e:
        logger.error(f"Failed to update task progress: {e}", exc_info=True)


def get_shop_sync(shop_id: int) -> Optional[OzonShop]:
    """同步获取店铺信息"""
    SessionLocal = get_sync_db_session()
    with SessionLocal() as db:
        result = db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        return result.scalar_one_or_none()


async def get_image_storage_config(db_session):
    """获取激活的图片存储配置 (优先级: Cloudinary > Aliyun OSS)"""
    try:
        cloudinary_config = await CloudinaryConfigManager.get_config(db_session)
        if cloudinary_config:
            cloudinary_service = await CloudinaryConfigManager.create_service_from_config(
                cloudinary_config
            )
            return ("cloudinary", cloudinary_service)
        return (None, None)
    except Exception as e:
        logger.error(f"Failed to get image storage config: {e}", exc_info=True)
        return (None, None)


async def get_active_watermark_config(db_session, storage_provider: str):
    """
    获取激活的水印配置（与当前图床类型匹配）

    Args:
        db_session: 数据库会话
        storage_provider: 图床类型 (cloudinary/aliyun_oss)

    Returns:
        WatermarkConfig 或 None
    """
    try:
        from ..models.watermark import WatermarkConfig
        from sqlalchemy import select, and_

        result = await db_session.execute(
            select(WatermarkConfig).where(
                and_(
                    WatermarkConfig.storage_provider == storage_provider,
                    WatermarkConfig.is_active == True
                )
            ).order_by(WatermarkConfig.created_at.desc())
        )

        watermark_config = result.scalars().first()

        if watermark_config:
            logger.info(f"Found active watermark config: {watermark_config.name} (ID: {watermark_config.id})")
        else:
            logger.info(f"No active watermark config found for storage: {storage_provider}")

        return watermark_config

    except Exception as e:
        logger.error(f"Failed to get watermark config: {e}", exc_info=True)
        return None


def _map_position_to_gravity(position: str) -> str:
    """
    映射位置到Cloudinary gravity参数

    Args:
        position: 水印位置字符串

    Returns:
        Cloudinary gravity 值
    """
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


def _build_watermark_transformation(watermark_config, position: Optional[str] = None) -> List[Dict]:
    """
    构建Cloudinary水印转换参数

    Args:
        watermark_config: 水印配置对象
        position: 指定的水印位置，如果为None则使用配置的第一个位置

    Returns:
        Cloudinary transformation 参数列表
    """
    # 使用指定位置，或者使用配置的第一个位置作为默认
    if position is None:
        position = watermark_config.positions[0] if watermark_config.positions else "bottom_right"
        logger.info(f"Using default watermark position: {position}")
    else:
        logger.info(f"Using specified watermark position: {position}")

    transformation = [{
        "overlay": watermark_config.cloudinary_public_id.replace("/", ":"),  # Cloudinary格式要求
        "opacity": int(float(watermark_config.opacity) * 100),  # 转换为 0-100 的整数
        "width": int(float(watermark_config.scale_ratio) * 100),  # 相对于主图的百分比
        "flags": "relative,layer_apply",  # 使用相对尺寸并应用到overlay层
        "gravity": _map_position_to_gravity(position),
        "x": watermark_config.margin_pixels,
        "y": watermark_config.margin_pixels
    }]

    return transformation


# ========== Celery 任务 ==========

@celery_app.task(bind=True, name="ef.ozon.quick_publish.chain", max_retries=3)
def quick_publish_chain_task(self, dto_dict: Dict, user_id: int, shop_id: int):
    """
    一键跟卖任务链 (协调器)

    流程:
    1. 通过 SKU 创建商品
    2. 上传图片到图库
    3. 更新 OZON 商品图片
    4. 更新库存

    注意: 不能在任务内部调用 result.get()，会导致死锁
    改为直接返回 chain，让 Celery 自动处理链的执行
    """
    task_id = self.request.id
    logger.info(f"Quick publish chain started: task_id={task_id}, shop_id={shop_id}")

    try:
        update_task_progress(task_id, status="running", current_step="create_product", progress=0)

        task_chain = chain(
            create_product_by_sku_task.si(dto_dict, user_id, shop_id, task_id),
            upload_images_to_storage_task.s(dto_dict, shop_id, task_id),
            update_ozon_product_images_task.s(task_id),
            update_product_stock_task.s(dto_dict, shop_id, task_id)
        )

        # 直接应用链，不等待结果（避免 "Never call result.get() within a task" 错误）
        result = task_chain.apply_async()

        logger.info(f"Quick publish chain dispatched: task_id={task_id}, chain_id={result.id}")

        # 返回 chain 的 AsyncResult，前端可以轮询状态
        return {
            "status": "dispatched",
            "chain_id": result.id,
            "task_id": task_id
        }

    except Exception as e:
        logger.error(f"Quick publish chain failed: {e}", exc_info=True)
        update_task_progress(
            task_id, status="failed", current_step="create_product",
            progress=0, error=str(e)
        )
        raise self.retry(countdown=60, exc=e)


@celery_app.task(bind=True, name="ef.ozon.quick_publish.create_product", max_retries=3)
def create_product_by_sku_task(self, dto_dict: Dict, user_id: int, shop_id: int, parent_task_id: str):
    """
    步骤 1: 创建商品（完整商品数据）
    调用 OZON API /v3/product/import
    """
    logger.info(f"[Step 1] Creating product: offer_id={dto_dict.get('offer_id')}")

    try:
        update_task_progress(
            parent_task_id, status="running", current_step="create_product",
            progress=10, step_details={"status": "running", "message": "正在创建商品..."}
        )

        shop = get_shop_sync(shop_id)
        if not shop:
            raise ValueError(f"店铺 {shop_id} 不存在")

        logger.info(f"[Step 1] Shop info: shop_id={shop.id}, client_id={shop.client_id}")

        api_client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop.id
        )

        # 构建完整商品数据（/v3/product/import API）
        product_item = {
            "offer_id": dto_dict["offer_id"],
            "name": dto_dict.get("name", ""),
        }

        # type_id（必需，叶子类目）- OZON API 字段名为 type_id
        if dto_dict.get("category_id"):
            product_item["type_id"] = dto_dict["category_id"]  # 将 category_id 映射为 type_id
        else:
            raise ValueError("category_id 是必需字段，无法创建商品")

        # dimensions（必需）
        if dto_dict.get("dimensions"):
            product_item["dimensions"] = dto_dict["dimensions"]
        else:
            raise ValueError("dimensions 是必需字段，无法创建商品")

        # attributes（必需，即使为空列表）
        product_item["attributes"] = dto_dict.get("attributes", [])

        # 可选字段
        if dto_dict.get("description"):
            product_item["description"] = dto_dict["description"]
        if dto_dict.get("brand"):
            product_item["brand"] = dto_dict["brand"]
        if dto_dict.get("barcode"):
            product_item["barcode"] = dto_dict["barcode"]

        # 图片（注意：这里暂不传递，因为需要先上传到OZON图库）
        # images 会在后续步骤中处理

        logger.info(f"[Step 1] Calling OZON API /v3/product/import with data: {product_item}")
        import_result = run_async_in_celery(api_client.import_products([product_item]))
        logger.info(f"[Step 1] OZON API response: {import_result}")

        if not import_result.get('result'):
            raise ValueError(f"OZON API 错误: {import_result}")

        ozon_task_id = import_result['result'].get('task_id')
        logger.info(f"OZON import task created: {ozon_task_id}")

        update_task_progress(
            parent_task_id, status="running", current_step="create_product",
            progress=15, step_details={"status": "polling", "ozon_task_id": ozon_task_id}
        )

        # 轮询任务状态 (最多 5 分钟)
        product_id = None
        max_attempts = 30
        for attempt in range(max_attempts):
            time.sleep(10)

            status_result = run_async_in_celery(
                api_client.get_import_product_info(ozon_task_id)
            )

            if not status_result.get('result'):
                continue

            items = status_result['result'].get('items', [])
            if not items:
                continue

            item = items[0]
            item_status = item.get('status')

            if item_status == 'imported':
                product_id = item.get('product_id')
                logger.info(f"Product created: product_id={product_id}")
                break
            elif item_status == 'failed':
                errors = item.get('errors', [])
                error_msg = '; '.join([e.get('message', '') for e in errors])
                raise ValueError(f"商品创建失败: {error_msg}")

        if not product_id:
            raise TimeoutError("商品创建超时 (5 分钟)")

        update_task_progress(
            parent_task_id, status="running", current_step="create_product",
            progress=25, step_details={"status": "completed", "product_id": product_id}
        )

        logger.info(f"[Step 1] Product created: product_id={product_id}")

        return {
            "product_id": product_id,
            "offer_id": dto_dict["offer_id"],
            "sku": dto_dict["sku"],
            "shop_id": shop_id
        }

    except Exception as e:
        logger.error(f"[Step 1] Failed: {e}", exc_info=True)
        update_task_progress(
            parent_task_id, status="failed", current_step="create_product",
            progress=0, step_details={"status": "failed", "error": str(e)},
            error=f"创建商品失败: {str(e)}"
        )
        raise self.retry(countdown=60, exc=e)


@celery_app.task(bind=True, name="ef.ozon.quick_publish.upload_images", max_retries=3)
def upload_images_to_storage_task(self, prev_result: Dict, dto_dict: Dict, shop_id: int, parent_task_id: str):
    """
    步骤 2: 上传图片到图库 (Cloudinary/Aliyun OSS)
    从 OZON URLs 下载并上传到激活的图片存储
    """
    product_id = prev_result["product_id"]
    ozon_image_urls = dto_dict.get("images", [])

    logger.info(f"[Step 2] Uploading images: product_id={product_id}, count={len(ozon_image_urls)}")

    try:
        update_task_progress(
            parent_task_id, status="running", current_step="upload_images",
            progress=30, step_details={"status": "running", "total": len(ozon_image_urls), "uploaded": 0}
        )

        if not ozon_image_urls:
            logger.warning("No images to upload")
            return {**prev_result, "image_urls": [], "storage_type": "none"}

        ozon_image_urls = ozon_image_urls[:15]  # 限制最多 15 张

        storage_type = None
        uploaded_urls = []

        async def upload_all_images():
            nonlocal storage_type, uploaded_urls

            from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
            settings = get_settings()
            async_engine = create_async_engine(settings.database_url, pool_pre_ping=True)
            AsyncSession = async_sessionmaker(async_engine, expire_on_commit=False)

            async with AsyncSession() as db:
                storage_type_result, storage_service = await get_image_storage_config(db)
                storage_type = storage_type_result

                if not storage_service:
                    logger.warning("No image storage configured, using original URLs")
                    return ozon_image_urls

                # 获取激活的水印配置（与当前图床类型匹配）
                watermark_config = await get_active_watermark_config(db, storage_type)

                # 构建水印转换参数（仅Cloudinary）
                transformations = None
                if watermark_config and storage_type == "cloudinary":
                    transformations = _build_watermark_transformation(watermark_config)
                    logger.info(f"Watermark transformation prepared: {watermark_config.name}")

                tasks = []
                for idx, ozon_url in enumerate(ozon_image_urls):
                    public_id = f"{shop_id}_{prev_result['offer_id']}_{idx}_{int(time.time())}"

                    if storage_type == "cloudinary":
                        folder = f"{storage_service.product_images_folder or 'products'}/{shop_id}/quick_publish"
                        task = storage_service.upload_image_from_url(
                            image_url=ozon_url,
                            public_id=public_id,
                            folder=folder,
                            transformations=transformations  # 应用水印转换
                        )
                    else:
                        folder = "products"
                        task = storage_service.upload_image_from_url(
                            image_url=ozon_url, public_id=public_id, folder=folder
                        )

                    tasks.append(task)

                results = await asyncio.gather(*tasks, return_exceptions=True)

                uploaded = []
                for idx, result in enumerate(results):
                    if isinstance(result, Exception):
                        logger.error(f"Image {idx} upload failed: {result}")
                        uploaded.append(ozon_image_urls[idx])
                    elif result.get('success'):
                        uploaded.append(result['url'])
                    else:
                        logger.error(f"Image {idx} upload failed: {result.get('error')}")
                        uploaded.append(ozon_image_urls[idx])

                    progress = 30 + int((idx + 1) / len(ozon_image_urls) * 20)
                    update_task_progress(
                        parent_task_id, status="running", current_step="upload_images",
                        progress=progress,
                        step_details={"status": "running", "total": len(ozon_image_urls), "uploaded": idx + 1}
                    )

                return uploaded

        uploaded_urls = run_async_in_celery(upload_all_images())

        if not uploaded_urls:
            uploaded_urls = ozon_image_urls
            storage_type = "fallback"

        update_task_progress(
            parent_task_id, status="running", current_step="upload_images",
            progress=50, step_details={
                "status": "completed", "total": len(ozon_image_urls),
                "uploaded": len(uploaded_urls), "storage_type": storage_type
            }
        )

        logger.info(f"[Step 2] Images uploaded: count={len(uploaded_urls)}, storage={storage_type}")

        return {**prev_result, "image_urls": uploaded_urls, "storage_type": storage_type}

    except Exception as e:
        logger.error(f"[Step 2] Failed: {e}", exc_info=True)
        logger.warning("Image upload failed, using original URLs as fallback")

        update_task_progress(
            parent_task_id, status="running", current_step="upload_images",
            progress=50, step_details={"status": "fallback", "error": str(e), "fallback_urls": ozon_image_urls}
        )

        return {**prev_result, "image_urls": ozon_image_urls, "storage_type": "fallback"}


@celery_app.task(bind=True, name="ef.ozon.quick_publish.update_images", max_retries=3)
def update_ozon_product_images_task(self, prev_result: Dict, parent_task_id: str):
    """
    步骤 3: 更新 OZON 商品图片
    调用 OZON API /v1/product/pictures/import
    """
    product_id = prev_result["product_id"]
    image_urls = prev_result["image_urls"]
    shop_id = prev_result["shop_id"]

    logger.info(f"[Step 3] Updating product images: product_id={product_id}, count={len(image_urls)}")

    try:
        update_task_progress(
            parent_task_id, status="running", current_step="update_images",
            progress=55, step_details={"status": "running", "message": "正在更新商品图片..."}
        )

        if not image_urls:
            update_task_progress(
                parent_task_id, status="running", current_step="update_images",
                progress=75, step_details={"status": "skipped"}
            )
            return prev_result

        shop = get_shop_sync(shop_id)
        if not shop:
            raise ValueError("无法获取店铺信息")

        api_client = OzonAPIClient(
            client_id=shop.client_id, api_key=shop.api_key_enc, shop_id=shop.id
        )

        import_result = run_async_in_celery(
            api_client.import_product_pictures(product_id, image_urls)
        )

        if not import_result.get('result'):
            logger.warning(f"Image update failed: {import_result}, continuing...")
            update_task_progress(
                parent_task_id, status="running", current_step="update_images",
                progress=75, step_details={"status": "failed", "error": str(import_result)}
            )
            return prev_result

        ozon_task_id = import_result['result'].get('task_id')

        # 简化轮询 (最多 3 分钟)
        for _ in range(18):
            time.sleep(10)

        update_task_progress(
            parent_task_id, status="running", current_step="update_images",
            progress=75, step_details={"status": "completed", "ozon_task_id": ozon_task_id}
        )

        logger.info(f"[Step 3] Product images updated")
        return prev_result

    except Exception as e:
        logger.error(f"[Step 3] Failed: {e}", exc_info=True)
        logger.warning("Image update failed, continuing to stock update...")

        update_task_progress(
            parent_task_id, status="running", current_step="update_images",
            progress=75, step_details={"status": "failed", "error": str(e)}
        )
        return prev_result


@celery_app.task(bind=True, name="ef.ozon.quick_publish.update_stock", max_retries=3)
def update_product_stock_task(self, prev_result: Dict, dto_dict: Dict, shop_id: int, parent_task_id: str):
    """
    步骤 4: 更新库存
    调用 OZON API /v2/products/stocks
    """
    product_id = prev_result["product_id"]
    offer_id = prev_result["offer_id"]
    stock = dto_dict.get("stock", 0)
    warehouse_id = dto_dict.get("warehouse_id", 1)

    logger.info(f"[Step 4] Updating stock: product_id={product_id}, stock={stock}")

    try:
        update_task_progress(
            parent_task_id, status="running", current_step="update_stock",
            progress=80, step_details={"status": "running", "message": "正在更新库存..."}
        )

        shop = get_shop_sync(shop_id)
        if not shop:
            raise ValueError(f"店铺 {shop_id} 不存在")

        api_client = OzonAPIClient(
            client_id=shop.client_id, api_key=shop.api_key_enc, shop_id=shop.id
        )

        stocks = [{
            "offer_id": offer_id,
            "product_id": product_id,
            "stock": stock,
            "warehouse_id": warehouse_id
        }]

        result = run_async_in_celery(api_client.update_stocks(stocks))

        if not result.get('result'):
            raise ValueError(f"OZON API 错误: {result}")

        update_task_progress(
            parent_task_id, status="completed", current_step="update_stock",
            progress=100, step_details={"status": "completed", "stock": stock}
        )

        logger.info(f"[Step 4] Stock updated successfully")

        return {
            "success": True,
            "product_id": product_id,
            "offer_id": offer_id,
            "stock": stock,
            "stock_updated": True
        }

    except Exception as e:
        logger.error(f"[Step 4] Failed: {e}", exc_info=True)
        update_task_progress(
            parent_task_id, status="failed", current_step="update_stock",
            progress=80, step_details={"status": "failed", "error": str(e)},
            error=f"更新库存失败: {str(e)}"
        )
        raise self.retry(countdown=60, exc=e)
