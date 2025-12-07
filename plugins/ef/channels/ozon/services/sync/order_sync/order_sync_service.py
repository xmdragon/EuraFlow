"""
订单同步服务

订单同步的主入口，负责协调各个组件完成同步流程。
"""

from typing import Dict, Any, Set
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....models import OzonShop
from ....api.client import OzonAPIClient
from ....utils.datetime_utils import utcnow

from ..task_state_manager import get_task_state_manager
from .order_fetcher import OrderFetcher
from .posting_processor import PostingProcessor

logger = logging.getLogger(__name__)


class OrderSyncService:
    """订单同步服务"""

    def __init__(self):
        self.fetcher = OrderFetcher()
        self.posting_processor = PostingProcessor()
        self.task_manager = get_task_state_manager()

    async def sync_orders(
        self,
        shop_id: int,
        db: AsyncSession,
        task_id: str,
        mode: str = "incremental"
    ) -> Dict[str, Any]:
        """
        统一的订单同步入口

        Args:
            shop_id: 店铺ID
            db: 数据库会话
            task_id: 任务ID
            mode: 同步模式 'full' - 全量同步, 'incremental' - 增量同步

        Returns:
            任务状态字典
        """
        if mode == "full":
            return await self._sync_orders_full(shop_id, db, task_id)
        else:
            return await self._sync_orders_incremental(shop_id, db, task_id)

    async def _sync_orders_incremental(
        self,
        shop_id: int,
        db: AsyncSession,
        task_id: str
    ) -> Dict[str, Any]:
        """增量同步订单 - 最近7天"""
        try:
            # 初始化任务状态
            self.task_manager.create_task(
                task_id=task_id,
                task_type="orders",
                mode="incremental",
                message="正在获取店铺信息..."
            )

            # 获取店铺和客户端
            shop, client = await self._get_shop_and_client(shop_id, db)

            # 更新进度
            self.task_manager.update_progress(task_id, 5, "正在连接Ozon API...")

            total_synced = 0
            synced_order_ids: Set[str] = set()

            self.task_manager.update_progress(task_id, 5, "正在同步订单...")

            async for items, has_next in self.fetcher.fetch_orders_incremental(client):
                total_synced = await self._process_orders_batch(
                    db=db,
                    shop_id=shop_id,
                    task_id=task_id,
                    items=items,
                    synced_order_ids=synced_order_ids,
                    total_synced=total_synced,
                )

                # 每批次提交一次
                await db.commit()

            # 更新店铺最后同步时间
            shop.last_sync_at = utcnow()
            await db.commit()

            # 完成任务
            message = f"增量同步完成，共同步{total_synced}个订单"
            self.task_manager.complete_task(
                task_id,
                result={"total_synced": total_synced},
                message=message
            )

            return self.task_manager.get_task_dict(task_id)

        except Exception as e:
            logger.error(f"Incremental sync orders failed: {e}")
            self.task_manager.fail_task(task_id, str(e), f"增量同步失败: {str(e)}")
            raise

    async def _sync_orders_full(
        self,
        shop_id: int,
        db: AsyncSession,
        task_id: str
    ) -> Dict[str, Any]:
        """全量同步订单 - 获取店铺所有历史订单"""
        try:
            # 初始化任务状态
            self.task_manager.create_task(
                task_id=task_id,
                task_type="orders",
                mode="full",
                message="正在获取店铺信息..."
            )

            # 获取店铺和客户端
            shop, client = await self._get_shop_and_client(shop_id, db)

            # 更新进度
            self.task_manager.update_progress(task_id, 5, "正在连接Ozon API...")
            self.task_manager.update_progress(task_id, 10, "正在获取所有历史订单...")

            total_synced = 0
            synced_order_ids: Set[str] = set()

            async for items, has_next in self.fetcher.fetch_orders_full(client):
                total_synced = await self._process_orders_batch(
                    db=db,
                    shop_id=shop_id,
                    task_id=task_id,
                    items=items,
                    synced_order_ids=synced_order_ids,
                    total_synced=total_synced,
                    mode="full",
                )

                # 每批次提交一次
                await db.commit()

            # 更新店铺最后同步时间
            shop.last_sync_at = utcnow()
            await db.commit()

            # 完成任务
            message = f"全量同步完成，共同步{total_synced}个订单"
            self.task_manager.complete_task(
                task_id,
                result={"total_synced": total_synced},
                message=message
            )

            return self.task_manager.get_task_dict(task_id)

        except Exception as e:
            logger.error(f"Full sync orders failed: {e}")
            self.task_manager.fail_task(task_id, str(e), f"全量同步失败: {str(e)}")
            raise

    async def _get_shop_and_client(
        self,
        shop_id: int,
        db: AsyncSession
    ) -> tuple[OzonShop, OzonAPIClient]:
        """获取店铺和 API 客户端"""
        result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
        shop = result.scalar_one_or_none()

        if not shop:
            raise ValueError(f"Shop {shop_id} not found")

        client = OzonAPIClient(shop.client_id, shop.api_key_enc)
        return shop, client

    async def _process_orders_batch(
        self,
        db: AsyncSession,
        shop_id: int,
        task_id: str,
        items: list,
        synced_order_ids: Set[str],
        total_synced: int,
        mode: str = "incremental",
    ) -> int:
        """
        处理一批订单（直接同步为 Posting，不再创建 OzonOrder）

        Returns:
            更新后的 total_synced
        """
        for idx, item in enumerate(items):
            posting_number = item.get("posting_number", "")
            ozon_order_id = str(item.get("order_id", ""))

            # 使用 posting_number 去重（更准确）
            if posting_number in synced_order_ids:
                logger.debug(f"Posting {posting_number} already synced, skipping")
                continue

            synced_order_ids.add(posting_number)

            # 更新进度
            current_count = total_synced + idx + 1
            if mode == "full":
                estimated_total = max(500, current_count * 1.1) if current_count > 500 else 500
                progress = 10 + (80 * current_count / estimated_total)
            else:
                progress = 5 + (85 * current_count / max(len(synced_order_ids), 1))

            self.task_manager.update_progress(
                task_id,
                min(int(progress), 90),
                f"正在同步订单 {posting_number}..."
            )

            # 直接同步 posting 信息（不再创建 OzonOrder）
            await self.posting_processor.sync_posting(
                db=db,
                posting_data=item,
                shop_id=shop_id,
                ozon_order_id=ozon_order_id
            )

            total_synced += 1

        return total_synced
