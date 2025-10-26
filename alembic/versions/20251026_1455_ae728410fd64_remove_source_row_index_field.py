"""remove_source_row_index_field

Revision ID: ae728410fd64
Revises: cbf9538952ce
Create Date: 2025-10-26 14:55:47.837208

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ae728410fd64'
down_revision = 'cbf9538952ce'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """删除 source_row_index 字段和索引"""
    # 删除索引
    op.drop_index('ix_product_selection_items_source_row_index', table_name='product_selection_items')
    # 删除字段
    op.drop_column('product_selection_items', 'source_row_index')


def downgrade() -> None:
    """恢复 source_row_index 字段和索引"""
    # 恢复字段
    op.add_column('product_selection_items',
                  sa.Column('source_row_index', sa.Integer(), nullable=True, comment='CSV原始行号（保持导入顺序）'))
    # 恢复索引
    op.create_index('ix_product_selection_items_source_row_index', 'product_selection_items', ['source_row_index'])