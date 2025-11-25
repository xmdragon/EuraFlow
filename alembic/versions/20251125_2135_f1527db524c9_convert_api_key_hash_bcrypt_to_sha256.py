"""convert_api_key_hash_bcrypt_to_sha256

API Key 哈希算法从 bcrypt 迁移到 SHA256：
- bcrypt: 慢哈希，无法直接查询，验证 O(n)
- SHA256: 快速哈希，可直接查询，验证 O(1)

由于 bcrypt 是单向哈希，无法转换为 SHA256，
此迁移会删除所有现有的 API Key，用户需要重新生成。

Revision ID: f1527db524c9
Revises: 0cb6b0779e29
Create Date: 2025-11-25 21:35:21.730891

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f1527db524c9'
down_revision = '0cb6b0779e29'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    删除所有使用旧 bcrypt 哈希的 API Key。
    用户需要在系统中重新生成 API Key。
    """
    # 删除所有旧的 API Key（bcrypt hash 无法转换）
    op.execute("DELETE FROM api_keys")

    # 添加注释说明新的哈希算法
    op.execute(
        "COMMENT ON COLUMN api_keys.key_hash IS 'API Key哈希值（SHA256，64字符hex）'"
    )


def downgrade() -> None:
    """
    无法回滚已删除的数据，仅恢复注释。
    """
    op.execute(
        "COMMENT ON COLUMN api_keys.key_hash IS 'API Key哈希值（bcrypt）'"
    )
