"""
促销活动同步后台处理器
简单的定时同步处理，不依赖Celery
"""
import asyncio
import logging
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from ef_core.config import get_settings
from ..models import OzonShop, OzonPromotionAction
from .promotion_service import PromotionService
from ..utils.datetime_utils import utcnow

logger = logging.getLogger(__name__)


class PromotionTaskRunner:
    """促销活动同步后台处理器"""

    def __init__(self):
        settings = get_settings()
        self.engine = create_async_engine(
            settings.database_url.replace("postgresql://", "postgresql+asyncpg://"),
            echo=False,
            pool_size=5,
            max_overflow=10
        )
        self.async_session = async_sessionmaker(
            self.engine,
            expire_on_commit=False
        )
        self.running = False
        self.sync_interval = 1800  # 每30分钟同步一次

    async def start(self):
        """启动任务处理器"""
        self.running = True
        logger.info("Promotion sync task runner started")

        # 首次启动立即执行一次同步
        await self.sync_all_promotions()

        while self.running:
            try:
                # 等待下一次同步
                await asyncio.sleep(self.sync_interval)

                # 执行同步
                await self.sync_all_promotions()
            except Exception as e:
                logger.error(f"Error in promotion sync loop: {e}", exc_info=True)

    async def stop(self):
        """停止任务处理器"""
        self.running = False
        logger.info("Promotion sync task runner stopped")

    async def sync_all_promotions(self):
        """同步所有店铺的促销活动"""
        start_time = datetime.utcnow()
        logger.info("Starting promotion sync for all shops")

        async with self.async_session() as session:
            try:
                # 获取所有店铺
                result = await session.execute(select(OzonShop))
                shops = result.scalars().all()

                if not shops:
                    logger.info("No shops found to sync")
                    return

                total_actions = 0
                total_candidates = 0
                total_products = 0
                total_auto_cancelled = 0

                # 同步每个店铺
                for shop in shops:
                    try:
                        logger.info(f"Syncing shop {shop.id}: {shop.name}")

                        # 1. 同步活动清单
                        result1 = await PromotionService.sync_actions(shop.id, session)
                        synced_actions = result1.get("synced_count", 0)
                        total_actions += synced_actions

                        # 2. 获取所有活动
                        actions = await PromotionService.get_actions_with_stats(shop.id, session)

                        # 3. 同步每个活动的商品
                        for action in actions:
                            action_id = action["action_id"]

                            # 同步候选商品
                            result2 = await PromotionService.sync_action_candidates(
                                shop.id, action_id, session
                            )
                            total_candidates += result2.get("synced_count", 0)

                            # 同步参与商品
                            result3 = await PromotionService.sync_action_products(
                                shop.id, action_id, session
                            )
                            total_products += result3.get("synced_count", 0)

                            # 4. 执行自动取消（如果开启）
                            if action.get("auto_cancel_enabled"):
                                result4 = await PromotionService.auto_cancel_task(
                                    shop.id, action_id, session
                                )
                                cancelled = result4.get("deactivated_count", 0)
                                total_auto_cancelled += cancelled
                                if cancelled > 0:
                                    logger.info(
                                        f"Auto-cancelled {cancelled} products in action {action_id}"
                                    )

                        logger.info(f"Shop {shop.id} sync completed: "
                                  f"{synced_actions} actions synced")

                    except Exception as e:
                        logger.error(f"Error syncing shop {shop.id}: {e}", exc_info=True)
                        continue

                # 记录总结
                duration = (datetime.utcnow() - start_time).total_seconds()
                logger.info(
                    f"Promotion sync completed: "
                    f"{len(shops)} shops, "
                    f"{total_actions} actions, "
                    f"{total_candidates} candidates, "
                    f"{total_products} products, "
                    f"{total_auto_cancelled} auto-cancelled "
                    f"in {duration:.2f}s"
                )

            except Exception as e:
                logger.error(f"Error in sync_all_promotions: {e}", exc_info=True)


async def main():
    """主入口"""
    runner = PromotionTaskRunner()
    try:
        await runner.start()
    except KeyboardInterrupt:
        logger.info("Received shutdown signal")
        await runner.stop()
    except Exception as e:
        logger.error(f"Fatal error in promotion task runner: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    # 配置日志
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    # 运行
    asyncio.run(main())
