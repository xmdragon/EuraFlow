"""add_is_deprecated_to_ozon_categories

Revision ID: a4e04bfa37fc
Revises: a3805b5a148a
Create Date: 2025-10-30 22:31:23.005820

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a4e04bfa37fc'
down_revision = 'a3805b5a148a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 is_deprecated 字段，默认为 False
    op.add_column('ozon_categories', sa.Column('is_deprecated', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除 is_deprecated 字段
    op.drop_column('ozon_categories', 'is_deprecated')