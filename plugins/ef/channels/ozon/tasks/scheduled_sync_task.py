"""
定时同步任务
每周二凌晨4点自动同步类目树和特征
"""
import asyncio
from ef_core.tasks.celery_app import celery_app
from ef_core.database import get_task_db_manager
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)


@celery_app.task(bind=True, name="ef.ozon.scheduled_category_sync")
def scheduled_category_sync(self):
    """
    定时任务：同步所有店铺的类目树
    每周二凌晨4点执行
    """
    try:
        logger.info("Starting scheduled category tree sync")

        # 在新事件循环中运行异步代码，显式管理 event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(_sync_all_shop_categories())
        finally:
            loop.close()
            asyncio.set_event_loop(None)

        logger.info(f"Scheduled category sync completed: {result}")
        return result

    except Exception as e:
        logger.error(f"Scheduled category sync failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@celery_app.task(bind=True, name="ef.ozon.scheduled_attributes_sync")
def scheduled_attributes_sync(self):
    """
    定时任务：同步所有店铺的类目特征
    每周二凌晨4点执行（在类目同步之后）
    """
    try:
        logger.info("Starting scheduled category attributes sync")

        # 在新事件循环中运行异步代码，显式管理 event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(_sync_all_shop_attributes())
        finally:
            loop.close()
            asyncio.set_event_loop(None)

        logger.info(f"Scheduled attributes sync completed: {result}")
        return result

    except Exception as e:
        logger.error(f"Scheduled attributes sync failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def _sync_all_shop_categories():
    """同步类目树（使用第一家启用的店铺，因为类目数据是平台级别的）"""
    from ..models.ozon_shops import OzonShop
    from ..api.client import OzonAPIClient
    from ..services.catalog_service import CatalogService
    from sqlalchemy import select

    db_manager = get_task_db_manager()

    async with db_manager.get_session() as db:
        # 获取第一家启用的店铺
        result = await db.execute(
            select(OzonShop).where(OzonShop.status == "active").limit(1)
        )
        shop = result.scalar_one_or_none()

        if not shop:
            logger.warning("No active shop found for category sync")
            return {
                "success": False,
                "error": "No enabled shop available"
            }

        logger.info(f"Using shop {shop.id} ({shop.shop_name}) for category sync")

        try:
            # 创建 API 客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            # 创建目录服务
            catalog_service = CatalogService(client, db)

            # 同步类目树（强制刷新）
            sync_result = await catalog_service.sync_category_tree(force_refresh=True)

            # 关闭客户端
            await client.close()

            if sync_result.get("success"):
                logger.info(
                    f"Category sync completed: "
                    f"{sync_result.get('total_categories')} total, "
                    f"{sync_result.get('new_categories')} new, "
                    f"{sync_result.get('updated_categories')} updated, "
                    f"{sync_result.get('deprecated_categories')} deprecated"
                )
                return sync_result
            else:
                error = sync_result.get("error", "Unknown error")
                logger.error(f"Category sync failed: {error}")
                return {
                    "success": False,
                    "error": error
                }

        except Exception as e:
            logger.error(f"Failed to sync categories: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }


async def _sync_all_shop_attributes():
    """同步类目特征和字典值（使用第一家启用的店铺，因为数据是平台级别的）"""
    from ..models.ozon_shops import OzonShop
    from ..api.client import OzonAPIClient
    from ..services.catalog_service import CatalogService
    from sqlalchemy import select

    db_manager = get_task_db_manager()

    async with db_manager.get_session() as db:
        # 获取第一家启用的店铺
        result = await db.execute(
            select(OzonShop).where(OzonShop.status == "active").limit(1)
        )
        shop = result.scalar_one_or_none()

        if not shop:
            logger.warning("No active shop found for attributes sync")
            return {
                "success": False,
                "error": "No enabled shop available"
            }

        logger.info(f"Using shop {shop.id} ({shop.shop_name}) for attributes sync")

        try:
            # 创建 API 客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            # 创建目录服务
            catalog_service = CatalogService(client, db)

            # 同步所有叶子类目的特征（包括字典值）
            sync_result = await catalog_service.batch_sync_category_attributes(
                category_ids=None,
                sync_all_leaf=True,
                sync_dictionary_values=True,  # 定时任务同步字典值
                language="ZH_HANS",
                max_concurrent=5
            )

            # 关闭客户端
            await client.close()

            if sync_result.get("success"):
                logger.info(
                    f"Attributes sync completed: "
                    f"{sync_result.get('synced_categories')} categories, "
                    f"{sync_result.get('synced_attributes')} attributes, "
                    f"{sync_result.get('synced_values', 0)} dictionary values"
                )
                return sync_result
            else:
                error = sync_result.get("error", "Unknown error")
                logger.error(f"Attributes sync failed: {error}")
                return {
                    "success": False,
                    "error": error
                }

        except Exception as e:
            logger.error(f"Failed to sync attributes: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }
