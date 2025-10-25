#!/usr/bin/env python3
"""检查聊天消息"""
import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from plugins.ef.channels.ozon.models.chat import OzonChat, OzonChatMessage
from ef_core.database import get_db_manager
import asyncio

async def check_messages(chat_id="778bb005-90da-4780-96a2-893364e121bb"):
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        from sqlalchemy import select, desc

        # 查询聊天信息
        chat_stmt = select(OzonChat).where(OzonChat.chat_id == chat_id)
        chat_result = await session.execute(chat_stmt)
        chat = chat_result.scalar_one_or_none()

        if chat:
            print(f'聊天ID: {chat.chat_id}')
            print(f'店铺ID: {chat.shop_id}')
            print(f'消息总数: {chat.message_count}')
            print(f'未读数: {chat.unread_count}')
            print(f'状态: {chat.status}')
            print(f'类型: {chat.chat_type}')
            print('=' * 80)
        else:
            print(f'聊天 {chat_id} 不存在')
            return

        # 查询消息
        msg_stmt = select(OzonChatMessage).where(
            OzonChatMessage.chat_id == chat_id
        ).order_by(desc(OzonChatMessage.created_at)).limit(10)

        msg_result = await session.execute(msg_stmt)
        messages = msg_result.scalars().all()

        print(f'\n最近 {len(messages)} 条消息:')
        print('=' * 80)

        for i, msg in enumerate(messages, 1):
            print(f'\n[{i}] Message ID: {msg.message_id}')
            print(f'    Sender: {msg.sender_type} - {msg.sender_name}')
            content_preview = msg.content[:100] if msg.content else ''
            if msg.content and len(msg.content) > 100:
                content_preview += '...'
            print(f'    Content: {content_preview}')
            print(f'    Content length: {len(msg.content) if msg.content else 0} 字符')
            print(f'    Created: {msg.created_at}')

if __name__ == '__main__':
    chat_id = sys.argv[1] if len(sys.argv) > 1 else "778bb005-90da-4780-96a2-893364e121bb"
    asyncio.run(check_messages(chat_id))
