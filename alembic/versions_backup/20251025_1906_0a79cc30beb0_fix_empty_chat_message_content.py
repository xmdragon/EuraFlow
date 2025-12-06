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
    - 使用 CTE 避免 jsonb_array_length 的类型检查问题
    """
    connection = op.get_bind()

    print("⏳ 统计需要修复的消息记录...")

    # 统计所有需要修复的记录（不预先判断数组长度，避免类型错误）
    total_count = connection.execute(sa.text("""
        SELECT COUNT(*) as count
        FROM ozon_chat_messages
        WHERE (content IS NULL OR content = '')
          AND content_data IS NOT NULL
          AND (
              (jsonb_typeof(content_data) = 'object' AND content_data ? 'data')
              OR jsonb_typeof(content_data) = 'array'
          )
    """)).scalar()

    print(f"📊 发现 {total_count} 条需要修复的消息")

    if total_count == 0:
        print("✅ 没有需要修复的消息记录，跳过数据修复")
        return

    # 使用 CASE 表达式一次性修复所有记录
    print(f"⏳ 正在修复 {total_count} 条消息...")
    result = connection.execute(sa.text("""
        UPDATE ozon_chat_messages
        SET content = CASE
            -- 情况1：object 类型，从 content_data->'data' 提取
            WHEN jsonb_typeof(content_data) = 'object'
                 AND content_data ? 'data'
                 AND jsonb_typeof(content_data->'data') = 'array'
            THEN (
                SELECT string_agg(value, ' ')
                FROM jsonb_array_elements_text(content_data->'data')
            )
            -- 情况2：array 类型，直接从 content_data 提取
            WHEN jsonb_typeof(content_data) = 'array'
            THEN (
                SELECT string_agg(value, ' ')
                FROM jsonb_array_elements_text(content_data)
            )
            -- 其他情况保持不变
            ELSE content
        END
        WHERE (content IS NULL OR content = '')
          AND content_data IS NOT NULL
          AND (
              (jsonb_typeof(content_data) = 'object' AND content_data ? 'data')
              OR jsonb_typeof(content_data) = 'array'
          )
    """))

    print(f"✅ 已成功修复 {result.rowcount} 条消息的 content 字段")


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
