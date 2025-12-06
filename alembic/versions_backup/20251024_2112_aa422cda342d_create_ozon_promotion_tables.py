"""create_ozon_promotion_tables

Revision ID: aa422cda342d
Revises: 59ac4307e6e7
Create Date: 2025-10-24 21:12:47.220283

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'aa422cda342d'
down_revision = '59ac4307e6e7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 创建促销活动表
    op.create_table(
        'ozon_promotion_actions',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('action_id', sa.BigInteger(), nullable=False),
        sa.Column('title', sa.String(length=500), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('date_start', sa.DateTime(timezone=True), nullable=True),
        sa.Column('date_end', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('auto_cancel_enabled', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('raw_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text("(NOW() AT TIME ZONE 'UTC')"), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text("(NOW() AT TIME ZONE 'UTC')"), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('shop_id', 'action_id', name='uq_ozon_promotion_actions_shop_action')
    )
    op.create_index('idx_ozon_promotion_actions_shop', 'ozon_promotion_actions', ['shop_id'])
    op.create_index('idx_ozon_promotion_actions_shop_status', 'ozon_promotion_actions', ['shop_id', 'status'])
    op.create_index('idx_ozon_promotion_actions_auto_cancel', 'ozon_promotion_actions', ['shop_id', 'auto_cancel_enabled'])

    # 创建商品活动关联表
    op.create_table(
        'ozon_promotion_products',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('action_id', sa.BigInteger(), nullable=False),
        sa.Column('product_id', sa.BigInteger(), nullable=True),
        sa.Column('ozon_product_id', sa.BigInteger(), nullable=True),
        sa.Column('sku', sa.String(length=100), nullable=True),
        sa.Column('status', sa.String(length=50), server_default='candidate', nullable=False),
        sa.Column('promotion_price', sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column('promotion_stock', sa.Integer(), nullable=True),
        sa.Column('add_mode', sa.String(length=50), server_default='automatic', nullable=False),
        sa.Column('activated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deactivated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('raw_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text("(NOW() AT TIME ZONE 'UTC')"), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text("(NOW() AT TIME ZONE 'UTC')"), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['product_id'], ['ozon_products.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('shop_id', 'action_id', 'product_id', name='uq_ozon_promotion_products_shop_action_product')
    )
    op.create_index('idx_ozon_promotion_products_shop_action_status', 'ozon_promotion_products', ['shop_id', 'action_id', 'status'])
    op.create_index('idx_ozon_promotion_products_shop_action_mode', 'ozon_promotion_products', ['shop_id', 'action_id', 'add_mode'])
    op.create_index('idx_ozon_promotion_products_product', 'ozon_promotion_products', ['product_id'])
    op.create_index('idx_ozon_promotion_products_ozon_product', 'ozon_promotion_products', ['ozon_product_id'])


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除商品活动关联表
    op.drop_index('idx_ozon_promotion_products_ozon_product', table_name='ozon_promotion_products')
    op.drop_index('idx_ozon_promotion_products_product', table_name='ozon_promotion_products')
    op.drop_index('idx_ozon_promotion_products_shop_action_mode', table_name='ozon_promotion_products')
    op.drop_index('idx_ozon_promotion_products_shop_action_status', table_name='ozon_promotion_products')
    op.drop_table('ozon_promotion_products')

    # 删除促销活动表
    op.drop_index('idx_ozon_promotion_actions_auto_cancel', table_name='ozon_promotion_actions')
    op.drop_index('idx_ozon_promotion_actions_shop_status', table_name='ozon_promotion_actions')
    op.drop_index('idx_ozon_promotion_actions_shop', table_name='ozon_promotion_actions')
    op.drop_table('ozon_promotion_actions')
