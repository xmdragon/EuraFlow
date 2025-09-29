"""add_user_id_to_product_selection

Revision ID: a9519ef9136d
Revises: ee5dc97e18d9
Create Date: 2025-09-29 12:16:20.603694

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a9519ef9136d'
down_revision = 'ee5dc97e18d9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加user_id列
    op.add_column('ozon_product_selection_items',
                  sa.Column('user_id', sa.Integer(), nullable=True, comment='用户ID'))

    # 为现有数据设置默认用户ID（假设为用户ID 1）
    op.execute("UPDATE ozon_product_selection_items SET user_id = 1 WHERE user_id IS NULL")

    # 设置列为非空
    op.alter_column('ozon_product_selection_items', 'user_id', nullable=False)

    # 创建外键约束
    op.create_foreign_key('fk_product_selection_user_id',
                         'ozon_product_selection_items',
                         'users',
                         ['user_id'],
                         ['id'])

    # 创建索引
    op.create_index('idx_product_selection_user_id',
                    'ozon_product_selection_items',
                    ['user_id'])

    # 创建用户+商品的复合索引
    op.create_index('idx_user_product_name',
                    'ozon_product_selection_items',
                    ['user_id', 'product_id', 'product_name_ru'])


def downgrade() -> None:
    """Downgrade database schema"""
    # 移除索引
    op.drop_index('idx_user_product_name', 'ozon_product_selection_items')
    op.drop_index('idx_product_selection_user_id', 'ozon_product_selection_items')

    # 移除外键约束
    op.drop_constraint('fk_product_selection_user_id',
                       'ozon_product_selection_items',
                       type_='foreignkey')

    # 移除列
    op.drop_column('ozon_product_selection_items', 'user_id')