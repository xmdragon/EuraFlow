"""
店铺信息缓存服务

解决 webhook 风暴时重复查询 ozon_shops 表的性能问题。
ozon_shops 表数据量小（通常 <10 条），适合全量缓存。
"""
import asyncio
import logging
import time
from typing import Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.ozon_shops import OzonShop

logger = logging.getLogger(__name__)

# 缓存配置
CACHE_TTL_SECONDS = 300  # 5分钟过期


class ShopCache:
    """店铺信息缓存（进程内单例）"""

    _instance: Optional["ShopCache"] = None
    _lock: asyncio.Lock = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._cache_by_client_id: Dict[str, OzonShop] = {}
        self._cache_by_id: Dict[int, OzonShop] = {}
        self._cache_time: float = 0
        self._refreshing: bool = False

    @classmethod
    def get_lock(cls) -> asyncio.Lock:
        """获取异步锁（延迟初始化，避免事件循环问题）"""
        if cls._lock is None:
            cls._lock = asyncio.Lock()
        return cls._lock

    def is_expired(self) -> bool:
        """检查缓存是否过期"""
        return time.time() - self._cache_time > CACHE_TTL_SECONDS

    async def refresh(self, db: AsyncSession) -> None:
        """刷新全量店铺缓存"""
        if self._refreshing:
            # 避免并发刷新
            return

        async with self.get_lock():
            # 双重检查
            if not self.is_expired():
                return

            self._refreshing = True
            try:
                result = await db.execute(
                    select(OzonShop).where(OzonShop.status == "active")
                )
                shops = result.scalars().all()

                # 更新缓存
                self._cache_by_client_id = {shop.client_id: shop for shop in shops}
                self._cache_by_id = {shop.id: shop for shop in shops}
                self._cache_time = time.time()

                logger.debug(f"Shop cache refreshed: {len(shops)} active shops")
            finally:
                self._refreshing = False

    async def get_by_client_id(
        self,
        client_id: str,
        db: AsyncSession
    ) -> Optional[OzonShop]:
        """
        通过 client_id 获取店铺（优先使用缓存）

        Args:
            client_id: Ozon 店铺的 client_id（seller_id）
            db: 数据库会话（用于刷新缓存）

        Returns:
            OzonShop 对象或 None
        """
        # 检查缓存是否需要刷新
        if self.is_expired():
            await self.refresh(db)

        # 从缓存获取
        shop = self._cache_by_client_id.get(str(client_id))

        # 缓存未命中，尝试直接查询（可能是新增的店铺）
        if shop is None and not self.is_expired():
            result = await db.execute(
                select(OzonShop).where(
                    OzonShop.client_id == str(client_id),
                    OzonShop.status == "active"
                )
            )
            shop = result.scalar_one_or_none()

            # 如果找到了，更新缓存
            if shop:
                self._cache_by_client_id[shop.client_id] = shop
                self._cache_by_id[shop.id] = shop
                logger.info(f"Added new shop to cache: {shop.shop_name} (client_id={client_id})")

        return shop

    async def get_by_id(
        self,
        shop_id: int,
        db: AsyncSession
    ) -> Optional[OzonShop]:
        """通过 ID 获取店铺"""
        if self.is_expired():
            await self.refresh(db)

        return self._cache_by_id.get(shop_id)

    async def get_all_active(self, db: AsyncSession) -> list:
        """获取所有活跃店铺"""
        if self.is_expired():
            await self.refresh(db)

        return list(self._cache_by_id.values())

    def invalidate(self) -> None:
        """手动使缓存失效（店铺信息更新时调用）"""
        self._cache_time = 0
        logger.debug("Shop cache invalidated")


# 全局单例
_shop_cache: Optional[ShopCache] = None


def get_shop_cache() -> ShopCache:
    """获取店铺缓存单例"""
    global _shop_cache
    if _shop_cache is None:
        _shop_cache = ShopCache()
    return _shop_cache
