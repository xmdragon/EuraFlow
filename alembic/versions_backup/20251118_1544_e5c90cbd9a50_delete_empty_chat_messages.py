"""delete_empty_chat_messages

Revision ID: e5c90cbd9a50
Revises: 81f93e05caf8
Create Date: 2025-11-18 15:44:10.268022

删除所有空内容的聊天消息（content 和 content_data 都为空的消息）

背景：
- OZON webhook 有时会发送空消息（data 数组为空）
- 这些消息没有实际价值，只会污染数据库和用户界面
- 未来会在应用层直接丢弃空消息，此迁移清理历史数据

影响：
- 删除 content 为空且 content_data 为空数组的消息
- 同时更新对应聊天会话的消息计数
"""
from alembic import op
import sqlalchemy as sa
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision = 'e5c90cbd9a50'
down_revision = '81f93e05caf8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """删除空内容的聊天消息"""
    connection = op.get_bind()

    print("⏳ 统计空消息记录...")

    # 统计空消息数量（content 为空且 content_data 为空数组或 NULL）
    count_result = connection.execute(sa.text("""
        SELECT COUNT(*) as count
        FROM ozon_chat_messages
        WHERE (content IS NULL OR content = '' OR TRIM(content) = '')
          AND (
              content_data IS NULL
              OR jsonb_typeof(content_data) = 'null'
              OR (jsonb_typeof(content_data) = 'array' AND jsonb_array_length(content_data) = 0)
          )
    """))

    total_count = count_result.scalar()
    print(f"📊 发现 {total_count} 条空消息")

    if total_count == 0:
        print("✅ 没有需要清理的空消息，跳过数据清理")
        return

    print(f"⏳ 正在删除 {total_count} 条空消息...")

    # 删除空消息
    delete_result = connection.execute(sa.text("""
        DELETE FROM ozon_chat_messages
        WHERE (content IS NULL OR content = '' OR TRIM(content) = '')
          AND (
              content_data IS NULL
              OR jsonb_typeof(content_data) = 'null'
              OR (jsonb_typeof(content_data) = 'array' AND jsonb_array_length(content_data) = 0)
          )
    """))

    deleted_count = delete_result.rowcount
    print(f"✅ 已删除 {deleted_count} 条空消息")

    # 更新聊天会话的消息计数
    print("⏳ 更新聊天会话的消息计数...")
    connection.execute(sa.text("""
        UPDATE ozon_chats
        SET message_count = (
            SELECT COUNT(*)
            FROM ozon_chat_messages
            WHERE ozon_chat_messages.chat_id = ozon_chats.chat_id
              AND ozon_chat_messages.shop_id = ozon_chats.shop_id
              AND ozon_chat_messages.is_deleted = false
        )
    """))

    print("✅ 聊天会话消息计数已更新")


def downgrade() -> None:
    """回滚操作：不支持回滚

    原因：
    1. 这是数据清理迁移，不是结构变更
    2. 删除的是无用数据，回滚无意义
    3. 无法恢复已删除的数据
    """
    print("⚠️  这是数据清理迁移，不支持回滚（已删除的空消息无法恢复）")
    pass