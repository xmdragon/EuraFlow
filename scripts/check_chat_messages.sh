#!/bin/bash
# 检查聊天消息（需要在EuraFlow目录下运行）

CHAT_ID="${1:-778bb005-90da-4780-96a2-893364e121bb}"

cd "$(dirname "$0")/.." || exit 1

PYTHONPATH=. ./venv/bin/python3 << EOF
import sys
sys.path.insert(0, '.')

from plugins.ef.channels.ozon.models.chat import OzonChat, OzonChatMessage
from core.database import get_db_manager
import asyncio

async def check_messages():
    chat_id = "$CHAT_ID"
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

        print(f'\\n最近 {len(messages)} 条消息:')
        print('=' * 80)

        for i, msg in enumerate(messages, 1):
            print(f'\\n[{i}] Message ID: {msg.message_id}')
            print(f'    Sender: {msg.sender_type} - {msg.sender_name}')
            print(f'    Content: {msg.content[:100]}{"..." if msg.content and len(msg.content) > 100 else ""}')
            print(f'    Content length: {len(msg.content) if msg.content else 0} 字符')
            print(f'    Created: {msg.created_at}')

asyncio.run(check_messages())
EOF
