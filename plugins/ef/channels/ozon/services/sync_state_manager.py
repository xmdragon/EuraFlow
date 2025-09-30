"""
数据同步状态管理器
用于跟踪后台同步任务的状态，避免重复同步
"""
import asyncio
from typing import Dict, Optional, Set
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class SyncStateManager:
    """数据同步状态管理器"""

    def __init__(self):
        self._syncing_shops: Set[int] = set()  # 正在同步的店铺ID
        self._sync_start_time: Dict[int, datetime] = {}  # 同步开始时间
        self._lock = asyncio.Lock()

    async def is_syncing(self, shop_id: int) -> bool:
        """检查店铺是否正在同步"""
        async with self._lock:
            return shop_id in self._syncing_shops

    async def start_sync(self, shop_id: int) -> bool:
        """开始同步，返回是否成功（false表示已在同步中）"""
        async with self._lock:
            if shop_id in self._syncing_shops:
                logger.info(f"Shop {shop_id} is already syncing")
                return False

            self._syncing_shops.add(shop_id)
            self._sync_start_time[shop_id] = datetime.utcnow()
            logger.info(f"Started sync for shop {shop_id}")
            return True

    async def end_sync(self, shop_id: int):
        """结束同步"""
        async with self._lock:
            if shop_id in self._syncing_shops:
                self._syncing_shops.remove(shop_id)
                start_time = self._sync_start_time.pop(shop_id, None)
                if start_time:
                    duration = (datetime.utcnow() - start_time).total_seconds()
                    logger.info(f"Completed sync for shop {shop_id} in {duration:.2f} seconds")
                else:
                    logger.info(f"Completed sync for shop {shop_id}")

    async def get_sync_status(self, shop_id: int) -> Dict:
        """获取同步状态信息"""
        async with self._lock:
            is_syncing = shop_id in self._syncing_shops
            start_time = self._sync_start_time.get(shop_id)

            status = {
                "is_syncing": is_syncing,
                "start_time": start_time.isoformat() if start_time else None
            }

            if is_syncing and start_time:
                duration = (datetime.utcnow() - start_time).total_seconds()
                status["duration_seconds"] = duration

            return status


# 全局单例实例
_sync_state_manager = SyncStateManager()


def get_sync_state_manager() -> SyncStateManager:
    """获取同步状态管理器实例"""
    return _sync_state_manager