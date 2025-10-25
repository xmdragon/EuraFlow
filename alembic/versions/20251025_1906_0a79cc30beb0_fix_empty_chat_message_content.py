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
    2. 根据 content_data 的类型提取内容：
       - 如果是 object 类型（同步服务保存的完整 API 响应）：从 content_data->'data' 数组提取
       - 如果是 array 类型（Webhook 保存的 data 数组）：直接提取
    3. 用空格连接成字符串并更新 content 字段

    SQL 说明：
    - jsonb_typeof: 获取 JSONB 值的类型
    - jsonb_array_elements_text: 将 JSONB 数组展开为文本行
    - string_agg: 聚合文本行，用空格连接
    """
    connection = op.get_bind()

    # 统计需要修复的记录数
    print("⏳ 统计需要修复的消息记录...")

    # 情况1：content_data 是 object 类型（包含 'data' 字段）
    count_object = connection.execute(sa.text("""
        SELECT COUNT(*) as count
        FROM ozon_chat_messages
        WHERE (content IS NULL OR content = '')
          AND content_data IS NOT NULL
          AND jsonb_typeof(content_data) = 'object'
          AND content_data ? 'data'
          AND jsonb_typeof(content_data->'data') = 'array'
          AND jsonb_array_length(content_data->'data') > 0
    """)).scalar()

    # 情况2：content_data 是 array 类型
    count_array = connection.execute(sa.text("""
        SELECT COUNT(*) as count
        FROM ozon_chat_messages
        WHERE (content IS NULL OR content = '')
          AND content_data IS NOT NULL
          AND jsonb_typeof(content_data) = 'array'
          AND jsonb_array_length(content_data) > 0
    """)).scalar()

    total_count = count_object + count_array
    print(f"📊 发现 {total_count} 条需要修复的消息：")
    print(f"   - Object 类型（API 响应）: {count_object} 条")
    print(f"   - Array 类型（Webhook）: {count_array} 条")

    if total_count == 0:
        print("✅ 没有需要修复的消息记录，跳过数据修复")
        return

    # 修复情况1：content_data 是 object 类型
    if count_object > 0:
        print(f"⏳ 修复 {count_object} 条 Object 类型消息...")
        result1 = connection.execute(sa.text("""
            UPDATE ozon_chat_messages
            SET content = (
                SELECT string_agg(value, ' ')
                FROM jsonb_array_elements_text(content_data->'data')
            )
            WHERE (content IS NULL OR content = '')
              AND content_data IS NOT NULL
              AND jsonb_typeof(content_data) = 'object'
              AND content_data ? 'data'
              AND jsonb_typeof(content_data->'data') = 'array'
              AND jsonb_array_length(content_data->'data') > 0
        """))
        print(f"✅ 已修复 {result1.rowcount} 条 Object 类型消息")

    # 修复情况2：content_data 是 array 类型
    if count_array > 0:
        print(f"⏳ 修复 {count_array} 条 Array 类型消息...")
        result2 = connection.execute(sa.text("""
            UPDATE ozon_chat_messages
            SET content = (
                SELECT string_agg(value, ' ')
                FROM jsonb_array_elements_text(content_data)
            )
            WHERE (content IS NULL OR content = '')
              AND content_data IS NOT NULL
              AND jsonb_typeof(content_data) = 'array'
              AND jsonb_array_length(content_data) > 0
        """))
        print(f"✅ 已修复 {result2.rowcount} 条 Array 类型消息")

    print(f"✅ 数据修复完成！共修复 {total_count} 条消息的 content 字段")


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
