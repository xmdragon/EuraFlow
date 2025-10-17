#!/usr/bin/env python3
"""
临时脚本：重置跨境84同步错误
清空所有有错误的订单的同步状态，允许重新同步

使用方式：
    python3 scripts/reset_kuajing84_sync_errors.py
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select, update, func
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonPosting
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def reset_sync_errors():
    """重置所有跨境84同步错误"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        # 1. 统计需要重置的记录数
        logger.info("统计需要重置的记录数...")
        count_result = await db.execute(
            select(func.count()).select_from(OzonPosting)
            .where(OzonPosting.kuajing84_sync_error != None)
        )
        count = count_result.scalar()

        if count == 0:
            logger.info("✅ 没有需要重置的记录")
            return

        logger.info(f"📊 找到 {count} 条需要重置的记录")

        # 2. 确认操作
        print(f"\n⚠️  将重置 {count} 条订单的跨境84同步错误")
        print("   - kuajing84_sync_error → NULL")
        print("   - kuajing84_last_sync_at → NULL")
        confirm = input("\n是否继续？(y/N): ")

        if confirm.lower() != 'y':
            logger.info("❌ 操作已取消")
            return

        # 3. 清空错误
        logger.info("开始重置同步错误...")
        await db.execute(
            update(OzonPosting)
            .where(OzonPosting.kuajing84_sync_error != None)
            .values(
                kuajing84_sync_error=None,
                kuajing84_last_sync_at=None
            )
        )
        await db.commit()

        logger.info(f"✅ 已成功重置 {count} 条记录的同步错误")
        logger.info("   这些订单现在可以重新同步")


if __name__ == "__main__":
    try:
        asyncio.run(reset_sync_errors())
    except KeyboardInterrupt:
        logger.info("\n❌ 操作被用户中断")
        sys.exit(1)
    except Exception as e:
        logger.error(f"❌ 执行失败: {e}", exc_info=True)
        sys.exit(1)
