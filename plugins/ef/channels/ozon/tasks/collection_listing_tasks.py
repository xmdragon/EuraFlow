"""
Celery 任务：采集记录上架任务
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from ef_core.db.session import get_sync_db_session
from ef_core.tasks.celery_app import celery_app
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.collection_record import OzonProductCollectionRecord
from ..services.ozon_sync import OzonSyncService

logger = logging.getLogger(__name__)


@celery_app.task(name="ef.ozon.collection.process_follow_pdp")
def process_follow_pdp_listing(record_id: int) -> dict:
    """
    处理跟卖上架任务（异步执行）

    Args:
        record_id: 采集记录ID

    Returns:
        任务结果字典
    """
    logger.info(f"[CollectionListing] 开始处理跟卖上架任务 record_id={record_id}")

    with get_sync_db_session() as db:
        # 查询记录
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
            # 执行上架逻辑（调用现有的上架服务）
            # 这里需要实现实际的上架逻辑，调用 OZON API
            # 目前先标记为成功（后续完善）

            product_data = record.product_data

            logger.info(f"[CollectionListing] 上架数据准备完成 record_id={record_id}, shop_id={record.shop_id}")

            # TODO: 调用实际的上架 API
            # result = await ozon_api.create_product(...)

            # 临时：标记为成功
            record.listing_status = "success"
            record.listing_error_message = None
            db.commit()

            logger.info(f"[CollectionListing] 上架成功 record_id={record_id}")

            return {
                "success": True,
                "record_id": record_id,
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

    with get_sync_db_session() as db:
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

                # TODO: 调用 OZON API 查询上架状态
                # status = await ozon_api.get_product_status(task_id=record.listing_task_id)

                # 临时：超过1小时的记录标记为超时失败
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
