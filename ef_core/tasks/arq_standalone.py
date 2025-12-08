"""
ARQ Worker 独立启动模块

此模块为 ARQ Worker 提供独立的启动配置，
避免导入 Celery 模块触发的事件循环问题。

启动命令：arq ef_core.tasks.arq_standalone.WorkerSettings
"""

import logging
import os
from typing import Any

from arq.connections import RedisSettings

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ====================================================================================
# Redis 配置
# ====================================================================================

def get_redis_settings() -> RedisSettings:
    """获取 Redis 连接配置"""
    redis_host = os.getenv('EF__REDIS_HOST', 'localhost')
    redis_port = int(os.getenv('EF__REDIS_PORT', '6379'))
    redis_password = os.getenv('EF__REDIS_PASSWORD', None)

    return RedisSettings(
        host=redis_host,
        port=redis_port,
        password=redis_password,
        database=2,  # 与 Celery 隔离
    )


# ====================================================================================
# 生命周期钩子
# ====================================================================================

async def startup(ctx: dict[str, Any]) -> None:
    """Worker 启动时初始化"""
    logger.info("ARQ Worker starting up...")

    # 延迟导入数据库管理器
    from ef_core.database import get_db_manager
    ctx['db_manager'] = get_db_manager()

    logger.info("ARQ Worker started successfully")


async def shutdown(ctx: dict[str, Any]) -> None:
    """Worker 关闭时清理"""
    logger.info("ARQ Worker shutting down...")
    logger.info("ARQ Worker shutdown complete")


async def on_job_start(ctx: dict[str, Any]) -> None:
    """任务开始时的钩子"""
    job_id = ctx.get('job_id', 'unknown')
    job_try = ctx.get('job_try', 1)
    logger.info(f"Job started: {job_id} (attempt {job_try})")


async def on_job_end(ctx: dict[str, Any]) -> None:
    """任务结束时的钩子"""
    job_id = ctx.get('job_id', 'unknown')
    logger.info(f"Job completed: {job_id}")


# ====================================================================================
# ARQ 任务函数（直接定义，避免导入链）
# ====================================================================================

async def sync_shop_orders(ctx: dict[str, Any], shop_id: int, mode: str = "incremental") -> dict:
    """同步单个店铺的订单"""
    import uuid
    from plugins.ef.channels.ozon.services.ozon_sync import OzonSyncService

    db_manager = ctx['db_manager']
    task_id = str(uuid.uuid4())

    logger.info(f"Starting order sync for shop {shop_id}, mode={mode}")

    try:
        async with db_manager.get_session() as db:
            result = await OzonSyncService.sync_orders(
                shop_id=shop_id,
                db=db,
                task_id=task_id,
                mode=mode
            )

            logger.info(f"Order sync completed for shop {shop_id}: {result}")
            return {
                "shop_id": shop_id,
                "success": True,
                "synced": result.get("synced", 0),
                "errors": result.get("errors", []),
            }

    except Exception as e:
        logger.error(f"Order sync failed for shop {shop_id}: {e}", exc_info=True)
        return {
            "shop_id": shop_id,
            "success": False,
            "error": str(e),
        }


async def sync_shop_products(ctx: dict[str, Any], shop_id: int) -> dict:
    """同步单个店铺的商品"""
    import uuid
    from plugins.ef.channels.ozon.services.ozon_sync import OzonSyncService

    db_manager = ctx['db_manager']
    task_id = str(uuid.uuid4())

    logger.info(f"Starting product sync for shop {shop_id}")

    try:
        async with db_manager.get_session() as db:
            result = await OzonSyncService.sync_products(
                shop_id=shop_id,
                db=db,
                task_id=task_id
            )

            logger.info(f"Product sync completed for shop {shop_id}: {result}")
            return {
                "shop_id": shop_id,
                "success": True,
                **result,
            }

    except Exception as e:
        logger.error(f"Product sync failed for shop {shop_id}: {e}", exc_info=True)
        return {
            "shop_id": shop_id,
            "success": False,
            "error": str(e),
        }


async def sync_shop_inventory(ctx: dict[str, Any], shop_id: int) -> dict:
    """同步单个店铺的库存"""
    from datetime import datetime, UTC
    from sqlalchemy import select
    from plugins.ef.channels.ozon.models import OzonShop, OzonProduct
    from plugins.ef.channels.ozon.api.client import OzonAPIClient

    db_manager = ctx['db_manager']
    logger.info(f"Starting inventory sync for shop {shop_id}")

    total_synced = 0
    errors = []

    try:
        async with db_manager.get_session() as db:
            # 获取店铺信息
            shop_result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop = shop_result.scalar_one_or_none()

            if not shop:
                return {
                    "shop_id": shop_id,
                    "success": False,
                    "error": f"Shop {shop_id} not found",
                }

            # 创建 API 客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc
            )

            try:
                # 获取需要同步库存的商品
                products_result = await db.execute(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.status == "active"
                    ).limit(100)
                )
                products = products_result.scalars().all()

                # 准备库存数据
                products_data = []
                product_ids = []
                for product in products:
                    if product.offer_id and product.stock is not None:
                        products_data.append({
                            "offer_id": product.offer_id,
                            "product_id": product.ozon_product_id,
                            "stock": int(product.stock),
                            "warehouse_id": 1
                        })
                        product_ids.append(product.id)

                if products_data:
                    # 批量更新库存到 OZON
                    result = await client.update_stocks({"stocks": products_data})

                    if result.get("result"):
                        # 更新本地同步状态
                        current_time = datetime.now(UTC)
                        for product_id in product_ids:
                            product_update = await db.execute(
                                select(OzonProduct).where(OzonProduct.id == product_id)
                            )
                            product = product_update.scalar_one_or_none()
                            if product:
                                product.sync_status = "success"
                                product.last_sync_at = current_time

                        await db.commit()
                        total_synced = len(products_data)
                        logger.info(f"Synced inventory for {total_synced} products in shop {shop_id}")
                    else:
                        errors.append(str(result))
                        logger.warning(f"Failed to sync inventory for shop {shop_id}: {result}")

            finally:
                await client.close()

            return {
                "shop_id": shop_id,
                "success": len(errors) == 0,
                "synced": total_synced,
                "errors": errors,
            }

    except Exception as e:
        logger.error(f"Inventory sync failed for shop {shop_id}: {e}", exc_info=True)
        return {
            "shop_id": shop_id,
            "success": False,
            "error": str(e),
        }


async def sync_shop_promotions(ctx: dict[str, Any], shop_id: int) -> dict:
    """同步单个店铺的促销活动"""
    from sqlalchemy import select
    from plugins.ef.channels.ozon.models import OzonShop, OzonPromotionAction
    from plugins.ef.channels.ozon.services.promotion_service import PromotionService

    db_manager = ctx['db_manager']
    logger.info(f"Starting promotion sync for shop {shop_id}")

    results = {
        "shop_id": shop_id,
        "success": True,
        "actions_synced": 0,
        "candidates_synced": 0,
        "products_synced": 0,
        "auto_cancelled": 0,
        "errors": []
    }

    try:
        async with db_manager.get_session() as db:
            # 验证店铺存在
            shop_result = await db.execute(
                select(OzonShop.id).where(OzonShop.id == shop_id)
            )
            if not shop_result.scalar_one_or_none():
                return {
                    "shop_id": shop_id,
                    "success": False,
                    "error": f"Shop {shop_id} not found",
                }

            # 1. 同步活动清单
            sync_result = await PromotionService.sync_actions(shop_id, db)
            results["actions_synced"] = sync_result.get("synced_count", 0)
            logger.info(f"Synced {results['actions_synced']} actions for shop {shop_id}")

            # 2. 获取所有活动
            stmt = select(OzonPromotionAction).where(
                OzonPromotionAction.shop_id == shop_id
            )
            action_result = await db.execute(stmt)
            actions = action_result.scalars().all()

            # 提取活动信息
            action_data_list = [{
                'action_id': a.action_id,
                'auto_cancel_enabled': a.auto_cancel_enabled
            } for a in actions]

            # 3. 同步每个活动的商品
            for action_data in action_data_list:
                action_id = action_data['action_id']

                try:
                    # 同步候选商品
                    sync_result = await PromotionService.sync_action_candidates(
                        shop_id, action_id, db
                    )
                    results["candidates_synced"] += sync_result.get("synced_count", 0)

                    # 同步参与商品
                    sync_result = await PromotionService.sync_action_products(
                        shop_id, action_id, db
                    )
                    results["products_synced"] += sync_result.get("synced_count", 0)

                    # 执行自动取消（如果开启）
                    if action_data['auto_cancel_enabled']:
                        try:
                            cancel_result = await PromotionService.auto_cancel_task(
                                shop_id, action_id, db
                            )
                            results["auto_cancelled"] += cancel_result.get("cancelled_count", 0)
                        except Exception as e:
                            results["errors"].append({
                                "action_id": action_id,
                                "step": "auto_cancel",
                                "error": str(e)
                            })

                except Exception as e:
                    results["errors"].append({
                        "action_id": action_id,
                        "error": str(e)
                    })

            logger.info(
                f"Promotion sync completed for shop {shop_id}: "
                f"{results['actions_synced']} actions, "
                f"{results['candidates_synced']} candidates, "
                f"{results['products_synced']} products"
            )

            results["success"] = len(results["errors"]) == 0
            return results

    except Exception as e:
        logger.error(f"Promotion sync failed for shop {shop_id}: {e}", exc_info=True)
        return {
            "shop_id": shop_id,
            "success": False,
            "error": str(e),
        }


async def sync_shop_finance(ctx: dict[str, Any], shop_id: int) -> dict:
    """同步单个店铺的财务数据"""
    from sqlalchemy import select
    from plugins.ef.channels.ozon.models import OzonShop
    from plugins.ef.channels.ozon.services.ozon_finance_sync_service import get_ozon_finance_sync_service

    db_manager = ctx['db_manager']
    logger.info(f"Starting finance sync for shop {shop_id}")

    try:
        async with db_manager.get_session() as db:
            # 验证店铺存在
            shop_result = await db.execute(
                select(OzonShop.id).where(OzonShop.id == shop_id)
            )
            if not shop_result.scalar_one_or_none():
                return {
                    "shop_id": shop_id,
                    "success": False,
                    "error": f"Shop {shop_id} not found",
                }

        # 使用财务同步服务（传入 shop_id 筛选）
        finance_service = get_ozon_finance_sync_service()
        result = await finance_service.sync_finance_costs({"shop_id": shop_id})

        logger.info(f"Finance sync completed for shop {shop_id}: {result}")
        return {
            "shop_id": shop_id,
            "success": True,
            **result,
        }

    except Exception as e:
        logger.error(f"Finance sync failed for shop {shop_id}: {e}", exc_info=True)
        return {
            "shop_id": shop_id,
            "success": False,
            "error": str(e),
        }


# ====================================================================================
# Worker 配置
# ====================================================================================

class WorkerSettings:
    """ARQ Worker 配置"""

    redis_settings = get_redis_settings()

    # 注册任务函数
    functions = [
        sync_shop_orders,
        sync_shop_products,
        sync_shop_inventory,
        sync_shop_promotions,
        sync_shop_finance,
    ]

    # 生命周期钩子
    on_startup = startup
    on_shutdown = shutdown
    on_job_start = on_job_start
    on_job_end = on_job_end

    # Worker 配置
    max_jobs = 50
    job_timeout = 300
    max_tries = 3
    retry_delay = 10
    poll_delay = 0.5
    queue_read_limit = 100

    # 健康检查
    health_check_interval = 60
    health_check_key = 'arq:health-check'


logger.info(f"ARQ Worker configured with {len(WorkerSettings.functions)} functions")
