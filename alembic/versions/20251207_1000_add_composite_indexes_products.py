"""add composite indexes for ozon_products

Revision ID: add_composite_idx
Revises: 20496bebe9fc
Create Date: 2025-12-07

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'add_composite_idx'
down_revision: Union[str, None] = '20496bebe9fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 使用 CONCURRENTLY 创建索引，避免锁表
    # 注意：CONCURRENTLY 不能在事务中执行，需要设置 autocommit
    op.execute("COMMIT")  # 结束当前事务
    
    op.create_index(
        'idx_ozon_products_shop_status',
        'ozon_products',
        ['shop_id', 'status'],
        unique=False,
        postgresql_concurrently=True
    )
    op.create_index(
        'idx_ozon_products_shop_created',
        'ozon_products',
        ['shop_id', 'created_at'],
        unique=False,
        postgresql_concurrently=True
    )
    op.create_index(
        'idx_ozon_products_shop_updated',
        'ozon_products',
        ['shop_id', 'updated_at'],
        unique=False,
        postgresql_concurrently=True
    )


def downgrade() -> None:
    op.drop_index('idx_ozon_products_shop_updated', table_name='ozon_products')
    op.drop_index('idx_ozon_products_shop_created', table_name='ozon_products')
    op.drop_index('idx_ozon_products_shop_status', table_name='ozon_products')
