"""add_source_row_index_to_product_selection

Revision ID: cbf9538952ce
Revises: 0a79cc30beb0
Create Date: 2025-10-26 14:07:33.514901

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'cbf9538952ce'
down_revision = '0a79cc30beb0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 source_row_index 字段
    op.add_column('ozon_product_selection_items',
                  sa.Column('source_row_index', sa.Integer(), nullable=True, comment='CSV原始行号（保持导入顺序）'))
    # 创建索引
    op.create_index('idx_source_row_index', 'ozon_product_selection_items', ['source_row_index'], unique=False)


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_source_row_index', table_name='ozon_product_selection_items')
    # 删除字段
    op.drop_column('ozon_product_selection_items', 'source_row_index')