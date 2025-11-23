"""增加 ozon_sync_checkpoints.error_message 字段长度

Revision ID: e9b49553b751
Revises: 138c109c8830
Create Date: 2025-11-23 22:33:47.779838

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e9b49553b751'
down_revision = '138c109c8830'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 增加 error_message 字段长度，防止超长错误消息导致写入失败
    op.alter_column('ozon_sync_checkpoints', 'error_message',
                    existing_type=sa.String(1000),
                    type_=sa.String(5000),
                    existing_nullable=True)


def downgrade() -> None:
    """Downgrade database schema"""
    # 回滚：恢复原始长度
    op.alter_column('ozon_sync_checkpoints', 'error_message',
                    existing_type=sa.String(5000),
                    type_=sa.String(1000),
                    existing_nullable=True)