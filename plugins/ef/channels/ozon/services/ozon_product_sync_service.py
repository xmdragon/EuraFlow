"""
OZON商品增量同步服务
每小时自动同步一次商品数据
"""
import logging
from datetime import datetime, timezone
from typing import Dict, Any
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from ..models import OzonShop
from ..models.sync_service import SyncServiceLog
from .ozon_sync import OzonSyncService

logger = logging.getLogger(__name__)


class OzonProductSyncService:
    """OZON商品增量同步服务"""

    async def sync_products(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        同步商品主流程

        Args:
            config: 服务配置
                - shop_id: 店铺ID（可选，默认所有店铺）

        Returns:
            同步结果统计
        """
        logger.info("Starting OZON product incremental sync")

        stats = {
            "records_processed": 0,
            "records_updated": 0,
            "errors": [],
            "shops_synced": []
        }

        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            # 获取需要同步的店铺
            shop_id = config.get("shop_id")
            if shop_id:
                result = await session.execute(
                    select(OzonShop).where(OzonShop.id == shop_id)
                )
                shops = [result.scalar_one_or_none()]
                if not shops[0]:
                    return {
                        **stats,
                        "message": f"店铺 {shop_id} 不存在"
                    }
            else:
                # 同步所有店铺
                result = await session.execute(select(OzonShop))
                shops = result.scalars().all()

            if not shops:
                logger.warning("No shops found for product sync")
                return {
                    **stats,
                    "message": "没有找到店铺"
                }

            logger.info(f"Found {len(shops)} shops to sync products")

            # 逐个店铺同步
            for shop in shops:
                logger.info(f"Syncing products for shop {shop.id}: {shop.shop_name}")

                # 记录开始时间
                started_at = datetime.now(timezone.utc)
                run_id = f"ozon_product_sync_{uuid.uuid4().hex[:12]}"
                task_id = f"product_sync_{shop.id}_{uuid.uuid4().hex[:8]}"

                try:
                    # 调用商品同步服务（增量模式）
                    result = await OzonSyncService.sync_products(
                        shop_id=shop.id,
                        db=session,
                        task_id=task_id,
                        mode="incremental"
                    )

                    # 解析结果
                    if result.get("status") == "completed":
                        sync_result = result.get("result", {})
                        total_synced = sync_result.get("total_synced", 0)

                        stats["records_processed"] += total_synced
                        stats["records_updated"] += total_synced
                        stats["shops_synced"].append({
                            "shop_id": shop.id,
                            "shop_name": shop.shop_name,
                            "total_synced": total_synced
                        })

                        logger.info(
                            f"Shop {shop.id} sync completed: {total_synced} products synced"
                        )

                        # 创建成功日志
                        finished_at = datetime.now(timezone.utc)
                        execution_time_ms = int((finished_at - started_at).total_seconds() * 1000)

                        sync_log = SyncServiceLog(
                            service_key="ozon_product_sync",
                            run_id=run_id,
                            started_at=started_at,
                            finished_at=finished_at,
                            status="success",
                            records_processed=total_synced,
                            records_updated=total_synced,
                            execution_time_ms=execution_time_ms,
                            error_message=None,
                            extra_data={
                                "shop_id": shop.id,
                                "shop_name": shop.shop_name,
                                "sync_mode": "incremental",
                                "result": sync_result
                            }
                        )
                        session.add(sync_log)
                        await session.commit()

                    else:
                        # 同步失败
                        error_msg = result.get("error", result.get("message", "Unknown error"))
                        logger.error(f"Shop {shop.id} sync failed: {error_msg}")

                        stats["errors"].append({
                            "shop_id": shop.id,
                            "shop_name": shop.shop_name,
                            "error": error_msg
                        })

                        # 创建失败日志
                        finished_at = datetime.now(timezone.utc)
                        execution_time_ms = int((finished_at - started_at).total_seconds() * 1000)

                        sync_log = SyncServiceLog(
                            service_key="ozon_product_sync",
                            run_id=run_id,
                            started_at=started_at,
                            finished_at=finished_at,
                            status="failed",
                            records_processed=0,
                            records_updated=0,
                            execution_time_ms=execution_time_ms,
                            error_message=error_msg[:200],  # 限制长度
                            extra_data={
                                "shop_id": shop.id,
                                "shop_name": shop.shop_name,
                                "sync_mode": "incremental"
                            }
                        )
                        session.add(sync_log)
                        await session.commit()

                except Exception as e:
                    logger.error(f"Error syncing shop {shop.id}: {e}", exc_info=True)

                    # 简化异常信息
                    error_str = str(e)
                    if "timeout" in error_str.lower():
                        error_message = "请求超时"
                    elif "connection" in error_str.lower():
                        error_message = "连接失败"
                    else:
                        error_message = error_str[:50]

                    stats["errors"].append({
                        "shop_id": shop.id,
                        "shop_name": shop.shop_name,
                        "error": error_message
                    })

                    # 创建失败日志
                    finished_at = datetime.now(timezone.utc)
                    execution_time_ms = int((finished_at - started_at).total_seconds() * 1000)

                    sync_log = SyncServiceLog(
                        service_key="ozon_product_sync",
                        run_id=run_id,
                        started_at=started_at,
                        finished_at=finished_at,
                        status="failed",
                        records_processed=0,
                        records_updated=0,
                        execution_time_ms=execution_time_ms,
                        error_message=error_message,
                        extra_data={
                            "shop_id": shop.id,
                            "shop_name": shop.shop_name,
                            "sync_mode": "incremental"
                        }
                    )
                    session.add(sync_log)
                    await session.commit()

        logger.info(
            f"Product sync completed: "
            f"processed={stats['records_processed']}, "
            f"updated={stats['records_updated']}, "
            f"shops={len(stats['shops_synced'])}, "
            f"errors={len(stats['errors'])}"
        )

        # 生成结果消息
        if stats["records_updated"] > 0:
            message = f"成功同步{len(stats['shops_synced'])}个店铺，共{stats['records_updated']}个商品"
        elif len(stats["errors"]) > 0:
            message = f"同步失败，共{len(stats['errors'])}个店铺出错"
        else:
            message = "没有商品需要同步"

        return {
            **stats,
            "message": message
        }


# 全局单例
_service_instance = None


def get_ozon_product_sync_service() -> OzonProductSyncService:
    """获取服务实例"""
    global _service_instance
    if _service_instance is None:
        _service_instance = OzonProductSyncService()
    return _service_instance
