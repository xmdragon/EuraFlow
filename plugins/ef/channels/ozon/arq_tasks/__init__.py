"""
OZON ARQ 任务模块

存放所有 OZON 相关的 ARQ 异步任务。
这些任务由 Celery Beat 派发或 API 直接触发，由 ARQ Worker 执行。

任务设计原则：
1. 店铺级粒度：每个任务处理单个店铺的数据
2. 原生 asyncio：直接使用 async/await，无需 new_event_loop() 包装
3. 独立执行：每个任务独立完成，互不干扰
4. 幂等性：相同参数多次执行结果一致

使用方式：
    from ef_core.tasks.arq_tasks import enqueue_task, enqueue_batch

    # 单个任务
    job_id = await enqueue_task("sync_shop_orders", shop_id=123)

    # 批量派发
    shop_ids = [1, 2, 3, 4, 5]
    job_ids = await enqueue_batch("sync_shop_orders", shop_ids, key_param="shop_id")
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


# ====================================================================================
# 订单同步任务
# ====================================================================================

async def sync_shop_orders(ctx: dict[str, Any], shop_id: int, mode: str = "incremental") -> dict:
    """
    同步单个店铺的订单（ARQ 任务）

    Args:
        ctx: ARQ 上下文（包含 db_manager）
        shop_id: 店铺 ID
        mode: 同步模式，"incremental"（增量）或 "full"（全量）

    Returns:
        同步结果：{"shop_id": ..., "synced": ..., "errors": ...}
    """
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


# ====================================================================================
# 商品同步任务
# ====================================================================================

async def sync_shop_products(ctx: dict[str, Any], shop_id: int) -> dict:
    """
    同步单个店铺的商品（ARQ 任务）

    Args:
        ctx: ARQ 上下文
        shop_id: 店铺 ID

    Returns:
        同步结果
    """
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


# ====================================================================================
# 库存同步任务
# ====================================================================================

async def sync_shop_inventory(ctx: dict[str, Any], shop_id: int) -> dict:
    """
    同步单个店铺的库存（ARQ 任务）

    Args:
        ctx: ARQ 上下文
        shop_id: 店铺 ID

    Returns:
        同步结果
    """
    logger.info(f"Starting inventory sync for shop {shop_id}")

    # TODO: 实现库存同步逻辑
    # 当前库存同步可能不是店铺级别的，需要根据实际情况调整

    return {
        "shop_id": shop_id,
        "success": True,
        "message": "Inventory sync not yet implemented in ARQ",
    }


# ====================================================================================
# 促销同步任务
# ====================================================================================

async def sync_shop_promotions(ctx: dict[str, Any], shop_id: int) -> dict:
    """
    同步单个店铺的促销活动（ARQ 任务）

    Args:
        ctx: ARQ 上下文
        shop_id: 店铺 ID

    Returns:
        同步结果
    """
    logger.info(f"Starting promotion sync for shop {shop_id}")

    # TODO: 实现促销同步逻辑

    return {
        "shop_id": shop_id,
        "success": True,
        "message": "Promotion sync not yet implemented in ARQ",
    }


# ====================================================================================
# 财务同步任务
# ====================================================================================

async def sync_shop_finance(ctx: dict[str, Any], shop_id: int) -> dict:
    """
    同步单个店铺的财务数据（ARQ 任务）

    Args:
        ctx: ARQ 上下文
        shop_id: 店铺 ID

    Returns:
        同步结果
    """
    logger.info(f"Starting finance sync for shop {shop_id}")

    # TODO: 实现财务同步逻辑

    return {
        "shop_id": shop_id,
        "success": True,
        "message": "Finance sync not yet implemented in ARQ",
    }


# ====================================================================================
# 注册所有 ARQ 任务
# ====================================================================================

def register_ozon_arq_tasks():
    """
    注册 OZON 相关的 ARQ 任务到 Worker

    在 ARQ Worker 启动时调用。
    """
    from ef_core.tasks.arq_worker import register_arq_function

    # 注册任务函数
    register_arq_function(sync_shop_orders)
    register_arq_function(sync_shop_products)
    register_arq_function(sync_shop_inventory)
    register_arq_function(sync_shop_promotions)
    register_arq_function(sync_shop_finance)

    logger.info("Registered OZON ARQ tasks")


# 导出的任务函数
__all__ = [
    "sync_shop_orders",
    "sync_shop_products",
    "sync_shop_inventory",
    "sync_shop_promotions",
    "sync_shop_finance",
    "register_ozon_arq_tasks",
]
