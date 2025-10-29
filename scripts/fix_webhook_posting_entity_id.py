#!/usr/bin/env python3
"""
修复 ozon_webhook_events 表中 posting 类型的 entity_id
将旧的数字 ID 替换为真实的 posting_number
"""
import asyncio
import logging
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.sync import OzonWebhookEvent
from plugins.ef.channels.ozon.models.orders import OzonPosting

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


async def fix_webhook_posting_entity_ids():
    """修复 webhook 事件中的 posting entity_id"""

    db_manager = get_db_manager()
    session_factory = db_manager.get_async_session_factory()
    async with session_factory() as session:
        # 1. 查询所有 entity_type='posting' 且 entity_id 是纯数字的记录
        stmt = select(OzonWebhookEvent).where(
            and_(
                OzonWebhookEvent.entity_type == "posting",
                OzonWebhookEvent.entity_id.op('~')('^[0-9]+$')  # 正则匹配纯数字
            )
        )

        result = await session.execute(stmt)
        webhook_events = result.scalars().all()

        logger.info(f"找到 {len(webhook_events)} 条需要修复的 webhook 事件")

        if not webhook_events:
            logger.info("没有需要修复的数据")
            return

        # 2. 逐条处理
        fixed_count = 0
        not_found_count = 0
        fixed_from_payload_count = 0

        for event in webhook_events:
            posting_id = int(event.entity_id)

            # 首先尝试从数据库查询 posting_number
            posting_stmt = select(OzonPosting.posting_number).where(
                OzonPosting.id == posting_id
            )
            posting_result = await session.execute(posting_stmt)
            posting_number = posting_result.scalar_one_or_none()

            if posting_number:
                # 更新 entity_id 为 posting_number
                event.entity_id = posting_number
                fixed_count += 1
                logger.info(f"修复 webhook_event {event.id}: {posting_id} -> {posting_number}")
            else:
                # 尝试从 payload 中提取 posting_number
                payload = event.payload or {}
                posting_number_from_payload = payload.get('posting_number')

                if posting_number_from_payload:
                    event.entity_id = posting_number_from_payload
                    fixed_from_payload_count += 1
                    logger.info(f"从 payload 修复 webhook_event {event.id}: {posting_id} -> {posting_number_from_payload}")
                else:
                    not_found_count += 1
                    logger.warning(f"未找到 posting_id={posting_id} 对应的 posting_number，payload 也没有 (webhook_event.id={event.id})")

        # 3. 提交更改
        await session.commit()

        logger.info(f"修复完成！从数据库: {fixed_count}, 从 payload: {fixed_from_payload_count}, 未找到: {not_found_count}")


if __name__ == "__main__":
    asyncio.run(fix_webhook_posting_entity_ids())
