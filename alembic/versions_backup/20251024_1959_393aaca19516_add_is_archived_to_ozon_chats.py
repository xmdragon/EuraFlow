"""add_is_archived_to_ozon_chats

Revision ID: 393aaca19516
Revises: 63f940b2e851
Create Date: 2025-10-24 19:59:56.686934

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '393aaca19516'
down_revision = '63f940b2e851'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 is_archived 字段，默认值为 False
    op.add_column('ozon_chats', sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='false'))
    # 创建索引以优化归档状态查询
    op.create_index('ix_ozon_chats_is_archived', 'ozon_chats', ['is_archived'], unique=False)


def downgrade() -> None:
    """Downgrade database schema"""
    # 移除索引
    op.drop_index('ix_ozon_chats_is_archived', table_name='ozon_chats')
    # 移除字段
    op.drop_column('ozon_chats', 'is_archived')