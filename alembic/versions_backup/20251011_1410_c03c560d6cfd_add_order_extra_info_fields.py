"""add_order_extra_info_fields

Revision ID: c03c560d6cfd
Revises: 18549e28ece0
Create Date: 2025-10-11 14:10:03.546596

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'c03c560d6cfd'
down_revision = '18549e28ece0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add missing timestamp fields to ozon_orders

    Note: purchase_price, domestic_tracking_number, material_cost, and order_notes
    already exist in the database. Only adding the timestamp fields.
    """
    # Check if columns exist before adding them
    conn = op.get_bind()

    # Add timestamp fields only if they don't exist
    result = conn.execute(sa.text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='ozon_orders'
        AND column_name IN ('purchase_price_updated_at', 'domestic_tracking_updated_at')
    """))
    existing_cols = {row[0] for row in result}

    if 'purchase_price_updated_at' not in existing_cols:
        op.add_column('ozon_orders', sa.Column('purchase_price_updated_at', postgresql.TIMESTAMP(timezone=True), nullable=True, comment='进货价格更新时间'))

    if 'domestic_tracking_updated_at' not in existing_cols:
        op.add_column('ozon_orders', sa.Column('domestic_tracking_updated_at', postgresql.TIMESTAMP(timezone=True), nullable=True, comment='国内物流单号更新时间'))


def downgrade() -> None:
    """Remove timestamp fields from ozon_orders"""
    # Only drop columns if they exist
    conn = op.get_bind()
    result = conn.execute(sa.text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='ozon_orders'
        AND column_name IN ('purchase_price_updated_at', 'domestic_tracking_updated_at')
    """))
    existing_cols = {row[0] for row in result}

    if 'domestic_tracking_updated_at' in existing_cols:
        op.drop_column('ozon_orders', 'domestic_tracking_updated_at')

    if 'purchase_price_updated_at' in existing_cols:
        op.drop_column('ozon_orders', 'purchase_price_updated_at')
