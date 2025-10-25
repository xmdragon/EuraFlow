"""remove_sku_field_from_ozon_products

Revision ID: 1560ebc0f694
Revises: aa422cda342d
Create Date: 2025-10-25 10:02:48.253628

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1560ebc0f694'
down_revision = 'aa422cda342d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema - Remove redundant sku field"""
    # 删除 ozon_products 表的 sku 列（sku 字段完全冗余，等于 offer_id）
    op.drop_column('ozon_products', 'sku')

    # 删除 ozon_promotion_products 表的 sku 列
    op.drop_column('ozon_promotion_products', 'sku')


def downgrade() -> None:
    """Downgrade database schema - Restore sku field from offer_id"""
    # 回滚：重新添加 ozon_products.sku 列并从 offer_id 复制数据
    op.add_column('ozon_products',
        sa.Column('sku', sa.String(100), nullable=False, server_default=''))
    # 从 offer_id 复制数据到 sku
    op.execute("UPDATE ozon_products SET sku = offer_id")

    # 回滚：重新添加 ozon_promotion_products.sku 列
    op.add_column('ozon_promotion_products',
        sa.Column('sku', sa.String(100), nullable=True))