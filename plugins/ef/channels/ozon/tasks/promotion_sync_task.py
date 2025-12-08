"""
Ozon 促销活动同步定时任务
每半小时同步一次促销活动和商品，并执行自动取消逻辑
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_task_db_manager

from ..models import OzonShop, OzonPromotionAction
from ..services.promotion_service import PromotionService

logger = logging.getLogger(__name__)


async def sync_all_promotions(**kwargs) -> Dict[str, Any]:
    """
    同步所有店铺的促销活动和商品

    支持两种执行模式（通过环境变量 EF__USE_ARQ_DISPATCHER 控制）：
    - False（默认）: 串行模式，在当前进程中逐个同步店铺
    - True: 派发模式，将店铺级任务派发到 ARQ Worker 并行执行

    Returns:
        同步结果统计
    """
    import os

    use_arq = os.getenv("EF__USE_ARQ_DISPATCHER", "false").lower() == "true"

    if use_arq:
        return await _sync_all_promotions_dispatch()
    else:
        return await _sync_all_promotions_serial()


async def _sync_all_promotions_dispatch() -> Dict[str, Any]:
    """
    促销同步派发模式：将店铺级任务派发到 ARQ Worker 并行执行
    """
    from ef_core.tasks.task_logger import update_task_result, record_task_error
    from ef_core.tasks.arq_tasks import enqueue_batch

    logger.info("Starting promotion sync dispatcher")

    try:
        db_manager = get_task_db_manager()

        async with db_manager.get_session() as db:
            # 获取所有活跃店铺 ID
            stmt = select(OzonShop.id).where(OzonShop.status == "active")
            result = await db.execute(stmt)
            shop_ids = [row[0] for row in result.fetchall()]

        if not shop_ids:
            logger.info("No active shops found, skipping promotion sync")
            update_task_result(
                task_name="ef.ozon.promotions.sync",
                records_processed=0,
                extra_data={"mode": "dispatch", "shops_dispatched": 0}
            )
            return {"mode": "dispatch", "shops_dispatched": 0}

        # 批量派发到 ARQ 队列
        job_ids = await enqueue_batch(
            "sync_shop_promotions",
            shop_ids,
            key_param="shop_id"
        )

        logger.info(
            f"Promotion sync dispatcher completed: dispatched {len(job_ids)} shop tasks to ARQ"
        )

        # 记录派发结果
        update_task_result(
            task_name="ef.ozon.promotions.sync",
            records_processed=len(job_ids),
            extra_data={
                "mode": "dispatch",
                "shops_dispatched": len(job_ids),
                "job_ids": job_ids[:10]
            }
        )

        return {
            "mode": "dispatch",
            "shops_dispatched": len(job_ids),
            "job_ids": job_ids[:10]
        }

    except Exception as e:
        logger.error(f"Error in promotion sync dispatcher: {e}", exc_info=True)
        record_task_error(
            task_name="ef.ozon.promotions.sync",
            error_message=str(e),
            extra_data={"mode": "dispatch"}
        )
        raise


async def _sync_all_promotions_serial() -> Dict[str, Any]:
    """
    促销同步串行模式（原始实现）：在当前进程中逐个同步店铺
    """
    logger.info("Starting promotion sync task (serial mode)")

    start_time = datetime.utcnow()
    results = {
        "started_at": start_time.isoformat() + "Z",
        "mode": "serial",
        "shops_processed": 0,
        "actions_synced": 0,
        "candidates_synced": 0,
        "products_synced": 0,
        "auto_cancelled": 0,
        "errors": []
    }

    db_manager = get_task_db_manager()

    try:
        async with db_manager.get_session() as db:
            # 获取所有活跃的店铺
            stmt = select(OzonShop).where(OzonShop.status == "active")
            result = await db.execute(stmt)
            shops_orm = result.scalars().all()

            # 立即提取所有店铺信息到字典，完全脱离ORM对象
            shops = []
            for shop in shops_orm:
                shops.append({
                    'id': shop.id,
                    'shop_name': shop.shop_name
                })

            logger.info(f"Found {len(shops)} active shops to sync")

            for shop_data in shops:
                shop_id = shop_data['id']
                try:
                    await _sync_shop_promotions(shop_data, db, results)
                    results["shops_processed"] += 1
                except Exception as e:
                    error_msg = f"Failed to sync shop {shop_id}: {str(e)}"
                    logger.error(error_msg, exc_info=True)
                    results["errors"].append({
                        "shop_id": shop_id,
                        "error": error_msg
                    })

            # 记录完成时间
            end_time = datetime.utcnow()
            duration = (end_time - start_time).total_seconds()
            results["completed_at"] = end_time.isoformat() + "Z"
            results["duration_seconds"] = duration

            logger.info(
                f"Promotion sync task completed",
                extra={
                    "shops_processed": results["shops_processed"],
                    "actions_synced": results["actions_synced"],
                    "candidates_synced": results["candidates_synced"],
                    "products_synced": results["products_synced"],
                    "auto_cancelled": results["auto_cancelled"],
                    "duration_seconds": duration,
                    "error_count": len(results["errors"])
                }
            )

            # 记录任务结果到数据库
            from ef_core.tasks.task_logger import update_task_result
            update_task_result(
                task_name="ef.ozon.promotions.sync",
                records_processed=results["actions_synced"] + results["products_synced"],
                records_updated=results["products_synced"],
                extra_data={
                    "mode": "serial",
                    "shops_processed": results["shops_processed"],
                    "actions_synced": results["actions_synced"],
                    "candidates_synced": results["candidates_synced"],
                    "auto_cancelled": results["auto_cancelled"],
                    "errors": len(results["errors"])
                }
            )

            return results

    except Exception as e:
        logger.error("Promotion sync task failed", exc_info=True)
        results["errors"].append({
            "error": "Task failed",
            "message": str(e)
        })
        # 记录任务失败
        from ef_core.tasks.task_logger import record_task_error
        record_task_error(
            task_name="ef.ozon.promotions.sync",
            error_message=str(e),
            records_processed=results["actions_synced"],
            extra_data={"mode": "serial", "shops_processed": results["shops_processed"]}
        )
        raise


async def _sync_shop_promotions(
    shop_data: Dict[str, Any],
    db: AsyncSession,
    results: Dict[str, Any]
) -> None:
    """
    同步单个店铺的促销数据

    Args:
        shop_data: 店铺数据字典 (id, shop_name)
        db: 数据库会话
        results: 结果统计字典（会被修改）
    """
    shop_id = shop_data['id']
    shop_name = shop_data['shop_name']

    logger.info(f"Syncing promotions for shop {shop_id} ({shop_name})")

    try:
        # 1. 同步活动清单
        sync_result = await PromotionService.sync_actions(shop_id, db)
        actions_count = sync_result.get("synced_count", 0)
        results["actions_synced"] += actions_count
        logger.info(f"Synced {actions_count} actions for shop {shop_id}")

        # 2. 获取所有活动
        stmt = select(OzonPromotionAction).where(
            OzonPromotionAction.shop_id == shop_id
        )
        result = await db.execute(stmt)
        actions_orm = result.scalars().all()

        # 立即提取活动信息到字典，脱离ORM对象
        actions = []
        for action in actions_orm:
            actions.append({
                'action_id': action.action_id,
                'auto_cancel_enabled': action.auto_cancel_enabled
            })

        for action_data in actions:
            action_id = action_data['action_id']
            try:
                await _sync_action_products(shop_id, action_data, db, results)
            except Exception as e:
                error_msg = f"Failed to sync action {action_id}: {str(e)}"
                logger.error(error_msg, exc_info=True)
                results["errors"].append({
                    "shop_id": shop_id,
                    "action_id": action_id,
                    "error": error_msg
                })

    except Exception as e:
        logger.error(f"Failed to sync shop {shop_id}", exc_info=True)
        raise


async def _sync_action_products(
    shop_id: int,
    action_data: Dict[str, Any],
    db: AsyncSession,
    results: Dict[str, Any]
) -> None:
    """
    同步单个活动的商品数据

    Args:
        shop_id: 店铺ID
        action_data: 活动数据字典 (action_id, auto_cancel_enabled)
        db: 数据库会话
        results: 结果统计字典（会被修改）
    """
    action_id = action_data['action_id']
    auto_cancel_enabled = action_data['auto_cancel_enabled']

    try:
        # 2.1 同步候选商品
        sync_result = await PromotionService.sync_action_candidates(
            shop_id, action_id, db
        )
        candidates_count = sync_result.get("synced_count", 0)
        results["candidates_synced"] += candidates_count

        # 2.2 同步参与商品
        sync_result = await PromotionService.sync_action_products(
            shop_id, action_id, db
        )
        products_count = sync_result.get("synced_count", 0)
        results["products_synced"] += products_count

        logger.info(
            f"Synced action {action_id}: {candidates_count} candidates, {products_count} products"
        )

        # 2.3 执行自动取消（如果开启）
        if auto_cancel_enabled:
            try:
                cancel_result = await PromotionService.auto_cancel_task(
                    shop_id, action_id, db
                )
                cancelled_count = cancel_result.get("cancelled_count", 0)
                results["auto_cancelled"] += cancelled_count

                if cancelled_count > 0:
                    logger.info(
                        f"Auto-cancelled {cancelled_count} products from action {action_id}",
                        extra={
                            "shop_id": shop_id,
                            "action_id": action_id,
                            "cancelled_count": cancelled_count
                        }
                    )
            except Exception as e:
                error_msg = f"Failed to auto-cancel products for action {action_id}: {str(e)}"
                logger.error(error_msg, exc_info=True)
                results["errors"].append({
                    "shop_id": shop_id,
                    "action_id": action_id,
                    "error": error_msg,
                    "step": "auto_cancel"
                })

    except Exception as e:
        logger.error(f"Failed to sync products for action {action_id}", exc_info=True)
        raise


async def promotion_health_check(**kwargs) -> Dict[str, Any]:
    """
    促销系统健康检查

    检查项：
    - 活动数量统计
    - 候选商品数量统计
    - 参与商品数量统计
    - 自动取消开关状态统计

    Returns:
        健康检查结果
    """
    logger.info("Starting promotion health check")

    health_status = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "status": "healthy",
        "statistics": {}
    }

    db_manager = get_task_db_manager()

    try:
        async with db_manager.get_session() as db:
            # 统计活动数量
            from sqlalchemy import func
            from ..models import OzonPromotionProduct

            stmt = select(func.count()).select_from(OzonPromotionAction)
            result = await db.execute(stmt)
            total_actions = result.scalar()

            # 统计开启自动取消的活动
            stmt = select(func.count()).select_from(OzonPromotionAction).where(
                OzonPromotionAction.auto_cancel_enabled == True
            )
            result = await db.execute(stmt)
            auto_cancel_enabled_count = result.scalar()

            # 统计候选商品数量
            stmt = select(func.count()).select_from(OzonPromotionProduct).where(
                OzonPromotionProduct.status == "candidate"
            )
            result = await db.execute(stmt)
            candidate_products = result.scalar()

            # 统计参与商品数量
            stmt = select(func.count()).select_from(OzonPromotionProduct).where(
                OzonPromotionProduct.status == "active"
            )
            result = await db.execute(stmt)
            active_products = result.scalar()

            # 统计自动加入的商品数量
            stmt = select(func.count()).select_from(OzonPromotionProduct).where(
                OzonPromotionProduct.status == "active",
                OzonPromotionProduct.add_mode == "automatic"
            )
            result = await db.execute(stmt)
            automatic_products = result.scalar()

            health_status["statistics"] = {
                "total_actions": total_actions,
                "auto_cancel_enabled_actions": auto_cancel_enabled_count,
                "candidate_products": candidate_products,
                "active_products": active_products,
                "automatic_products": automatic_products,
                "manual_products": active_products - automatic_products
            }

            logger.info(
                "Promotion health check completed",
                extra=health_status["statistics"]
            )

            # 记录任务结果到数据库
            from ef_core.tasks.task_logger import update_task_result
            update_task_result(
                task_name="ef.ozon.promotions.health_check",
                records_processed=total_actions,
                records_updated=0,
                extra_data=health_status["statistics"]
            )

    except Exception as e:
        logger.error("Promotion health check failed", exc_info=True)
        health_status["status"] = "unhealthy"
        health_status["error"] = str(e)
        # 记录任务失败
        from ef_core.tasks.task_logger import record_task_error
        record_task_error(
            task_name="ef.ozon.promotions.health_check",
            error_message=str(e)
        )

    return health_status


# 注意：定时任务通过 hooks.register_cron() 在插件的 __init__.py 中注册
