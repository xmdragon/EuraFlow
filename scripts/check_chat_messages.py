#!/usr/bin/env python3
"""
诊断聊天消息数据脚本
检查数据库中消息的content字段是否为空
"""
import asyncio
import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, func, and_
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.chat import OzonChatMessage, OzonChat


async def check_messages():
    """检查聊天消息数据"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        # 1. 统计总消息数
        total_stmt = select(func.count()).select_from(OzonChatMessage)
        total_messages = await session.scalar(total_stmt)
        print(f"\n📊 总消息数: {total_messages}")

        # 2. 统计空content的消息数
        empty_content_stmt = select(func.count()).select_from(OzonChatMessage).where(
            and_(
                OzonChatMessage.content.is_(None) | (OzonChatMessage.content == ""),
                OzonChatMessage.is_deleted == False
            )
        )
        empty_count = await session.scalar(empty_content_stmt)
        print(f"❌ content为空的消息数: {empty_count}")

        # 3. 统计有content的消息数
        has_content_stmt = select(func.count()).select_from(OzonChatMessage).where(
            and_(
                OzonChatMessage.content.isnot(None),
                OzonChatMessage.content != "",
                OzonChatMessage.is_deleted == False
            )
        )
        has_content_count = await session.scalar(has_content_stmt)
        print(f"✅ content有值的消息数: {has_content_count}")

        # 4. 显示一些空content的消息样例
        if empty_count > 0:
            print(f"\n🔍 空content消息样例（前5条）:")
            empty_msgs_stmt = (
                select(OzonChatMessage)
                .where(
                    and_(
                        OzonChatMessage.content.is_(None) | (OzonChatMessage.content == ""),
                        OzonChatMessage.is_deleted == False
                    )
                )
                .limit(5)
            )
            result = await session.execute(empty_msgs_stmt)
            empty_messages = result.scalars().all()

            for msg in empty_messages:
                print(f"\n  消息ID: {msg.message_id}")
                print(f"  聊天ID: {msg.chat_id}")
                print(f"  发送者: {msg.sender_name} ({msg.sender_type})")
                print(f"  content: {repr(msg.content)}")
                print(f"  content_data: {msg.content_data}")
                print(f"  创建时间: {msg.created_at}")

        # 5. 按店铺统计
        print(f"\n📊 按店铺统计消息:")
        shop_stats_stmt = (
            select(
                OzonChatMessage.shop_id,
                func.count(OzonChatMessage.id).label("total"),
                func.sum(
                    func.case(
                        (OzonChatMessage.content.is_(None) | (OzonChatMessage.content == ""), 1),
                        else_=0
                    )
                ).label("empty_content")
            )
            .where(OzonChatMessage.is_deleted == False)
            .group_by(OzonChatMessage.shop_id)
        )
        result = await session.execute(shop_stats_stmt)
        shop_stats = result.all()

        for shop_id, total, empty in shop_stats:
            print(f"  店铺 {shop_id}: {total} 条消息, {empty} 条空content")

        # 6. 检查最近的聊天消息
        print(f"\n🕐 最近的10条消息:")
        recent_stmt = (
            select(OzonChatMessage)
            .where(OzonChatMessage.is_deleted == False)
            .order_by(OzonChatMessage.created_at.desc())
            .limit(10)
        )
        result = await session.execute(recent_stmt)
        recent_messages = result.scalars().all()

        for msg in recent_messages:
            content_preview = msg.content[:50] if msg.content else "[空]"
            print(f"  {msg.created_at} | {msg.sender_name:15} | {content_preview}")


if __name__ == "__main__":
    asyncio.run(check_messages())
