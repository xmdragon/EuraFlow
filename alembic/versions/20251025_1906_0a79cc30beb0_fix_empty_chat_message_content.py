"""fix empty chat message content

Revision ID: 0a79cc30beb0
Revises: 25f3b718a9da
Create Date: 2025-10-25 19:06:00.000000

修复历史数据：将 content 为空但 content_data 有值的消息，
从 content_data 数组中提取文本内容填充到 content 字段。

影响：
- 修复 Webhook 创建消息时只取 data[0] 导致的内容丢失问题
- 修复 Webhook 更新消息时字段不同步的问题
- 清理历史脏数据，确保 content 和 content_data 字段一致性
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0a79cc30beb0'
down_revision: Union[str, None] = '25f3b718a9da'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    修复 content 为空但 content_data 有值的聊天消息。

    执行逻辑：
    1. 找出所有 content 为空（NULL 或空字符串）但 content_data 有值的消息
    2. 从 content_data 数组中提取所有元素，用空格连接成字符串
    3. 更新 content 字段

    SQL 说明：
    - jsonb_array_length: 获取 JSONB 数组的长度
    - jsonb_array_elements_text: 将 JSONB 数组展开为文本行
    - string_agg: 聚合文本行，用空格连接
    """
    # 首先检查有多少条记录需要修复
    connection = op.get_bind()
    count_result = connection.execute(sa.text("""
        SELECT COUNT(*) as count
        FROM ozon_chat_messages
        WHERE (content IS NULL OR content = '')
          AND content_data IS NOT NULL
          AND jsonb_array_length(content_data) > 0
    """))

    count = count_result.scalar()

    if count > 0:
        print(f"⏳ 发现 {count} 条需要修复的消息记录...")

        # 执行修复
        result = connection.execute(sa.text("""
            UPDATE ozon_chat_messages
            SET content = (
                SELECT string_agg(value, ' ')
                FROM jsonb_array_elements_text(content_data)
            )
            WHERE (content IS NULL OR content = '')
              AND content_data IS NOT NULL
              AND jsonb_array_length(content_data) > 0
        """))

        updated = result.rowcount
        print(f"✅ 已修复 {updated} 条消息记录的 content 字段")
    else:
        print("✅ 没有需要修复的消息记录，跳过数据修复")


def downgrade() -> None:
    """
    回滚操作：不执行任何操作

    原因：
    1. 这是数据修复迁移，不是结构变更
    2. 回滚会导致数据不一致
    3. 修复操作是幂等的，可以安全地重复执行
    """
    print("⚠️  这是数据修复迁移，不支持回滚（回滚可能导致数据不一致）")
    pass
