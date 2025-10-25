#!/usr/bin/env python3
"""检查webhook事件"""
import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from plugins.ef.channels.ozon.models.sync import OzonWebhookEvent
from ef_core.database import get_db_manager
import asyncio
import json

async def check_webhook_events():
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        from sqlalchemy import select, desc, or_

        # 查询最近的聊天消息webhook事件
        stmt = select(OzonWebhookEvent).where(
            or_(
                OzonWebhookEvent.event_type == 'TYPE_NEW_MESSAGE',
                OzonWebhookEvent.event_type == 'chat.message_created'
            )
        ).order_by(desc(OzonWebhookEvent.created_at)).limit(5)

        result = await session.execute(stmt)
        events = result.scalars().all()

        print(f'找到 {len(events)} 个聊天消息webhook事件')
        print('=' * 80)

        for i, event in enumerate(events, 1):
            print(f'\n[{i}] Event ID: {event.id}')
            print(f'    Event Type: {event.event_type}')
            print(f'    Shop ID: {event.shop_id}')
            print(f'    Status: {event.status}')
            print(f'    Created: {event.created_at}')
            if event.error_message:
                print(f'    Error: {event.error_message}')
            print(f'    Payload:')
            print(json.dumps(event.payload, indent=6, ensure_ascii=False))

if __name__ == '__main__':
    asyncio.run(check_webhook_events())
