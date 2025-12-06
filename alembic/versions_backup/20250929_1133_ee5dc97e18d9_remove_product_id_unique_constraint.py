"""remove_product_id_unique_constraint

Revision ID: ee5dc97e18d9
Revises: f80dfc685db5
Create Date: 2025-09-29 11:33:05.209127

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ee5dc97e18d9'
down_revision = 'f80dfc685db5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 移除product_id的唯一约束
    op.drop_constraint('ozon_product_selection_items_product_id_key',
                       'ozon_product_selection_items',
                       type_='unique')

    # 确保product_id列有索引（用于查询性能）
    op.create_index('idx_product_id',
                    'ozon_product_selection_items',
                    ['product_id'])

    # 添加复合索引用于唯一性查询
    op.create_index('idx_product_id_name',
                    'ozon_product_selection_items',
                    ['product_id', 'product_name_ru'])


def downgrade() -> None:
    """Downgrade database schema"""
    # 移除索引
    op.drop_index('idx_product_id_name', 'ozon_product_selection_items')
    op.drop_index('idx_product_id', 'ozon_product_selection_items')

    # 恢复唯一约束
    op.create_unique_constraint('ozon_product_selection_items_product_id_key',
                                'ozon_product_selection_items',
                                ['product_id'])