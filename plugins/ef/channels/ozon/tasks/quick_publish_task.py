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
from ..services.image_storage_factory import ImageStorageFactory
from ..services.aliyun_oss_service import AliyunOssService
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
                    "update_price": {"status": "pending"},
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
    """
    获取激活的图片存储配置

    优先级（由 ImageStorageFactory 决定）:
    1. 启用且默认的阿里云 OSS
    2. 启用且默认的 Cloudinary
    3. 任何启用的阿里云 OSS
    4. 任何启用的 Cloudinary

    Returns:
        (storage_type, storage_service): 图床类型和服务实例
    """
    try:
        # 获取图床类型
        storage_type = await ImageStorageFactory.get_active_provider_type(db_session)
        if not storage_type:
            return (None, None)

        # 创建服务实例
        storage_service = await ImageStorageFactory.create_from_db(db_session)
        logger.info(f"Using image storage: {storage_type}")
        return (storage_type, storage_service)
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


def _map_position_to_aliyun_gravity(position: str) -> str:
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


def _build_aliyun_oss_watermark_url(base_url: str, watermark_config, position: Optional[str] = None) -> str:
    """
    构建阿里云OSS水印URL（使用x-oss-process参数）

    阿里云OSS支持通过URL参数实现云端水印处理，无需本地处理

    Args:
        base_url: 原图URL
        watermark_config: 水印配置
        position: 指定的水印位置

    Returns:
        带水印参数的完整URL

    Reference:
        https://help.aliyun.com/zh/oss/user-guide/add-watermarks
    """
    import base64
    from urllib.parse import urlparse, quote

    try:
        # 使用配置的第一个位置作为默认
        if position is None:
            position = watermark_config.positions[0] if watermark_config.positions else "bottom_right"

        # 获取水印图片URL并提取object key
        watermark_url = watermark_config.image_url
        parsed = urlparse(watermark_url)
        watermark_object_key = parsed.path.lstrip('/')  # 移除开头的 /

        # 水印图片添加resize参数
        # P_10 表示水印宽度为主图宽度的10%，高度等比缩放
        scale_percent = int(float(watermark_config.scale_ratio) * 100)  # 0.1 -> 10, 0.2 -> 20
        watermark_with_resize = f"{watermark_object_key}?x-oss-process=image/resize,P_{scale_percent}"

        # URL-safe Base64编码（+ → -, / → _, 去掉尾部=）
        watermark_base64 = base64.urlsafe_b64encode(watermark_with_resize.encode('utf-8')).decode('utf-8').rstrip('=')

        # 构建水印参数
        params = [
            "image/watermark",
            f"image_{watermark_base64}",
            f"t_{int(float(watermark_config.opacity) * 100)}",  # 透明度 0-100
            f"g_{_map_position_to_aliyun_gravity(position)}",  # 位置
            f"x_{watermark_config.margin_pixels}",  # X边距
            f"y_{watermark_config.margin_pixels}",  # Y边距
        ]

        # 拼接参数
        process_param = ",".join(params)

        # 构建完整URL
        separator = "&" if "?" in base_url else "?"
        watermark_url_final = f"{base_url}{separator}x-oss-process={quote(process_param)}"

        logger.info(f"Generated Aliyun OSS watermark URL with position {position}, scale P_{scale_percent}")
        return watermark_url_final

    except Exception as e:
        logger.error(f"Failed to build Aliyun OSS watermark URL: {e}")
        # 失败时返回原图URL
        return base_url


# ========== Celery 任务 ==========

@celery_app.task(bind=True, name="ef.ozon.quick_publish.chain", max_retries=3)
def quick_publish_chain_task(self, dto_dict: Dict, user_id: int, shop_id: int):
    """
    一键跟卖任务链 (协调器)

    流程:
    1. 上传图片到图床（添加水印，可选）
    2. 创建商品（直接用水印 URL）
    3. 更新库存

    注意: 不能在任务内部调用 result.get()，会导致死锁
    改为直接返回 chain，让 Celery 自动处理链的执行
    """
    task_id = self.request.id
    logger.info(f"Quick publish chain started: task_id={task_id}, shop_id={shop_id}")

    try:
        update_task_progress(task_id, status="running", current_step="upload_images", progress=0)

        task_chain = chain(
            # Step 1: 上传图片到图床（添加水印）
            upload_images_to_storage_task.si(dto_dict, shop_id, task_id),
            # Step 2: 创建商品（用水印 URL）
            create_product_task.s(dto_dict, user_id, shop_id, task_id),
            # Step 3: 更新库存
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
            task_id, status="failed", current_step="upload_images",
            progress=0, error=str(e)
        )
        raise self.retry(countdown=60, exc=e)


@celery_app.task(bind=True, name="ef.ozon.quick_publish.create_product", max_retries=3)
def create_product_task(self, prev_result: Dict, dto_dict: Dict, user_id: int, shop_id: int, parent_task_id: str):
    """
    步骤 2: 创建商品（完整商品数据，使用水印图片 URL）
    调用 OZON API /v3/product/import

    Args:
        prev_result: 图片上传结果，包含 image_urls 和 storage_type
    """
    # 从上一步获取处理后的图片 URL
    image_urls = prev_result.get("image_urls", [])
    storage_type = prev_result.get("storage_type", "none")

    logger.info(f"[Step 2] Creating product: offer_id={dto_dict.get('offer_id')}, images={len(image_urls)}, storage={storage_type}")

    try:
        update_task_progress(
            parent_task_id, status="running", current_step="create_product",
            progress=35, step_details={"status": "running", "message": "正在创建商品..."}
        )

        shop = get_shop_sync(shop_id)
        if not shop:
            raise ValueError(f"店铺 {shop_id} 不存在")

        logger.info(f"[Step 2] Shop info: shop_id={shop.id}, client_id={shop.client_id}")

        # 构建完整商品数据（/v3/product/import API）
        product_item = {
            "offer_id": dto_dict["offer_id"],
            "name": dto_dict.get("name", ""),
            "price": str(dto_dict.get("price", "0")),
            "currency_code": dto_dict.get("currency_code", "CNY"),
            "vat": dto_dict.get("vat", "0"),
        }
        # old_price 只在有值时添加
        if dto_dict.get("old_price"):
            product_item["old_price"] = str(dto_dict["old_price"])

        # type_id（必需，叶子类目）- OZON API 字段名为 type_id
        category_id = dto_dict.get("category_id")
        if not category_id:
            raise ValueError("category_id 是必需字段，无法创建商品")
        product_item["type_id"] = category_id

        # description_category_id（必需，父类目ID）- 从数据库查询
        description_category_id = dto_dict.get("description_category_id")
        if not description_category_id:
            # 查询父类目ID
            from ..models.listing import OzonCategory
            SessionLocal = get_sync_db_session()
            with SessionLocal() as db:
                category = db.query(OzonCategory).filter(OzonCategory.category_id == category_id).first()
                if category and category.parent_id:
                    description_category_id = category.parent_id
                    logger.info(f"[Step 2] 从数据库获取父类目ID: {description_category_id}")
                else:
                    raise ValueError(f"类目 {category_id} 无父类目ID，无法创建商品")
        product_item["description_category_id"] = description_category_id

        # dimensions（必需）- 转换为 OZON v3 API 格式
        raw_dims = dto_dict.get("dimensions")
        if raw_dims:
            # 浏览器扩展传递格式: {weight, height, width, length}
            # OZON API 需要格式: {depth, height, width, weight, dimension_unit, weight_unit}
            product_item["depth"] = raw_dims.get("length") or raw_dims.get("depth", 0)
            product_item["height"] = raw_dims.get("height", 0)
            product_item["width"] = raw_dims.get("width", 0)
            product_item["weight"] = raw_dims.get("weight", 0)
            product_item["dimension_unit"] = "mm"
            product_item["weight_unit"] = "g"
            logger.info(f"[Step 2] 尺寸: depth={product_item['depth']}, height={product_item['height']}, width={product_item['width']}, weight={product_item['weight']}")
        else:
            raise ValueError("dimensions 是必需字段，无法创建商品")

        # attributes（必需）- 转换为 OZON v3 API 格式
        # 浏览器扩展采集时保存了 key/name，需要根据 name 查找真实的 attribute_id
        raw_attributes = dto_dict.get("attributes", [])
        formatted_attributes = []

        # 预先查询该类目的所有属性，用于 name -> attribute_id 映射
        from ..models.listing import OzonCategoryAttribute
        SessionLocal = get_sync_db_session()
        attr_name_to_id = {}
        with SessionLocal() as db:
            category_attrs = db.query(OzonCategoryAttribute).filter(
                OzonCategoryAttribute.category_id == category_id
            ).all()
            for ca in category_attrs:
                # 支持中文名和俄文名查找
                if ca.name:
                    attr_name_to_id[ca.name] = ca.attribute_id
                if ca.name_zh:
                    attr_name_to_id[ca.name_zh] = ca.attribute_id
                if ca.name_ru:
                    attr_name_to_id[ca.name_ru] = ca.attribute_id
            logger.info(f"[Step 2] 加载类目 {category_id} 的 {len(category_attrs)} 个属性映射")

        for attr in raw_attributes:
            # 原格式: {"attribute_id": xxx, "value": "..."} 或 {"id": xxx, "values": [...]}
            if "values" in attr:
                # 已经是正确格式
                formatted_attributes.append(attr)
            else:
                # 获取 attribute_id：如果是 0 或不存在，尝试通过 name 查找
                attr_id = attr.get("attribute_id") or attr.get("id") or 0
                if attr_id == 0 and attr.get("name"):
                    # 根据属性名查找真实 ID
                    attr_id = attr_name_to_id.get(attr["name"], 0)
                    if attr_id:
                        logger.info(f"[Step 2] 属性名 '{attr['name']}' -> attribute_id={attr_id}")
                    else:
                        logger.warning(f"[Step 2] 无法找到属性 '{attr['name']}' 的 ID，跳过")
                        continue

                if not attr_id:
                    logger.warning(f"[Step 2] 属性缺少有效 ID，跳过: {attr}")
                    continue

                # 转换为正确格式
                formatted_attr = {
                    "id": attr_id,
                    "complex_id": attr.get("complex_id", 0),
                    "values": [{"value": str(attr.get("value", ""))}]
                }
                # 如果有 dictionary_value_id，也添加
                if attr.get("dictionary_value_id"):
                    formatted_attr["values"][0]["dictionary_value_id"] = attr["dictionary_value_id"]
                formatted_attributes.append(formatted_attr)

        # 自动添加型号名称（attribute_id: 9048）- 使用 offer_id 作为默认值
        existing_attr_ids = {attr.get("id") for attr in formatted_attributes}
        if 9048 not in existing_attr_ids:
            model_name_attr = {
                "id": 9048,
                "complex_id": 0,
                "values": [{"value": dto_dict.get("offer_id", "DEFAULT")}]
            }
            formatted_attributes.append(model_name_attr)
            logger.info(f"[Step 2] 自动添加型号名称: {dto_dict.get('offer_id')}")

        product_item["attributes"] = formatted_attributes
        logger.info(f"[Step 2] 最终属性数量: {len(formatted_attributes)}")

        # 可选字段
        if dto_dict.get("description"):
            product_item["description"] = dto_dict["description"]
        if dto_dict.get("brand"):
            product_item["brand"] = dto_dict["brand"]
        if dto_dict.get("barcode"):
            product_item["barcode"] = dto_dict["barcode"]

        # 图片（使用 Step 1 处理后的水印图片 URL）
        # OZON API 支持 primary_image（主图）和 images（其他图片，最多14张）
        if image_urls:
            # 第一张作为主图
            product_item["primary_image"] = image_urls[0]
            # 其余作为附图（最多14张）
            if len(image_urls) > 1:
                product_item["images"] = image_urls[1:15]
            logger.info(f"[Step 2] 图片: primary_image={image_urls[0][:50]}..., 附图数量={len(image_urls)-1}")

        # 只提交创建请求，不轮询（轮询在 Step 3 中进行）
        async def submit_import():
            """提交商品创建请求（不等待完成）"""
            api_client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            logger.info(f"[Step 2] Calling OZON API /v3/product/import with data: {product_item}")
            import_result = await api_client.import_products([product_item])
            logger.info(f"[Step 2] OZON API response: {import_result}")

            if not import_result.get('result'):
                raise ValueError(f"OZON API 错误: {import_result}")

            ozon_task_id = import_result['result'].get('task_id')
            logger.info(f"[Step 2] OZON import task created: {ozon_task_id}")

            return ozon_task_id

        ozon_task_id = run_async_in_celery(submit_import())

        update_task_progress(
            parent_task_id, status="running", current_step="create_product",
            progress=50, step_details={"status": "submitted", "ozon_task_id": ozon_task_id}
        )

        logger.info(f"[Step 2] Import task submitted: ozon_task_id={ozon_task_id}")

        # 返回 ozon_task_id，由 Step 3 轮询等待完成
        return {
            "ozon_task_id": ozon_task_id,
            "offer_id": dto_dict["offer_id"],
            "shop_id": shop_id
        }

    except Exception as e:
        logger.error(f"[Step 2] Failed: {e}", exc_info=True)
        update_task_progress(
            parent_task_id, status="failed", current_step="create_product",
            progress=35, step_details={"status": "failed", "error": str(e)},
            error=f"创建商品失败: {str(e)}"
        )
        raise self.retry(countdown=60, exc=e)


@celery_app.task(bind=True, name="ef.ozon.quick_publish.upload_images", max_retries=3)
def upload_images_to_storage_task(self, dto_dict: Dict, shop_id: int, parent_task_id: str):
    """
    步骤 1: 上传图片到图床 (Cloudinary/Aliyun OSS)
    从 OZON URLs 下载并上传到激活的图片存储，添加水印
    """
    ozon_image_urls = dto_dict.get("images", [])
    offer_id = dto_dict.get("offer_id", "unknown")

    logger.info(f"[Step 1] Uploading images: offer_id={offer_id}, count={len(ozon_image_urls)}")

    try:
        update_task_progress(
            parent_task_id, status="running", current_step="upload_images",
            progress=5, step_details={"status": "running", "total": len(ozon_image_urls), "uploaded": 0}
        )

        if not ozon_image_urls:
            logger.warning("No images to upload")
            return {"image_urls": [], "storage_type": "none"}

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
                cloudinary_transformations = None
                if watermark_config and storage_type == "cloudinary":
                    cloudinary_transformations = _build_watermark_transformation(watermark_config)
                    logger.info(f"Cloudinary watermark transformation prepared: {watermark_config.name}")
                elif watermark_config and storage_type == "aliyun_oss":
                    logger.info(f"Aliyun OSS watermark config: {watermark_config.name} (will apply via URL params)")

                tasks = []
                for idx, ozon_url in enumerate(ozon_image_urls):
                    public_id = f"{shop_id}_{offer_id}_{idx}_{int(time.time())}"
                    folder = f"{storage_service.product_images_folder or 'products'}/{shop_id}/quick_publish"

                    if storage_type == "cloudinary":
                        task = storage_service.upload_image_from_url(
                            image_url=ozon_url,
                            public_id=public_id,
                            folder=folder,
                            transformations=cloudinary_transformations  # 应用水印转换
                        )
                    else:
                        # 阿里云 OSS：先上传原图，水印通过 URL 参数添加
                        task = storage_service.upload_image_from_url(
                            image_url=ozon_url,
                            public_id=public_id,
                            folder=folder
                        )

                    tasks.append(task)

                results = await asyncio.gather(*tasks, return_exceptions=True)

                uploaded = []
                for idx, result in enumerate(results):
                    if isinstance(result, Exception):
                        logger.error(f"Image {idx} upload failed: {result}")
                        uploaded.append(ozon_image_urls[idx])
                    elif result.get('success'):
                        base_url = result['url']
                        # 阿里云 OSS 水印通过 URL 参数添加
                        if storage_type == "aliyun_oss" and watermark_config:
                            watermarked_url = _build_aliyun_oss_watermark_url(base_url, watermark_config)
                            uploaded.append(watermarked_url)
                            logger.info(f"Image {idx} uploaded with OSS watermark URL")
                        else:
                            uploaded.append(base_url)
                    else:
                        logger.error(f"Image {idx} upload failed: {result.get('error')}")
                        uploaded.append(ozon_image_urls[idx])

                    progress = 5 + int((idx + 1) / len(ozon_image_urls) * 25)
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
            progress=30, step_details={
                "status": "completed", "total": len(ozon_image_urls),
                "uploaded": len(uploaded_urls), "storage_type": storage_type
            }
        )

        logger.info(f"[Step 1] Images uploaded: count={len(uploaded_urls)}, storage={storage_type}")

        return {"image_urls": uploaded_urls, "storage_type": storage_type}

    except Exception as e:
        logger.error(f"[Step 1] Failed: {e}", exc_info=True)
        logger.warning("Image upload failed, using original URLs as fallback")

        update_task_progress(
            parent_task_id, status="running", current_step="upload_images",
            progress=30, step_details={"status": "fallback", "error": str(e), "fallback_urls": ozon_image_urls}
        )

        return {"image_urls": ozon_image_urls, "storage_type": "fallback"}


@celery_app.task(bind=True, name="ef.ozon.quick_publish.update_price", max_retries=3)
def update_product_price_task(self, prev_result: Dict, dto_dict: Dict, shop_id: int, parent_task_id: str):
    """
    （已废弃）跳过价格更新（价格已在 import 时设置）
    """
    product_id = prev_result["product_id"]
    price = dto_dict.get("price")

    logger.info(f"跳过价格更新（已在import时设置）: product_id={product_id}, price={price}")

    update_task_progress(
        parent_task_id, status="running", current_step="update_price",
        progress=75, step_details={"status": "skipped", "message": "价格已在创建时设置"}
    )

    return prev_result


@celery_app.task(bind=True, name="ef.ozon.quick_publish.update_price_legacy", max_retries=3)
def update_product_price_task_legacy(self, prev_result: Dict, dto_dict: Dict, shop_id: int, parent_task_id: str):
    """
    步骤 4 (旧版): 更新商品价格
    调用 OZON API /v1/product/import/prices
    """
    product_id = prev_result["product_id"]
    offer_id = prev_result["offer_id"]
    price = dto_dict.get("price")
    old_price = dto_dict.get("old_price")
    currency_code = dto_dict.get("currency_code", "CNY")

    logger.info(f"[Step 4] Updating price: product_id={product_id}, price={price}, old_price={old_price}, currency={currency_code}")

    try:
        update_task_progress(
            parent_task_id, status="running", current_step="update_price",
            progress=65, step_details={"status": "running", "message": "正在更新价格..."}
        )

        if not price:
            logger.warning("No price provided, skipping price update")
            update_task_progress(
                parent_task_id, status="running", current_step="update_price",
                progress=75, step_details={"status": "skipped", "message": "未提供价格"}
            )
            return prev_result

        shop = get_shop_sync(shop_id)
        if not shop:
            raise ValueError(f"店铺 {shop_id} 不存在")

        api_client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop.id
        )

        # 构建价格更新数据
        price_data = {
            "product_id": product_id,
            "offer_id": offer_id,
            "price": str(price),
            "currency_code": currency_code,
        }

        # 添加原价（如果有）
        if old_price:
            price_data["old_price"] = str(old_price)

        logger.info(f"[Step 4] Calling OZON API update_prices with data: {price_data}")

        result = run_async_in_celery(api_client.update_prices([price_data]))

        if not result.get('result'):
            logger.warning(f"Price update failed: {result}, continuing...")
            update_task_progress(
                parent_task_id, status="running", current_step="update_price",
                progress=75, step_details={"status": "failed", "error": str(result)}
            )
            return prev_result

        update_task_progress(
            parent_task_id, status="running", current_step="update_price",
            progress=75, step_details={
                "status": "completed",
                "price": str(price),
                "old_price": str(old_price) if old_price else None,
                "currency": currency_code
            }
        )

        logger.info(f"[Step 4] Price updated successfully: {price} {currency_code}")
        return prev_result

    except Exception as e:
        logger.error(f"[Step 4] Failed: {e}", exc_info=True)
        logger.warning("Price update failed, continuing to stock update...")

        update_task_progress(
            parent_task_id, status="running", current_step="update_price",
            progress=75, step_details={"status": "failed", "error": str(e)}
        )
        return prev_result


@celery_app.task(bind=True, name="ef.ozon.quick_publish.update_stock", max_retries=3)
def update_product_stock_task(self, prev_result: Dict, dto_dict: Dict, shop_id: int, parent_task_id: str):
    """
    步骤 3: 轮询商品创建状态 + 更新库存

    流程:
    1. 轮询 /v1/product/import/info 等待商品创建完成（每30秒，最多20分钟）
    2. 如果创建成功，获取 product_id 并更新库存
    3. 如果创建失败，记录错误并结束
    """
    ozon_task_id = prev_result.get("ozon_task_id")
    offer_id = prev_result["offer_id"]
    stock = dto_dict.get("stock", 0)
    # 支持 warehouse_ids（列表）和 warehouse_id（单个值）
    warehouse_ids = dto_dict.get("warehouse_ids", [])
    if warehouse_ids and isinstance(warehouse_ids, list):
        warehouse_id = warehouse_ids[0]  # 使用第一个仓库
    else:
        warehouse_id = dto_dict.get("warehouse_id", 1)

    logger.info(f"[Step 3] Waiting for product creation: ozon_task_id={ozon_task_id}, warehouse_id={warehouse_id}, stock={stock}")

    try:
        update_task_progress(
            parent_task_id, status="running", current_step="update_stock",
            progress=55, step_details={"status": "polling", "message": "等待商品创建完成..."}
        )

        shop = get_shop_sync(shop_id)
        if not shop:
            raise ValueError(f"店铺 {shop_id} 不存在")

        # 轮询等待商品创建完成（每30秒，最多20分钟 = 40次）
        async def poll_and_update_stock():
            api_client = OzonAPIClient(
                client_id=shop.client_id, api_key=shop.api_key_enc, shop_id=shop.id
            )

            import asyncio as async_lib
            product_id = None
            max_attempts = 40  # 40 * 30秒 = 20分钟
            poll_interval = 30  # 每30秒查询一次

            for attempt in range(max_attempts):
                logger.info(f"[Step 3] Polling attempt {attempt + 1}/{max_attempts}")

                status_result = await api_client.get_import_product_info(ozon_task_id)

                if status_result.get('result'):
                    items = status_result['result'].get('items', [])
                    if items:
                        item = items[0]
                        item_status = item.get('status')

                        if item_status == 'imported':
                            product_id = item.get('product_id')
                            logger.info(f"[Step 3] Product created: product_id={product_id}")
                            break
                        elif item_status == 'failed':
                            errors = item.get('errors', [])
                            error_msg = '; '.join([e.get('message', '') for e in errors])
                            raise ValueError(f"商品创建失败: {error_msg}")
                        else:
                            logger.info(f"[Step 3] Status: {item_status}, waiting...")

                # 更新进度（55% -> 90%）
                progress = 55 + int((attempt + 1) / max_attempts * 35)
                update_task_progress(
                    parent_task_id, status="running", current_step="update_stock",
                    progress=progress, step_details={
                        "status": "polling",
                        "attempt": attempt + 1,
                        "max_attempts": max_attempts,
                        "message": f"等待商品创建完成 ({attempt + 1}/{max_attempts})..."
                    }
                )

                await async_lib.sleep(poll_interval)

            if not product_id:
                raise TimeoutError("商品创建超时 (20 分钟)")

            # 商品创建成功，更新库存
            logger.info(f"[Step 3] Updating stock: product_id={product_id}, stock={stock}")

            update_task_progress(
                parent_task_id, status="running", current_step="update_stock",
                progress=92, step_details={"status": "updating_stock", "product_id": product_id}
            )

            stocks = [{
                "offer_id": offer_id,
                "product_id": product_id,
                "stock": stock,
                "warehouse_id": warehouse_id
            }]

            result = await api_client.update_stocks(stocks)

            if not result.get('result'):
                raise ValueError(f"更新库存失败: {result}")

            return product_id

        product_id = run_async_in_celery(poll_and_update_stock())

        update_task_progress(
            parent_task_id, status="completed", current_step="update_stock",
            progress=100, step_details={"status": "completed", "product_id": product_id, "stock": stock}
        )

        logger.info(f"[Step 3] Stock updated successfully: product_id={product_id}")

        return {
            "success": True,
            "product_id": product_id,
            "offer_id": offer_id,
            "stock": stock,
            "stock_updated": True
        }

    except ValueError as e:
        # 商品创建失败，不重试
        logger.error(f"[Step 3] Product creation failed: {e}")
        update_task_progress(
            parent_task_id, status="failed", current_step="update_stock",
            progress=55, step_details={"status": "failed", "error": str(e)},
            error=str(e)
        )
        # 不抛出异常，不重试
        return {
            "success": False,
            "offer_id": offer_id,
            "error": str(e)
        }

    except TimeoutError as e:
        # 超时，不重试
        logger.error(f"[Step 3] Timeout: {e}")
        update_task_progress(
            parent_task_id, status="failed", current_step="update_stock",
            progress=90, step_details={"status": "timeout", "error": str(e)},
            error=str(e)
        )
        return {
            "success": False,
            "offer_id": offer_id,
            "error": str(e)
        }

    except Exception as e:
        logger.error(f"[Step 3] Failed: {e}", exc_info=True)
        update_task_progress(
            parent_task_id, status="failed", current_step="update_stock",
            progress=55, step_details={"status": "failed", "error": str(e)},
            error=f"更新库存失败: {str(e)}"
        )
        raise self.retry(countdown=60, exc=e)
