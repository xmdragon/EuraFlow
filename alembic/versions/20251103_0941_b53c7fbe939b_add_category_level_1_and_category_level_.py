"""add category_level_1 and category_level_2 to product_selection_items

Revision ID: b53c7fbe939b
Revises: 7915f2c1b727
Create Date: 2025-11-03 09:41:28.682318

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b53c7fbe939b'
down_revision = '7915f2c1b727'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加一级类目字段
    op.add_column('ozon_product_selection_items',
                  sa.Column('category_level_1', sa.String(200), nullable=True, comment='一级类目'))
    # 添加二级类目字段
    op.add_column('ozon_product_selection_items',
                  sa.Column('category_level_2', sa.String(200), nullable=True, comment='二级类目'))

    # 创建索引以优化类目筛选查询
    op.create_index('idx_category_level_1', 'ozon_product_selection_items', ['category_level_1'])
    op.create_index('idx_category_level_2', 'ozon_product_selection_items', ['category_level_2'])


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_category_level_2', 'ozon_product_selection_items')
    op.drop_index('idx_category_level_1', 'ozon_product_selection_items')

    # 删除字段
    op.drop_column('ozon_product_selection_items', 'category_level_2')
    op.drop_column('ozon_product_selection_items', 'category_level_1')