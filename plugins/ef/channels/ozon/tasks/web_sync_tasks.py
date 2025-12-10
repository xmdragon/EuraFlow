"""
OZON Web 同步定时任务

使用浏览器 Cookie 执行促销清理、账单同步、余额同步任务

执行时间（UTC，北京时间 = UTC + 8）：
- 促销清理: 0 22 * * * (UTC 22:00 = 北京 6:00)
- 账单同步: 30 22 * * * (UTC 22:30 = 北京 6:30)
- 余额同步: 5 * * * * (每小时第 5 分钟)

注意：
- 定时任务通过 hooks.register_cron() 注册，传入异步函数
- register_cron 会自动包装为 Celery Task，处理事件循环
- 任务为所有有 Cookie 的用户执行同步
"""
import logging
from typing import Dict, Any

from sqlalchemy import select, distinct

logger = logging.getLogger(__name__)


async def web_promo_cleaner_task(**kwargs) -> Dict[str, Any]:
    """
    促销清理定时任务

    每天 UTC 22:00（北京 6:00）执行，清理所有店铺的促销待拉入商品

    Returns:
        执行结果摘要
    """
    logger.info("开始执行促销清理任务")

    from ef_core.database import get_db_manager
    from ..models import OzonShop
    from ..services.ozon_web_sync_service import OzonWebSyncService

    db_manager = get_db_manager()
    total_results = {
        "users_processed": 0,
        "users_success": 0,
        "users_failed": 0,
        "results": [],
    }

    try:
        async with db_manager.get_session() as db:
            # 获取所有有 Cookie 的用户 ID（去重）
            stmt = select(distinct(OzonShop.owner_user_id)).where(
                OzonShop.status == "active",
                OzonShop.ozon_session_enc.isnot(None),
            )
            result = await db.execute(stmt)
            user_ids = [row[0] for row in result.fetchall()]

            logger.info(f"找到 {len(user_ids)} 个有 Cookie 的用户")

            for user_id in user_ids:
                try:
                    service = OzonWebSyncService(db, user_id)
                    result = await service.sync_promo_cleaner()

                    total_results["users_processed"] += 1
                    if result.get("success"):
                        total_results["users_success"] += 1
                    else:
                        total_results["users_failed"] += 1

                    total_results["results"].append({
                        "user_id": user_id,
                        **result,
                    })

                except Exception as e:
                    logger.error(f"用户 {user_id} 促销清理失败: {e}", exc_info=True)
                    total_results["users_processed"] += 1
                    total_results["users_failed"] += 1
                    total_results["results"].append({
                        "user_id": user_id,
                        "success": False,
                        "error": str(e),
                    })

        logger.info(
            f"促销清理任务完成: 处理 {total_results['users_processed']} 个用户, "
            f"成功 {total_results['users_success']}, 失败 {total_results['users_failed']}"
        )

        return total_results

    except Exception as e:
        logger.error(f"促销清理任务执行失败: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
        }


async def web_invoice_sync_task(**kwargs) -> Dict[str, Any]:
    """
    账单同步定时任务

    每天 UTC 22:30（北京 6:30）执行，同步所有店铺的账单付款数据

    Returns:
        执行结果摘要
    """
    logger.info("开始执行账单同步任务")

    from ef_core.database import get_db_manager
    from ..models import OzonShop
    from ..services.ozon_web_sync_service import OzonWebSyncService

    db_manager = get_db_manager()
    total_results = {
        "users_processed": 0,
        "users_success": 0,
        "users_failed": 0,
        "results": [],
    }

    try:
        async with db_manager.get_session() as db:
            # 获取所有有 Cookie 的用户 ID（去重）
            stmt = select(distinct(OzonShop.owner_user_id)).where(
                OzonShop.status == "active",
                OzonShop.ozon_session_enc.isnot(None),
            )
            result = await db.execute(stmt)
            user_ids = [row[0] for row in result.fetchall()]

            logger.info(f"找到 {len(user_ids)} 个有 Cookie 的用户")

            for user_id in user_ids:
                try:
                    service = OzonWebSyncService(db, user_id)
                    result = await service.sync_invoice_payments()

                    total_results["users_processed"] += 1
                    if result.get("success"):
                        total_results["users_success"] += 1
                    else:
                        total_results["users_failed"] += 1

                    total_results["results"].append({
                        "user_id": user_id,
                        **result,
                    })

                except Exception as e:
                    logger.error(f"用户 {user_id} 账单同步失败: {e}", exc_info=True)
                    total_results["users_processed"] += 1
                    total_results["users_failed"] += 1
                    total_results["results"].append({
                        "user_id": user_id,
                        "success": False,
                        "error": str(e),
                    })

        logger.info(
            f"账单同步任务完成: 处理 {total_results['users_processed']} 个用户, "
            f"成功 {total_results['users_success']}, 失败 {total_results['users_failed']}"
        )

        return total_results

    except Exception as e:
        logger.error(f"账单同步任务执行失败: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
        }


async def web_balance_sync_task(**kwargs) -> Dict[str, Any]:
    """
    余额同步定时任务

    每小时第 5 分钟执行，同步所有店铺的账户余额

    Returns:
        执行结果摘要
    """
    logger.info("开始执行余额同步任务")

    from ef_core.database import get_db_manager
    from ..models import OzonShop
    from ..services.ozon_web_sync_service import OzonWebSyncService

    db_manager = get_db_manager()
    total_results = {
        "users_processed": 0,
        "users_success": 0,
        "users_failed": 0,
        "results": [],
    }

    try:
        async with db_manager.get_session() as db:
            # 获取所有有 Cookie 的用户 ID（去重）
            stmt = select(distinct(OzonShop.owner_user_id)).where(
                OzonShop.status == "active",
                OzonShop.ozon_session_enc.isnot(None),
            )
            result = await db.execute(stmt)
            user_ids = [row[0] for row in result.fetchall()]

            logger.info(f"找到 {len(user_ids)} 个有 Cookie 的用户")

            for user_id in user_ids:
                try:
                    service = OzonWebSyncService(db, user_id)
                    result = await service.sync_balance()

                    total_results["users_processed"] += 1
                    if result.get("success"):
                        total_results["users_success"] += 1
                    else:
                        total_results["users_failed"] += 1

                    total_results["results"].append({
                        "user_id": user_id,
                        **result,
                    })

                except Exception as e:
                    logger.error(f"用户 {user_id} 余额同步失败: {e}", exc_info=True)
                    total_results["users_processed"] += 1
                    total_results["users_failed"] += 1
                    total_results["results"].append({
                        "user_id": user_id,
                        "success": False,
                        "error": str(e),
                    })

        logger.info(
            f"余额同步任务完成: 处理 {total_results['users_processed']} 个用户, "
            f"成功 {total_results['users_success']}, 失败 {total_results['users_failed']}"
        )

        return total_results

    except Exception as e:
        logger.error(f"余额同步任务执行失败: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
        }
