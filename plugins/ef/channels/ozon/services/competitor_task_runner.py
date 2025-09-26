#!/usr/bin/env python3
"""
竞争对手数据自动更新任务运行器
每小时检查并更新过期的竞争对手数据
"""
import asyncio
import logging
import signal
import sys
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from ef_core.config import get_settings
from .competitor_data_updater import CompetitorDataUpdater

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('competitor_task_runner.log')
    ]
)
logger = logging.getLogger(__name__)


class CompetitorTaskRunner:
    """竞争对手数据任务运行器"""

    def __init__(self):
        self.is_running = True
        self.engine: Optional[AsyncSession] = None
        self.session_factory = None

        # 注册信号处理器
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

    def _signal_handler(self, signum, frame):
        """处理停止信号"""
        logger.info(f"Received signal {signum}, shutting down...")
        self.is_running = False

    async def setup_database(self):
        """设置数据库连接"""
        settings = get_settings()
        self.engine = create_async_engine(
            settings.database_url,
            echo=False,
            pool_pre_ping=True,
            pool_recycle=3600,
        )
        self.session_factory = sessionmaker(
            bind=self.engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
        logger.info("Database connection established")

    async def cleanup_database(self):
        """清理数据库连接"""
        if self.engine:
            await self.engine.dispose()
            logger.info("Database connection closed")

    async def run_update_cycle(self):
        """运行一次更新循环"""
        async with self.session_factory() as session:
            updater = CompetitorDataUpdater(session)

            try:
                logger.info("Starting competitor data update cycle...")

                # 更新所有店铺的竞争对手数据
                # TODO: 从配置或数据库获取活跃店铺ID列表
                shop_ids = [1]  # 默认店铺ID

                for shop_id in shop_ids:
                    logger.info(f"Updating competitor data for shop {shop_id}...")

                    # 只更新超过24小时未更新的商品
                    await updater.update_all_products(
                        shop_id=shop_id,
                        force=False  # 不强制更新，只更新过期数据
                    )

                    logger.info(f"Completed update for shop {shop_id}")

                logger.info("Competitor data update cycle completed successfully")

            except Exception as e:
                logger.error(f"Error during competitor data update: {e}", exc_info=True)

    async def run(self):
        """主运行循环"""
        logger.info("Competitor data task runner started")

        await self.setup_database()

        try:
            while self.is_running:
                try:
                    # 运行更新循环
                    await self.run_update_cycle()

                    # 等待1小时后再次运行
                    logger.info("Waiting 1 hour before next update cycle...")
                    for _ in range(3600):  # 3600秒 = 1小时
                        if not self.is_running:
                            break
                        await asyncio.sleep(1)

                except Exception as e:
                    logger.error(f"Unexpected error in main loop: {e}", exc_info=True)
                    # 出错时等待5分钟再重试
                    logger.info("Waiting 5 minutes before retry...")
                    for _ in range(300):  # 300秒 = 5分钟
                        if not self.is_running:
                            break
                        await asyncio.sleep(1)

        finally:
            await self.cleanup_database()
            logger.info("Competitor data task runner stopped")


async def main():
    """主入口点"""
    runner = CompetitorTaskRunner()
    await runner.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Received KeyboardInterrupt, exiting...")
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)