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
    # 使用 IF NOT EXISTS 避免重复创建索引
    # 这些索引可能已在 init_001 中创建
    op.execute("COMMIT")  # 结束当前事务

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_ozon_products_shop_status
        ON ozon_products (shop_id, status)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_ozon_products_shop_created
        ON ozon_products (shop_id, created_at)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_ozon_products_shop_updated
        ON ozon_products (shop_id, updated_at)
    """)


def downgrade() -> None:
    op.drop_index('idx_ozon_products_shop_updated', table_name='ozon_products')
    op.drop_index('idx_ozon_products_shop_created', table_name='ozon_products')
    op.drop_index('idx_ozon_products_shop_status', table_name='ozon_products')
