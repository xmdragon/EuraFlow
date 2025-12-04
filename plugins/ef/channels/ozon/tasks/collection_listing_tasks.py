"""
Celery 任务：采集记录上架任务
"""
import asyncio
import logging
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

from decimal import Decimal

from ef_core.tasks.celery_app import celery_app
from ef_core.config import get_settings
from sqlalchemy import select, create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from ..models.collection_record import OzonProductCollectionRecord
from ..models import OzonShop

logger = logging.getLogger(__name__)


def run_async_in_celery(coro):
    """
    在 Celery 任务中安全执行异步函数
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
    except RuntimeError:
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
    """创建同步数据库会话"""
    settings = get_settings()
    sync_db_url = settings.database_url.replace('+asyncpg', '')
    engine = create_engine(sync_db_url, pool_pre_ping=True, pool_recycle=3600)
    return sessionmaker(bind=engine)


@celery_app.task(name="ef.ozon.collection.process_follow_pdp")
def process_follow_pdp_listing(record_id: int) -> dict:
    """
    处理跟卖上架任务（异步执行）

    流程：
    1. 查询采集记录
    2. 获取上架参数（变体、图片、仓库等）
    3. 翻译标题（中文→俄文）
    4. 为每个变体创建 quick_publish_chain_task 任务
    5. 更新记录状态

    Args:
        record_id: 采集记录ID

    Returns:
        任务结果字典
    """
    logger.info(f"[CollectionListing] 开始处理跟卖上架任务 record_id={record_id}")

    SessionLocal = get_sync_db_session()

    with SessionLocal() as db:
        # 1. 查询记录
        record = db.query(OzonProductCollectionRecord).filter(
            OzonProductCollectionRecord.id == record_id,
            OzonProductCollectionRecord.collection_type == "follow_pdp",
            OzonProductCollectionRecord.is_deleted == False
        ).first()

        if not record:
            logger.error(f"[CollectionListing] 记录不存在 record_id={record_id}")
            return {"success": False, "error": "记录不存在"}

        # 更新状态为 processing
        record.listing_status = "processing"
        db.commit()

        try:
            # 2. 获取上架参数
            listing_payload = record.listing_request_payload or {}
            shop_id = record.shop_id
            user_id = record.user_id

            if not shop_id:
                raise ValueError("店铺ID不能为空")

            # 获取店铺信息
            shop = db.query(OzonShop).filter(OzonShop.id == shop_id).first()
            if not shop:
                raise ValueError(f"店铺 {shop_id} 不存在")

            logger.info(f"[CollectionListing] 店铺验证通过: {shop.shop_name}")

            # 3. 获取变体列表
            variants = listing_payload.get("variants", [])
            if not variants:
                raise ValueError("变体列表为空")

            logger.info(f"[CollectionListing] 变体数量: {len(variants)}")

            # 4. 异步翻译和准备变体数据
            async def prepare_variants():
                """异步处理变体翻译和数据准备（不触发 Celery 任务）"""
                from ..services.translation_factory import TranslationFactory
                from ..models.listing import OzonCategory

                settings = get_settings()
                async_engine = create_async_engine(settings.database_url, pool_pre_ping=True)
                AsyncSession = async_sessionmaker(async_engine, expire_on_commit=False)

                async with AsyncSession() as async_db:
                    # 从 "Тип" 属性值查找类目ID（不使用采集的 category_id，因为它是页面跟踪ID而非API的type_id）
                    valid_category_id = None
                    attributes = listing_payload.get("attributes", [])

                    for attr in attributes:
                        attr_value = attr.get("value", "")
                        if attr_value:
                            # 尝试通过 name_ru 查找类目
                            result = await async_db.execute(
                                select(OzonCategory).where(
                                    OzonCategory.name_ru == attr_value,
                                    OzonCategory.is_leaf == True
                                )
                            )
                            found_category = result.scalar_one_or_none()
                            if found_category:
                                valid_category_id = found_category.category_id
                                logger.info(f"[CollectionListing] 从属性 '{attr_value}' 找到类目: {valid_category_id} ({found_category.name})")
                                break

                    if not valid_category_id:
                        attr_values = [a.get("value", "") for a in attributes[:5]]
                        raise ValueError(f"无法从属性中找到有效的类目ID。属性值: {attr_values}")

                    logger.info(f"[CollectionListing] 使用类目ID: {valid_category_id}")

                    # 匹配属性值到字典 value_id
                    from ..services.catalog_service import match_attribute_values
                    matched_attributes = await match_attribute_values(
                        db=async_db,
                        category_id=valid_category_id,
                        attributes=attributes
                    )
                    logger.info(f"[CollectionListing] 属性匹配完成: {len(matched_attributes)} 个属性")

                    # 初始化翻译服务
                    translation_service = None
                    try:
                        translation_service = await TranslationFactory.create_from_db(async_db)
                    except Exception as e:
                        logger.warning(f"[CollectionListing] 翻译服务初始化失败: {e}")

                    # 翻译描述
                    description = listing_payload.get("description", "")
                    russian_description = description
                    if translation_service and description:
                        try:
                            if any('\u4e00' <= char <= '\u9fff' for char in description):
                                russian_description = await translation_service.translate_text(description, target_lang='ru')
                                logger.info("[CollectionListing] 描述翻译完成")
                        except Exception as e:
                            logger.warning(f"[CollectionListing] 描述翻译失败: {e}")

                    # 为每个变体准备数据
                    variant_dtos = []
                    for idx, variant in enumerate(variants):
                        # 获取变体名称
                        variant_name = variant.get("name", "") or listing_payload.get("title", "")
                        russian_name = variant_name

                        # 翻译变体名称
                        if translation_service and variant_name:
                            try:
                                if any('\u4e00' <= char <= '\u9fff' for char in variant_name):
                                    russian_name = await translation_service.translate_text(variant_name, target_lang='ru')
                                    logger.info(f"[CollectionListing] 变体名称翻译: {variant_name[:30]}... -> {russian_name[:30]}...")
                            except Exception as e:
                                logger.warning(f"[CollectionListing] 变体名称翻译失败: {e}")

                        # 获取图片列表
                        # 每个变体有独立的 images 数组（不再使用共享的顶层 images）
                        variant_images = variant.get("images", [])

                        # 转换图片格式（如果是对象数组，提取 URL）
                        image_urls = []
                        for img in variant_images:
                            if isinstance(img, str):
                                image_urls.append(img)
                            elif isinstance(img, dict) and img.get("url"):
                                image_urls.append(img["url"])

                        # Fallback: 如果没有 images 数组，使用 primary_image
                        if not image_urls:
                            primary_image = variant.get("primary_image")
                            if primary_image:
                                image_urls.append(primary_image)
                                logger.info(f"[CollectionListing] 使用 primary_image 作为唯一图片: {primary_image[:50]}...")

                        # 价格转换：浏览器扩展传入的是分，需要转换为元
                        price_fen = variant.get("price", 0) or 0
                        price_yuan = Decimal(str(price_fen)) / 100  # 分 → 元
                        old_price_fen = variant.get("old_price")
                        old_price_yuan = Decimal(str(old_price_fen)) / 100 if old_price_fen else None

                        # 构建完整商品数据（用于 /v3/product/import API）
                        variant_dto = {
                            # 基础信息
                            "shop_id": shop_id,
                            "warehouse_id": listing_payload.get("warehouse_id"),
                            "watermark_config_id": listing_payload.get("watermark_config_id"),

                            # 变体特有字段
                            "name": russian_name,
                            "offer_id": variant.get("offer_id", f"follow_{record_id}_{idx}_{int(time.time())}"),
                            "sku": variant.get("sku", variant.get("offer_id", "")),
                            "price": str(price_yuan),
                            "stock": variant.get("stock", 10),
                            "old_price": str(old_price_yuan) if old_price_yuan else None,
                            "primary_image": variant.get("primary_image") or (image_urls[0] if image_urls else None),

                            # 共享字段
                            "description": russian_description,
                            "category_id": valid_category_id,  # 使用验证后的类目ID
                            "brand": listing_payload.get("brand", ""),
                            "barcode": listing_payload.get("barcode", ""),

                            # 尺寸
                            "dimensions": listing_payload.get("dimensions"),

                            # 图片和视频
                            "images": image_urls,
                            "videos": listing_payload.get("videos", []),

                            # 类目特征（使用匹配后的属性）
                            "attributes": matched_attributes,

                            # OZON API 必需字段
                            "vat": "0",
                            "currency_code": "CNY",
                        }

                        variant_dtos.append(variant_dto)
                        logger.info(f"[CollectionListing] 变体 {idx+1}/{len(variants)} 数据准备完成")

                    return variant_dtos

            # 执行异步处理（仅准备数据，不触发任务）
            variant_dtos = run_async_in_celery(prepare_variants())

            # 5. 在同步上下文中触发 Celery 任务（避免异步上下文中的连接问题）
            from ..tasks.quick_publish_task import quick_publish_chain_task

            task_ids = []
            for idx, variant_dto in enumerate(variant_dtos):
                # 生成唯一任务ID
                task_id = f"follow_pdp_{shop_id}_{record_id}_{idx}_{int(time.time() * 1000)}"

                # 触发 Celery 任务（在同步上下文中）
                result = quick_publish_chain_task.apply_async(
                    args=[variant_dto, user_id, shop_id],
                    task_id=task_id
                )

                task_ids.append(task_id)
                logger.info(f"[CollectionListing] 变体 {idx+1}/{len(variant_dtos)} Celery任务已触发: task_id={task_id}, celery_result_id={result.id}")

            # 6. 更新记录状态
            record.listing_status = "success"
            record.listing_error_message = None
            # 保存所有任务ID（逗号分隔）
            if task_ids:
                record.listing_task_id = ",".join(task_ids)
            db.commit()

            logger.info(f"[CollectionListing] 上架任务创建成功 record_id={record_id}, task_count={len(task_ids)}")

            return {
                "success": True,
                "record_id": record_id,
                "task_ids": task_ids,
                "task_count": len(task_ids),
                "status": "success"
            }

        except Exception as e:
            logger.error(f"[CollectionListing] 上架失败 record_id={record_id}", exc_info=True)

            # 更新状态为 failed
            record.listing_status = "failed"
            record.listing_error_message = str(e)
            db.commit()

            return {
                "success": False,
                "record_id": record_id,
                "error": str(e)
            }


@celery_app.task(name="ef.ozon.collection.poll_listing_status")
def poll_listing_status() -> dict:
    """
    定期轮询上架状态（Cron任务）

    检查所有 pending/processing 状态的跟卖记录，
    查询 OZON API 获取最新状态并更新数据库

    Returns:
        处理结果统计
    """
    logger.info("[CollectionListing] 开始轮询上架状态")

    processed_count = 0
    success_count = 0
    failed_count = 0

    SessionLocal = get_sync_db_session()
    with SessionLocal() as db:
        # 查询所有待处理的记录（24小时内创建）
        cutoff_time = datetime.utcnow() - timedelta(hours=24)

        stmt = select(OzonProductCollectionRecord).where(
            OzonProductCollectionRecord.collection_type == "follow_pdp",
            OzonProductCollectionRecord.listing_status.in_(["pending", "processing"]),
            OzonProductCollectionRecord.is_deleted == False,
            OzonProductCollectionRecord.created_at >= cutoff_time
        )

        records = db.execute(stmt).scalars().all()

        logger.info(f"[CollectionListing] 找到 {len(records)} 条待处理记录")

        for record in records:
            try:
                processed_count += 1

                # 超过1小时的记录标记为超时失败
                if (datetime.utcnow() - record.created_at).total_seconds() > 3600:
                    record.listing_status = "failed"
                    record.listing_error_message = "上架超时"
                    failed_count += 1
                    logger.warning(f"[CollectionListing] 记录超时 record_id={record.id}")

                db.commit()

            except Exception as e:
                logger.error(f"[CollectionListing] 处理记录失败 record_id={record.id}", exc_info=True)
                failed_count += 1

        db.commit()

    result = {
        "processed": processed_count,
        "success": success_count,
        "failed": failed_count
    }

    logger.info(f"[CollectionListing] 轮询完成: {result}")
    return result
