"""
定时同步任务
每周二凌晨4点自动同步类目树和特征
"""
import asyncio
from ef_core.tasks.celery_app import celery_app
from ef_core.database import get_db_manager
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

        # 在新事件循环中运行异步代码
        result = asyncio.run(_sync_all_shop_categories())

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

        # 在新事件循环中运行异步代码
        result = asyncio.run(_sync_all_shop_attributes())

        logger.info(f"Scheduled attributes sync completed: {result}")
        return result

    except Exception as e:
        logger.error(f"Scheduled attributes sync failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def _sync_all_shop_categories():
    """同步所有店铺的类目树"""
    from ..models.ozon_shops import OzonShop
    from ..api.client import OzonAPIClient
    from ..services.catalog_service import CatalogService
    from sqlalchemy import select

    db_manager = get_db_manager()
    total_synced = 0
    errors = []

    async with db_manager.get_session() as db:
        # 获取所有启用的店铺
        result = await db.execute(
            select(OzonShop).where(OzonShop.enabled == True)
        )
        shops = result.scalars().all()

        logger.info(f"Found {len(shops)} enabled shops for category sync")

        for shop in shops:
            try:
                logger.info(f"Syncing categories for shop {shop.id} ({shop.name})")

                # 创建 API 客户端
                client = OzonAPIClient(
                    client_id=shop.client_id,
                    api_key=shop.api_key_enc,
                    shop_id=shop.id
                )

                # 创建目录服务
                catalog_service = CatalogService(client, db)

                # 同步类目树
                sync_result = await catalog_service.sync_category_tree()

                # 关闭客户端
                await client.close()

                if sync_result.get("success"):
                    total_synced += sync_result.get("total_categories", 0)
                    logger.info(
                        f"Shop {shop.id} category sync completed: "
                        f"{sync_result.get('total_categories')} categories"
                    )
                else:
                    errors.append({
                        "shop_id": shop.id,
                        "error": sync_result.get("error")
                    })

            except Exception as e:
                logger.error(f"Failed to sync categories for shop {shop.id}: {e}", exc_info=True)
                errors.append({
                    "shop_id": shop.id,
                    "error": str(e)
                })

    return {
        "success": len(errors) == 0,
        "total_synced": total_synced,
        "shops_processed": len(shops),
        "errors": errors
    }


async def _sync_all_shop_attributes():
    """同步所有店铺的类目特征"""
    from ..models.ozon_shops import OzonShop
    from ..api.client import OzonAPIClient
    from ..services.catalog_service import CatalogService
    from sqlalchemy import select

    db_manager = get_db_manager()
    total_synced = 0
    errors = []

    async with db_manager.get_session() as db:
        # 获取所有启用的店铺
        result = await db.execute(
            select(OzonShop).where(OzonShop.enabled == True)
        )
        shops = result.scalars().all()

        logger.info(f"Found {len(shops)} enabled shops for attributes sync")

        for shop in shops:
            try:
                logger.info(f"Syncing attributes for shop {shop.id} ({shop.name})")

                # 创建 API 客户端
                client = OzonAPIClient(
                    client_id=shop.client_id,
                    api_key=shop.api_key_enc,
                    shop_id=shop.id
                )

                # 创建目录服务
                catalog_service = CatalogService(client, db)

                # 同步所有叶子类目的特征（不同步字典值，节省时间）
                sync_result = await catalog_service.batch_sync_category_attributes(
                    category_ids=None,
                    sync_all_leaf=True,
                    sync_dictionary_values=False,  # 定时任务不同步字典值
                    language="ZH_HANS",
                    max_concurrent=5
                )

                # 关闭客户端
                await client.close()

                if sync_result.get("success"):
                    total_synced += sync_result.get("synced_categories", 0)
                    logger.info(
                        f"Shop {shop.id} attributes sync completed: "
                        f"{sync_result.get('synced_categories')} categories, "
                        f"{sync_result.get('synced_attributes')} attributes"
                    )
                else:
                    errors.append({
                        "shop_id": shop.id,
                        "error": sync_result.get("error")
                    })

            except Exception as e:
                logger.error(f"Failed to sync attributes for shop {shop.id}: {e}", exc_info=True)
                errors.append({
                    "shop_id": shop.id,
                    "error": str(e)
                })

    return {
        "success": len(errors) == 0,
        "total_synced": total_synced,
        "shops_processed": len(shops),
        "errors": errors
    }
