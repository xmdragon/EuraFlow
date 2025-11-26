"""
标签预缓存定时任务

定时扫描待打印的订单，预先下载标签PDF到本地缓存
这样用户打印时可以直接读取本地文件，无需等待 OZON API 响应
"""
import os
import asyncio
import logging
from typing import List, Dict, Any

from ef_core.tasks.celery_app import celery_app
from ef_core.database import get_task_db_manager
from sqlalchemy import select, and_

logger = logging.getLogger(__name__)


# 配置参数
BATCH_SIZE = 50  # 每次最多处理的订单数
DELAY_BETWEEN_REQUESTS = 0.5  # 请求间隔（秒），避免 API 限流


@celery_app.task(bind=True, name="ef.ozon.labels.prefetch")
def prefetch_labels_task(self):
    """
    标签预缓存定时任务

    扫描所有待打印（awaiting_deliver + tracking_confirmed）且未缓存标签的订单，
    预先下载标签 PDF 到本地。
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        result = loop.run_until_complete(_prefetch_labels_async())
        return result
    finally:
        loop.close()
        asyncio.set_event_loop(None)


async def _prefetch_labels_async() -> Dict[str, Any]:
    """异步执行标签预缓存"""
    from ..models import OzonShop, OzonPosting
    from ..api.client import OzonAPIClient
    from ..services.label_service import LabelService

    db_manager = get_task_db_manager()

    total_processed = 0
    total_success = 0
    total_skipped = 0
    total_failed = 0
    shop_results = []

    async with db_manager.get_session() as db:
        # 1. 查找所有需要预缓存的 posting
        # 条件：awaiting_deliver + tracking_confirmed + 无缓存
        result = await db.execute(
            select(OzonPosting)
            .where(
                and_(
                    OzonPosting.status == 'awaiting_deliver',
                    OzonPosting.operation_status == 'tracking_confirmed',
                    # 没有缓存路径，或者路径为空
                    (OzonPosting.label_pdf_path.is_(None)) | (OzonPosting.label_pdf_path == '')
                )
            )
            .order_by(OzonPosting.created_at.desc())
            .limit(BATCH_SIZE)
        )
        postings = result.scalars().all()

        if not postings:
            logger.info("标签预缓存: 没有需要缓存的订单")
            return {
                "success": True,
                "message": "没有需要缓存的订单",
                "total_processed": 0
            }

        logger.info(f"标签预缓存: 找到 {len(postings)} 个需要缓存的订单")

        # 2. 按店铺分组
        shop_postings: Dict[int, List[OzonPosting]] = {}
        for posting in postings:
            if posting.shop_id not in shop_postings:
                shop_postings[posting.shop_id] = []
            shop_postings[posting.shop_id].append(posting)

        # 3. 获取店铺信息
        shop_ids = list(shop_postings.keys())
        shops_result = await db.execute(
            select(OzonShop).where(OzonShop.id.in_(shop_ids))
        )
        shops = {shop.id: shop for shop in shops_result.scalars().all()}

        # 4. 按店铺处理
        label_service = LabelService(db)

        for shop_id, shop_posting_list in shop_postings.items():
            shop = shops.get(shop_id)
            if not shop:
                logger.warning(f"标签预缓存: 店铺 {shop_id} 不存在，跳过")
                total_skipped += len(shop_posting_list)
                continue

            shop_success = 0
            shop_failed = 0
            shop_skipped = 0

            try:
                async with OzonAPIClient(shop.client_id, shop.api_key_enc, shop.id) as client:
                    for posting in shop_posting_list:
                        total_processed += 1

                        # 再次检查文件是否存在（可能其他进程已下载）
                        expected_path = LabelService.get_label_path(posting.posting_number)
                        if os.path.exists(expected_path):
                            # 更新数据库记录
                            posting.label_pdf_path = expected_path
                            shop_skipped += 1
                            logger.debug(f"标签已存在，更新记录: {posting.posting_number}")
                            continue

                        try:
                            # 下载标签
                            download_result = await label_service.download_and_save_label(
                                posting_number=posting.posting_number,
                                api_client=client,
                                force=False
                            )

                            if download_result["success"]:
                                shop_success += 1
                                logger.info(f"预缓存成功: {posting.posting_number}")
                            else:
                                shop_failed += 1
                                logger.warning(
                                    f"预缓存失败: {posting.posting_number}, "
                                    f"错误: {download_result.get('error')}"
                                )

                        except Exception as e:
                            shop_failed += 1
                            error_msg = str(e)
                            # 如果是"标签未就绪"错误，降低日志级别
                            if "aren't ready" in error_msg.lower() or "not ready" in error_msg.lower():
                                logger.debug(f"标签未就绪，稍后重试: {posting.posting_number}")
                            else:
                                logger.warning(f"预缓存异常: {posting.posting_number}, 错误: {error_msg}")

                        # 请求间隔，避免 API 限流
                        await asyncio.sleep(DELAY_BETWEEN_REQUESTS)

            except Exception as e:
                logger.error(f"店铺 {shop.shop_name} 预缓存出错: {e}")
                shop_failed += len(shop_posting_list) - shop_success - shop_skipped

            total_success += shop_success
            total_failed += shop_failed
            total_skipped += shop_skipped

            shop_results.append({
                "shop_id": shop_id,
                "shop_name": shop.shop_name,
                "success": shop_success,
                "failed": shop_failed,
                "skipped": shop_skipped
            })

        # 5. 提交数据库更改
        await db.commit()

    # 6. 记录汇总日志
    logger.info(
        f"标签预缓存完成: 处理 {total_processed} 个, "
        f"成功 {total_success}, 跳过 {total_skipped}, 失败 {total_failed}"
    )

    return {
        "success": True,
        "total_processed": total_processed,
        "total_success": total_success,
        "total_skipped": total_skipped,
        "total_failed": total_failed,
        "shop_results": shop_results
    }


# 清理任务配置
CLEANUP_DAYS = 7  # 清理超过7天的标签文件


@celery_app.task(bind=True, name="ef.ozon.labels.cleanup")
def cleanup_labels_task(self):
    """
    标签缓存清理定时任务

    清理超过 7 天的标签 PDF 文件，释放磁盘空间。
    同时清理数据库中对应的 label_pdf_path 字段。
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        result = loop.run_until_complete(_cleanup_labels_async())
        return result
    finally:
        loop.close()
        asyncio.set_event_loop(None)


async def _cleanup_labels_async() -> Dict[str, Any]:
    """异步执行标签清理"""
    import time
    from datetime import datetime, timezone
    from sqlalchemy import update
    from ..models import OzonPosting
    from ..services.label_service import LabelService

    db_manager = get_task_db_manager()

    label_dir = LabelService.get_label_dir()
    cutoff_time = time.time() - (CLEANUP_DAYS * 24 * 60 * 60)  # 7天前的时间戳

    files_deleted = 0
    files_skipped = 0
    files_failed = 0
    deleted_posting_numbers = []

    # 1. 扫描并删除过期文件
    if os.path.exists(label_dir):
        for filename in os.listdir(label_dir):
            if not filename.endswith('.pdf'):
                continue

            filepath = os.path.join(label_dir, filename)

            try:
                # 检查文件修改时间
                file_mtime = os.path.getmtime(filepath)

                if file_mtime < cutoff_time:
                    # 文件超过 7 天，删除
                    os.remove(filepath)
                    files_deleted += 1

                    # 提取 posting_number（文件名去掉 .pdf 后缀）
                    posting_number = filename[:-4]
                    deleted_posting_numbers.append(posting_number)

                    logger.debug(f"已删除过期标签: {filename}")
                else:
                    files_skipped += 1

            except Exception as e:
                files_failed += 1
                logger.warning(f"删除标签失败 {filename}: {e}")

    # 2. 清理数据库中对应的 label_pdf_path
    db_updated = 0
    if deleted_posting_numbers:
        async with db_manager.get_session() as db:
            # 批量更新，清空已删除文件对应的 label_pdf_path
            result = await db.execute(
                update(OzonPosting)
                .where(OzonPosting.posting_number.in_(deleted_posting_numbers))
                .values(label_pdf_path=None)
            )
            db_updated = result.rowcount
            await db.commit()

    logger.info(
        f"标签清理完成: 删除 {files_deleted} 个文件, "
        f"跳过 {files_skipped} 个, 失败 {files_failed} 个, "
        f"更新数据库 {db_updated} 条"
    )

    return {
        "success": True,
        "files_deleted": files_deleted,
        "files_skipped": files_skipped,
        "files_failed": files_failed,
        "db_updated": db_updated,
        "cleanup_days": CLEANUP_DAYS
    }
