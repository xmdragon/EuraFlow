"""
批量同步类目和特征的后台任务
"""
import asyncio
import json
from typing import Optional, List
from concurrent.futures import ThreadPoolExecutor
import redis
from ef_core.tasks.celery_app import celery_app
from ef_core.database import get_task_db_manager
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)

# 创建线程池用于运行异步任务
_thread_pool = ThreadPoolExecutor(max_workers=2)

# Redis客户端用于存储进度信息
_redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)


@celery_app.task(bind=True, name="ef.ozon.batch_sync_category_attributes")
def batch_sync_category_attributes_task(
    self,
    shop_id: int,
    category_ids: Optional[List[int]] = None,
    sync_all_leaf: bool = False,
    sync_dictionary_values: bool = True,
    language: str = "ZH_HANS",
    max_concurrent: int = 5
):
    """
    批量同步类目特征（后台异步任务）

    Args:
        shop_id: 店铺ID
        category_ids: 类目ID列表
        sync_all_leaf: 是否同步所有叶子类目
        sync_dictionary_values: 是否同步特征值指南
        language: 语言（ZH_HANS/DEFAULT/RU/EN/TR）
        max_concurrent: 最大并发数
    """
    # 在单独的线程中运行异步代码，避免 event loop 冲突
    # 先在主线程获取 task_id
    task_id = self.request.id if self.request.id else "unknown"

    logger.info(f"Task ID: {task_id}, shop_id: {shop_id}")

    def run_async_in_thread():
        """在新线程中运行异步代码，显式管理 event loop"""
        # 创建新的 event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(
                _batch_sync_async(
                    task_id,
                    shop_id,
                    category_ids,
                    sync_all_leaf,
                    sync_dictionary_values,
                    language,
                    max_concurrent
                )
            )
        finally:
            # 清理 loop
            loop.close()
            asyncio.set_event_loop(None)

    try:
        # 使用线程池执行异步任务
        future = _thread_pool.submit(run_async_in_thread)
        result = future.result(timeout=7200)  # 2小时超时
        return result
    except Exception as e:
        logger.error(f"Task execution error: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@celery_app.task(bind=True, name="ef.ozon.sync_category_tree")
def sync_category_tree_task(
    self,
    shop_id: int,
    force_refresh: bool = True
):
    """
    类目树同步（后台异步任务）

    Args:
        shop_id: 店铺ID
        force_refresh: 是否强制刷新
    """
    # 在单独的线程中运行异步代码，避免 event loop 冲突
    task_id = self.request.id if self.request.id else "unknown"

    logger.info(f"Category Tree Sync Task ID: {task_id}, shop_id: {shop_id}")

    def run_async_in_thread():
        """在新线程中运行异步代码，显式管理 event loop"""
        # 创建新的 event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(
                _sync_category_tree_async(
                    task_id,
                    shop_id,
                    force_refresh
                )
            )
        finally:
            # 清理 loop
            loop.close()
            asyncio.set_event_loop(None)

    try:
        # 使用线程池执行异步任务
        future = _thread_pool.submit(run_async_in_thread)
        result = future.result(timeout=7200)  # 2小时超时
        return result
    except Exception as e:
        logger.error(f"Category tree sync task execution error: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


async def _sync_category_tree_async(
    task_id: str,
    shop_id: int,
    force_refresh: bool
):
    """异步类目树同步（内部实现）"""
    from ..models.ozon_shops import OzonShop
    from ..api.client import OzonAPIClient
    from ..services.catalog_service import CatalogService
    from sqlalchemy import select

    try:
        # 使用独立的数据库管理器（避免事件循环冲突）
        db_manager = get_task_db_manager()

        async with db_manager.get_session() as db:
            # 获取店铺信息
            shop_result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop = shop_result.scalar_one_or_none()

            if not shop:
                logger.error(f"Shop {shop_id} not found for category tree sync")
                return {
                    "success": False,
                    "error": f"Shop {shop_id} not found"
                }

            # 创建API客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop_id
            )

            # 创建目录服务
            catalog_service = CatalogService(client, db)

            # 使用 Redis 存储进度信息
            progress_key = f"celery-task-progress:{task_id}"

            # 初始化进度
            _redis_client.setex(
                progress_key,
                7200,  # 2小时过期
                json.dumps({
                    'status': 'starting',
                    'processed_categories': 0,
                    'total_categories': 0,
                    'current_category': '准备中...'
                })
            )

            logger.info(
                f"Starting category tree sync: shop_id={shop_id}, "
                f"force_refresh={force_refresh}"
            )

            # 定义进度回调函数
            def update_progress(current, total, category_name):
                _redis_client.setex(
                    progress_key,
                    7200,  # 2小时过期
                    json.dumps({
                        'status': 'syncing',
                        'processed_categories': current,
                        'total_categories': total,
                        'current_category': category_name,
                        'percent': int((current / total) * 100) if total > 0 else 0
                    })
                )

            # 执行类目树同步
            result = await catalog_service.sync_category_tree(
                force_refresh=force_refresh,
                progress_callback=update_progress
            )

            # 关闭API客户端
            await client.close()

            logger.info("Category tree sync completed")
            logger.info(
                f"Category tree sync result: total={result.get('total_categories')}, "
                f"new={result.get('new_categories')}, updated={result.get('updated_categories')}, "
                f"deprecated={result.get('deprecated_categories')}"
            )

            # 更新进度状态为已完成
            _redis_client.setex(
                progress_key,
                300,  # 完成后保留5分钟
                json.dumps({
                    'status': 'completed',
                    'processed_categories': result.get('total_categories', 0),
                    'total_categories': result.get('total_categories', 0),
                    'current_category': '同步完成',
                    'percent': 100,
                    'result': result
                })
            )

            return result

    except Exception as e:
        logger.error(f"Category tree sync task failed: {e}", exc_info=True)
        # 更新进度状态为失败
        _redis_client.setex(
            progress_key,
            300,  # 保留5分钟
            json.dumps({
                'status': 'failed',
                'error': str(e),
                'current_category': '同步失败'
            })
        )
        return {
            "success": False,
            "error": str(e)
        }


async def _batch_sync_async(
    task_id: str,
    shop_id: int,
    category_ids: Optional[List[int]],
    sync_all_leaf: bool,
    sync_dictionary_values: bool,
    language: str,
    max_concurrent: int
):
    """异步批量同步（内部实现）"""
    from ..models.ozon_shops import OzonShop
    from ..api.client import OzonAPIClient
    from ..services.catalog_service import CatalogService
    from sqlalchemy import select

    try:
        # 使用独立的数据库管理器（避免事件循环冲突）
        db_manager = get_task_db_manager()

        async with db_manager.get_session() as db:
            # 获取店铺信息
            shop_result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop = shop_result.scalar_one_or_none()

            if not shop:
                logger.error(f"Shop {shop_id} not found for batch sync")
                return {
                    "success": False,
                    "error": f"Shop {shop_id} not found"
                }

            # 创建API客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop_id
            )

            # 创建目录服务
            catalog_service = CatalogService(client, db)

            # 使用 Redis 存储进度信息（绕过 Celery 状态机制）
            progress_key = f"celery-task-progress:{task_id}"

            # 初始化进度
            _redis_client.setex(
                progress_key,
                7200,  # 2小时过期
                json.dumps({
                    'status': 'starting',
                    'synced_categories': 0,
                    'total_categories': 0,
                    'current_category': '准备中...'
                })
            )

            logger.info(
                f"Starting batch sync task: shop_id={shop_id}, "
                f"category_ids={category_ids}, sync_all_leaf={sync_all_leaf}"
            )

            # 定义进度回调函数
            def update_progress(current, total, category_id, category_name, synced_attributes, synced_values):
                _redis_client.setex(
                    progress_key,
                    7200,  # 2小时过期
                    json.dumps({
                        'status': 'syncing',
                        'synced_categories': current,
                        'total_categories': total,
                        'current_category': category_name,
                        'current_category_id': category_id,
                        'synced_attributes': synced_attributes,
                        'synced_values': synced_values,
                        'percent': int((current / total) * 100) if total > 0 else 0
                    })
                )

            # 执行批量同步
            result = await catalog_service.batch_sync_category_attributes(
                category_ids=category_ids,
                sync_all_leaf=sync_all_leaf,
                sync_dictionary_values=sync_dictionary_values,
                language=language,
                max_concurrent=max_concurrent,
                progress_callback=update_progress
            )

            # 关闭API客户端
            await client.close()

            # catalog_service 内部已经 commit，无需额外操作
            logger.info("Batch sync completed, transaction committed by service")

            logger.info(
                f"Batch sync task completed: synced_categories={result.get('synced_categories')}, "
                f"synced_attributes={result.get('synced_attributes')}, "
                f"synced_values={result.get('synced_values')}"
            )

            # 更新进度状态为已完成
            _redis_client.setex(
                progress_key,
                300,  # 完成后保留5分钟
                json.dumps({
                    'status': 'completed',
                    'synced_categories': result.get('synced_categories', 0),
                    'total_categories': result.get('total_categories', 0),
                    'synced_attributes': result.get('synced_attributes', 0),
                    'synced_values': result.get('synced_values', 0),
                    'current_category': '同步完成',
                    'percent': 100,
                    'result': result
                })
            )

            return result

    except Exception as e:
        logger.error(f"Batch sync task failed: {e}", exc_info=True)
        # 更新进度状态为失败
        _redis_client.setex(
            progress_key,
            300,  # 保留5分钟
            json.dumps({
                'status': 'failed',
                'error': str(e),
                'current_category': '同步失败'
            })
        )
        return {
            "success": False,
            "error": str(e)
        }
