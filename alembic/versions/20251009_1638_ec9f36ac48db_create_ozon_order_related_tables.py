"""create_ozon_order_related_tables

Revision ID: ec9f36ac48db
Revises: b74b49cec77f
Create Date: 2025-10-09 16:38:47.860399

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'ec9f36ac48db'
down_revision = 'b74b49cec77f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""

    # 创建 ozon_postings 表
    op.create_table(
        'ozon_postings',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('order_id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('posting_number', sa.String(length=100), nullable=False),
        sa.Column('ozon_posting_number', sa.String(length=100), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.Column('substatus', sa.String(length=100), nullable=True),
        sa.Column('shipment_date', sa.DateTime(), nullable=True),
        sa.Column('delivery_method_id', sa.Integer(), nullable=True),
        sa.Column('delivery_method_name', sa.String(length=200), nullable=True),
        sa.Column('warehouse_id', sa.Integer(), nullable=True),
        sa.Column('warehouse_name', sa.String(length=200), nullable=True),
        sa.Column('packages_count', sa.Integer(), nullable=True, server_default='1'),
        sa.Column('total_weight', sa.Numeric(precision=10, scale=3), nullable=True),
        sa.Column('is_cancelled', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('cancel_reason_id', sa.Integer(), nullable=True),
        sa.Column('cancel_reason', sa.String(length=500), nullable=True),
        sa.Column('raw_payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('in_process_at', sa.DateTime(), nullable=True),
        sa.Column('shipped_at', sa.DateTime(), nullable=True),
        sa.Column('delivered_at', sa.DateTime(), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['order_id'], ['ozon_orders.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('posting_number')
    )
    op.create_index('idx_ozon_postings_status', 'ozon_postings', ['shop_id', 'status'])
    op.create_index('idx_ozon_postings_date', 'ozon_postings', ['shop_id', 'shipment_date'])
    op.create_index('idx_ozon_postings_warehouse', 'ozon_postings', ['warehouse_id', 'status'])

    # 创建 ozon_order_items 表
    op.create_table(
        'ozon_order_items',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('order_id', sa.BigInteger(), nullable=False),
        sa.Column('sku', sa.String(length=100), nullable=False),
        sa.Column('offer_id', sa.String(length=100), nullable=True),
        sa.Column('ozon_sku', sa.BigInteger(), nullable=True),
        sa.Column('name', sa.String(length=500), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('price', sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column('discount', sa.Numeric(precision=18, scale=4), nullable=True, server_default='0'),
        sa.Column('total_amount', sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['order_id'], ['ozon_orders.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_ozon_order_items_sku', 'ozon_order_items', ['sku'])
    op.create_index('idx_ozon_order_items_order', 'ozon_order_items', ['order_id', 'status'])

    # 创建 ozon_shipment_packages 表
    op.create_table(
        'ozon_shipment_packages',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('posting_id', sa.BigInteger(), nullable=False),
        sa.Column('package_number', sa.String(length=100), nullable=False),
        sa.Column('tracking_number', sa.String(length=200), nullable=True),
        sa.Column('carrier_id', sa.Integer(), nullable=True),
        sa.Column('carrier_name', sa.String(length=200), nullable=True),
        sa.Column('carrier_code', sa.String(length=50), nullable=True),
        sa.Column('weight', sa.Numeric(precision=10, scale=3), nullable=True),
        sa.Column('width', sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column('height', sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column('length', sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column('label_url', sa.String(length=500), nullable=True),
        sa.Column('label_printed_at', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('status_updated_at', sa.DateTime(), nullable=True),
        sa.Column('tracking_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['posting_id'], ['ozon_postings.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('posting_id', 'package_number', name='uq_ozon_packages')
    )
    op.create_index('idx_ozon_packages_tracking', 'ozon_shipment_packages', ['tracking_number'])

    # 创建 ozon_refunds 表
    op.create_table(
        'ozon_refunds',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('order_id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('refund_id', sa.String(length=100), nullable=False),
        sa.Column('refund_type', sa.String(length=50), nullable=True),
        sa.Column('posting_id', sa.BigInteger(), nullable=True),
        sa.Column('refund_amount', sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column('commission_refund', sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column('refund_items', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('reason_id', sa.Integer(), nullable=True),
        sa.Column('reason', sa.String(length=500), nullable=True),
        sa.Column('customer_comment', sa.String(length=1000), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('requested_at', sa.DateTime(), nullable=False),
        sa.Column('approved_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['order_id'], ['ozon_orders.id'], ),
        sa.ForeignKeyConstraint(['posting_id'], ['ozon_postings.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('refund_id')
    )
    op.create_index('idx_ozon_refunds_status', 'ozon_refunds', ['shop_id', 'status'])
    op.create_index('idx_ozon_refunds_date', 'ozon_refunds', ['shop_id', 'requested_at'])


def downgrade() -> None:
    """Downgrade database schema"""

    # 删除表（注意顺序，先删除有外键依赖的表）
    op.drop_index('idx_ozon_refunds_date', table_name='ozon_refunds')
    op.drop_index('idx_ozon_refunds_status', table_name='ozon_refunds')
    op.drop_table('ozon_refunds')

    op.drop_index('idx_ozon_packages_tracking', table_name='ozon_shipment_packages')
    op.drop_table('ozon_shipment_packages')

    op.drop_index('idx_ozon_order_items_order', table_name='ozon_order_items')
    op.drop_index('idx_ozon_order_items_sku', table_name='ozon_order_items')
    op.drop_table('ozon_order_items')

    op.drop_index('idx_ozon_postings_warehouse', table_name='ozon_postings')
    op.drop_index('idx_ozon_postings_date', table_name='ozon_postings')
    op.drop_index('idx_ozon_postings_status', table_name='ozon_postings')
    op.drop_table('ozon_postings')