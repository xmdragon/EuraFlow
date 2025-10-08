"""add_ozon_order_id_and_order_number_fields

Revision ID: d7cdcefb56b3
Revises: add_api_keys_001
Create Date: 2025-10-08 09:11:47.262279

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd7cdcefb56b3'
down_revision = 'add_api_keys_001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Add ozon_order_id and ozon_order_number columns to ozon_orders table
    # Step 1: Add columns as nullable first
    op.add_column('ozon_orders', sa.Column('ozon_order_id', sa.String(length=100), nullable=True, comment='Ozon订单号'))
    op.add_column('ozon_orders', sa.Column('ozon_order_number', sa.String(length=100), nullable=True, comment='Ozon订单编号'))

    # Step 2: Update existing rows to populate ozon_order_id from order_id (temporarily)
    # This ensures no NULL values before making it NOT NULL
    op.execute("""
        UPDATE ozon_orders
        SET ozon_order_id = COALESCE(order_id, 'MIGRATED_' || id::text)
        WHERE ozon_order_id IS NULL
    """)

    # Step 3: Make ozon_order_id NOT NULL after data migration
    op.alter_column('ozon_orders', 'ozon_order_id', nullable=False)


def downgrade() -> None:
    """Downgrade database schema"""
    # Remove the added columns
    op.drop_column('ozon_orders', 'ozon_order_number')
    op.drop_column('ozon_orders', 'ozon_order_id')