"""increase_chat_preview_to_1000

Revision ID: 59ac4307e6e7
Revises: 393aaca19516
Create Date: 2025-10-24 20:21:23.188815

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '59ac4307e6e7'
down_revision = '393aaca19516'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 修改 last_message_preview 字段长度从 500 到 1000
    op.alter_column('ozon_chats', 'last_message_preview',
                    existing_type=sa.String(length=500),
                    type_=sa.String(length=1000),
                    existing_nullable=True)


def downgrade() -> None:
    """Downgrade database schema"""
    # 恢复 last_message_preview 字段长度从 1000 到 500
    op.alter_column('ozon_chats', 'last_message_preview',
                    existing_type=sa.String(length=1000),
                    type_=sa.String(length=500),
                    existing_nullable=True)