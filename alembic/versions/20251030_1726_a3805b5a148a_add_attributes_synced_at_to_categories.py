"""add_attributes_synced_at_to_categories

Revision ID: a3805b5a148a
Revises: 66847d15939c
Create Date: 2025-10-30 17:26:42.014865

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3805b5a148a'
down_revision = '66847d15939c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 attributes_synced_at 字段到 ozon_categories 表
    op.add_column('ozon_categories',
        sa.Column('attributes_synced_at', sa.DateTime(timezone=True), nullable=True)
    )
    # 创建索引以优化查询性能
    op.create_index(
        'idx_ozon_categories_attrs_synced_at',
        'ozon_categories',
        ['attributes_synced_at'],
        unique=False
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_ozon_categories_attrs_synced_at', table_name='ozon_categories')
    # 删除字段
    op.drop_column('ozon_categories', 'attributes_synced_at')