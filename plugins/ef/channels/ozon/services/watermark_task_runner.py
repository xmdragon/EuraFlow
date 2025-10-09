"""
水印任务后台处理器
简单的异步任务处理，不依赖Celery
"""
import asyncio
import logging
from datetime import datetime
from sqlalchemy import select, and_, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from ef_core.config import get_settings
from ..models import WatermarkTask
from .watermark_processor import WatermarkProcessor
from ..utils.datetime_utils import utcnow

logger = logging.getLogger(__name__)


class WatermarkTaskRunner:
    """水印任务后台处理器"""

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
        self.processing_interval = 2  # 每2秒检查一次待处理任务

    async def start(self):
        """启动任务处理器"""
        self.running = True
        logger.info("Watermark task runner started")

        while self.running:
            try:
                await self.process_pending_tasks()
            except Exception as e:
                logger.error(f"Error processing tasks: {e}")

            # 等待下一次处理
            await asyncio.sleep(self.processing_interval)

    async def stop(self):
        """停止任务处理器"""
        self.running = False
        logger.info("Watermark task runner stopped")

    async def process_pending_tasks(self):
        """处理待处理的任务"""
        async with self.async_session() as session:
            # 获取待处理的任务
            result = await session.execute(
                select(WatermarkTask)
                .where(WatermarkTask.status == "pending")
                .order_by(WatermarkTask.created_at)
                .limit(5)  # 每次最多处理5个任务
            )
            tasks = result.scalars().all()

            if not tasks:
                return

            logger.info(f"Found {len(tasks)} pending watermark tasks")

            # 处理每个任务
            for task in tasks:
                await self.process_single_task(session, task)

    async def process_single_task(self, session: AsyncSession, task: WatermarkTask):
        """处理单个任务"""
        try:
            logger.info(f"Processing watermark task {task.id} for product {task.product_id}")

            # 更新任务状态为处理中
            task.status = "processing"
            task.processing_started_at = utcnow()
            await session.commit()

            # 创建处理器
            processor = WatermarkProcessor(session)

            # 处理任务
            if task.task_type == "apply":
                # 应用水印
                result = await processor.process_single_product(
                    task.product_id,
                    task.shop_id,
                    task.watermark_config_id,
                    str(task.id),
                    analyze_mode="individual"  # 默认使用精准模式
                )

                # 更新任务状态为完成
                task.status = "completed"
                task.completed_at = utcnow()
                task.processed_images = result.get("processed_images", [])
                task.original_images = result.get("original_images", [])
                task.cloudinary_public_ids = result.get("cloudinary_ids", [])

                logger.info(f"Watermark task {task.id} completed successfully")

            elif task.task_type == "restore":
                # 还原原图
                # TODO: 实现还原逻辑
                task.status = "completed"
                task.completed_at = utcnow()
                logger.info(f"Restore task {task.id} completed")

            await session.commit()

        except Exception as e:
            logger.error(f"Failed to process task {task.id}: {e}")
            # 更新任务状态为失败
            task.status = "failed"
            task.error_message = str(e)
            task.completed_at = utcnow()
            await session.commit()


async def run_task_runner():
    """运行任务处理器"""
    runner = WatermarkTaskRunner()
    try:
        await runner.start()
    except KeyboardInterrupt:
        await runner.stop()


if __name__ == "__main__":
    # 可以独立运行
    import sys
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))))

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    asyncio.run(run_task_runner())