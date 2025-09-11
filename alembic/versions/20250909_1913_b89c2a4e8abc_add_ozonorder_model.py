"""Add OzonOrder model

Revision ID: b89c2a4e8abc
Revises: fe44b4ac0e75
Create Date: 2025-09-09 19:13:45.715021

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'b89c2a4e8abc'
down_revision = 'fe44b4ac0e75'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Create ozon_orders table
    op.create_table('ozon_orders',
        sa.Column('id', sa.BigInteger(), nullable=False, comment='订单ID'),
        sa.Column('shop_id', sa.BigInteger(), nullable=False, comment='店铺ID'),
        sa.Column('order_id', sa.String(length=100), nullable=False, comment='订单ID'),
        sa.Column('order_number', sa.String(length=100), nullable=False, comment='订单号'),
        sa.Column('posting_number', sa.String(length=100), nullable=False, comment='发货单号'),
        sa.Column('status', sa.String(length=50), nullable=False, comment='订单状态'),
        sa.Column('substatus', sa.String(length=50), nullable=True, comment='子状态'),
        sa.Column('delivery_type', sa.String(length=20), nullable=False, comment='配送类型 FBS/FBO/CrossDock'),
        sa.Column('is_express', sa.Boolean(), nullable=False, comment='是否快递'),
        sa.Column('is_premium', sa.Boolean(), nullable=False, comment='是否优质订单'),
        sa.Column('total_price', sa.Numeric(precision=18, scale=4), nullable=False, comment='订单总额'),
        sa.Column('products_price', sa.Numeric(precision=18, scale=4), nullable=True, comment='商品总额'),
        sa.Column('delivery_price', sa.Numeric(precision=18, scale=4), nullable=True, comment='运费'),
        sa.Column('commission_amount', sa.Numeric(precision=18, scale=4), nullable=True, comment='佣金'),
        sa.Column('customer_id', sa.String(length=100), nullable=True, comment='客户ID'),
        sa.Column('customer_phone', sa.String(length=50), nullable=True, comment='客户电话'),
        sa.Column('customer_email', sa.String(length=200), nullable=True, comment='客户邮箱'),
        sa.Column('delivery_address', postgresql.JSON(astext_type=sa.Text()), nullable=True, comment='配送地址'),
        sa.Column('delivery_method', sa.String(length=100), nullable=True, comment='配送方式'),
        sa.Column('tracking_number', sa.String(length=100), nullable=True, comment='运单号'),
        sa.Column('items', postgresql.JSON(astext_type=sa.Text()), nullable=True, comment='订单商品'),
        sa.Column('in_process_at', sa.DateTime(timezone=True), nullable=True, comment='处理时间'),
        sa.Column('shipment_date', sa.DateTime(timezone=True), nullable=True, comment='发货截止时间'),
        sa.Column('delivering_date', sa.DateTime(timezone=True), nullable=True, comment='配送时间'),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True, comment='送达时间'),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True, comment='取消时间'),
        sa.Column('cancel_reason', sa.Text(), nullable=True, comment='取消原因'),
        sa.Column('analytics_data', postgresql.JSON(astext_type=sa.Text()), nullable=True, comment='分析数据'),
        sa.Column('financial_data', postgresql.JSON(astext_type=sa.Text()), nullable=True, comment='财务数据'),
        sa.Column('sync_status', sa.String(length=20), nullable=False, comment='同步状态'),
        sa.Column('sync_error', sa.Text(), nullable=True, comment='同步错误信息'),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True, comment='最后同步时间'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['shop_id'], ['ozon_shops.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('shop_id', 'posting_number', name='uq_ozon_order_shop_posting')
    )
    
    # Create indexes
    op.create_index('ix_ozon_orders_shop_id', 'ozon_orders', ['shop_id'])
    op.create_index('ix_ozon_orders_order_number', 'ozon_orders', ['order_number'])
    op.create_index('ix_ozon_orders_posting_number', 'ozon_orders', ['posting_number'])
    op.create_index('ix_ozon_orders_status', 'ozon_orders', ['status'])
    op.create_index('ix_ozon_orders_delivery_type', 'ozon_orders', ['delivery_type'])
    op.create_index('ix_ozon_orders_created_at', 'ozon_orders', ['created_at'])


def downgrade() -> None:
    """Downgrade database schema"""
    # Drop indexes
    op.drop_index('ix_ozon_orders_created_at', 'ozon_orders')
    op.drop_index('ix_ozon_orders_delivery_type', 'ozon_orders')
    op.drop_index('ix_ozon_orders_status', 'ozon_orders')
    op.drop_index('ix_ozon_orders_posting_number', 'ozon_orders')
    op.drop_index('ix_ozon_orders_order_number', 'ozon_orders')
    op.drop_index('ix_ozon_orders_shop_id', 'ozon_orders')
    
    # Drop table
    op.drop_table('ozon_orders')