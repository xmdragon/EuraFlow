"""
订单同步服务

订单同步的主入口，负责协调各个组件完成同步流程。
优化版本：使用批量处理减少数据库查询次数。
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
        """增量同步订单 - 最近6小时"""
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
            synced_posting_numbers: Set[str] = set()
            batch_count = 0

            self.task_manager.update_progress(task_id, 5, "正在同步订单...")

            async for items, has_next in self.fetcher.fetch_orders_incremental(client):
                batch_count += 1

                # 过滤已同步的 posting
                new_items = []
                for item in items:
                    posting_number = item.get("posting_number", "")
                    if posting_number and posting_number not in synced_posting_numbers:
                        synced_posting_numbers.add(posting_number)
                        new_items.append(item)

                if new_items:
                    # 更新进度
                    self.task_manager.update_progress(
                        task_id,
                        min(5 + (85 * batch_count / 10), 90),
                        f"正在批量同步第 {batch_count} 批订单（{len(new_items)} 个）..."
                    )

                    # 使用批量处理方法
                    synced = await self.posting_processor.sync_postings_batch(
                        db=db,
                        items=new_items,
                        shop=shop
                    )
                    total_synced += synced

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
            synced_posting_numbers: Set[str] = set()
            batch_count = 0

            async for items, has_next in self.fetcher.fetch_orders_full(client):
                batch_count += 1

                # 过滤已同步的 posting
                new_items = []
                for item in items:
                    posting_number = item.get("posting_number", "")
                    if posting_number and posting_number not in synced_posting_numbers:
                        synced_posting_numbers.add(posting_number)
                        new_items.append(item)

                if new_items:
                    # 更新进度（全量同步估算进度）
                    estimated_total = max(50, batch_count * 1.5)
                    progress = 10 + (80 * batch_count / estimated_total)
                    self.task_manager.update_progress(
                        task_id,
                        min(int(progress), 90),
                        f"正在批量同步第 {batch_count} 批订单（{len(new_items)} 个）..."
                    )

                    # 使用批量处理方法
                    synced = await self.posting_processor.sync_postings_batch(
                        db=db,
                        items=new_items,
                        shop=shop
                    )
                    total_synced += synced

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
