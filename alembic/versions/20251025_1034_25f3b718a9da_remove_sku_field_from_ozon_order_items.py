"""remove_sku_field_from_ozon_order_items

Revision ID: 25f3b718a9da
Revises: 73a29e73b774
Create Date: 2025-10-25 10:34:01.795698

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '25f3b718a9da'
down_revision = '73a29e73b774'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema - Remove redundant sku field from order items"""
    # 1. Drop old index on sku
    op.drop_index('idx_ozon_order_items_sku', table_name='ozon_order_items')

    # 2. Create new index on offer_id
    op.create_index('idx_ozon_order_items_offer_id', 'ozon_order_items', ['offer_id'])

    # 3. Drop the redundant sku column (use offer_id and ozon_sku instead)
    op.drop_column('ozon_order_items', 'sku')


def downgrade() -> None:
    """Downgrade database schema - Restore sku field from offer_id"""
    # 1. Restore sku column (will be populated from offer_id)
    op.add_column('ozon_order_items',
        sa.Column('sku', sa.String(100), nullable=False, server_default='')
    )

    # 2. Copy data from offer_id to sku
    op.execute("UPDATE ozon_order_items SET sku = offer_id WHERE offer_id IS NOT NULL")
    op.execute("UPDATE ozon_order_items SET sku = '' WHERE offer_id IS NULL")

    # 3. Drop new index on offer_id
    op.drop_index('idx_ozon_order_items_offer_id', table_name='ozon_order_items')

    # 4. Restore old index on sku
    op.create_index('idx_ozon_order_items_sku', 'ozon_order_items', ['sku'])