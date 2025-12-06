"""add_batch_management_to_product_selection

Revision ID: d9f23d82f0b6
Revises: 874ac0b5c7e8
Create Date: 2025-10-13 10:15:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd9f23d82f0b6'
down_revision = '874ac0b5c7e8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加批次管理字段到 ozon_product_selection_items 表
    op.add_column('ozon_product_selection_items',
                  sa.Column('batch_id', sa.Integer(), nullable=True, comment='导入批次ID'))
    op.add_column('ozon_product_selection_items',
                  sa.Column('is_read', sa.Boolean(), nullable=False, server_default='false', comment='是否已读'))
    op.add_column('ozon_product_selection_items',
                  sa.Column('read_at', sa.DateTime(timezone=True), nullable=True, comment='标记已读时间'))

    # 添加外键约束
    op.create_foreign_key(
        'fk_product_selection_items_batch_id',
        'ozon_product_selection_items', 'ozon_product_selection_import_history',
        ['batch_id'], ['id'],
        ondelete='SET NULL'
    )

    # 添加索引
    op.create_index('ix_ozon_product_selection_items_batch_id',
                    'ozon_product_selection_items', ['batch_id'], unique=False)
    op.create_index('idx_batch_read',
                    'ozon_product_selection_items', ['batch_id', 'is_read'], unique=False)


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_batch_read', table_name='ozon_product_selection_items')
    op.drop_index('ix_ozon_product_selection_items_batch_id', table_name='ozon_product_selection_items')

    # 删除外键约束
    op.drop_constraint('fk_product_selection_items_batch_id',
                      'ozon_product_selection_items', type_='foreignkey')

    # 删除列
    op.drop_column('ozon_product_selection_items', 'read_at')
    op.drop_column('ozon_product_selection_items', 'is_read')
    op.drop_column('ozon_product_selection_items', 'batch_id')
