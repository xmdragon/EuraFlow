"""Create ozon tables

Revision ID: fe44b4ac0e75
Revises: feb576aa7ef5
Create Date: 2025-09-09 19:08:20.644850

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'fe44b4ac0e75'
down_revision = 'feb576aa7ef5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Create ozon_shops table
    op.create_table('ozon_shops',
        sa.Column('id', sa.BigInteger(), nullable=False, comment='Ozon店铺ID'),
        sa.Column('shop_name', sa.String(length=200), nullable=False, comment='店铺名称'),
        sa.Column('platform', sa.String(length=50), nullable=False, comment='平台名称'),
        sa.Column('status', sa.String(length=20), nullable=False, comment='店铺状态'),
        sa.Column('owner_user_id', sa.BigInteger(), nullable=False, comment='店铺所有者ID'),
        sa.Column('client_id', sa.String(length=200), nullable=False, comment='Ozon Client ID'),
        sa.Column('api_key_enc', sa.Text(), nullable=False, comment='加密的API Key'),
        sa.Column('config', postgresql.JSON(astext_type=sa.Text()), nullable=False, comment='店铺配置（Webhook、同步设置等）'),
        sa.Column('stats', postgresql.JSON(astext_type=sa.Text()), nullable=True, comment='店铺统计信息'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True, comment='最后同步时间'),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('owner_user_id', 'shop_name', name='uq_ozon_shop_owner_name')
    )
    
    # Create ozon_products table
    op.create_table('ozon_products',
        sa.Column('id', sa.BigInteger(), nullable=False, comment='商品ID'),
        sa.Column('shop_id', sa.BigInteger(), nullable=False, comment='店铺ID'),
        sa.Column('sku', sa.String(length=100), nullable=False, comment='商品SKU'),
        sa.Column('offer_id', sa.String(length=100), nullable=False, comment='Ozon Offer ID'),
        sa.Column('ozon_product_id', sa.BigInteger(), nullable=True, comment='Ozon Product ID'),
        sa.Column('ozon_sku', sa.BigInteger(), nullable=True, comment='Ozon SKU'),
        sa.Column('title', sa.String(length=500), nullable=False, comment='商品标题'),
        sa.Column('description', sa.Text(), nullable=True, comment='商品描述'),
        sa.Column('barcode', sa.String(length=50), nullable=True, comment='条形码'),
        sa.Column('category_id', sa.Integer(), nullable=True, comment='类目ID'),
        sa.Column('brand', sa.String(length=200), nullable=True, comment='品牌'),
        sa.Column('status', sa.String(length=20), nullable=False, comment='商品状态'),
        sa.Column('visibility', sa.Boolean(), nullable=False, comment='是否可见'),
        sa.Column('is_archived', sa.Boolean(), nullable=False, comment='是否归档'),
        sa.Column('price', sa.Numeric(precision=18, scale=4), nullable=True, comment='当前价格'),
        sa.Column('old_price', sa.Numeric(precision=18, scale=4), nullable=True, comment='原价'),
        sa.Column('premium_price', sa.Numeric(precision=18, scale=4), nullable=True, comment='会员价'),
        sa.Column('cost', sa.Numeric(precision=18, scale=4), nullable=True, comment='成本价'),
        sa.Column('min_price', sa.Numeric(precision=18, scale=4), nullable=True, comment='最低价'),
        sa.Column('stock', sa.Integer(), nullable=False, comment='总库存'),
        sa.Column('reserved', sa.Integer(), nullable=False, comment='预留库存'),
        sa.Column('available', sa.Integer(), nullable=False, comment='可售库存'),
        sa.Column('weight', sa.Integer(), nullable=True, comment='重量(g)'),
        sa.Column('width', sa.Integer(), nullable=True, comment='宽度(mm)'),
        sa.Column('height', sa.Integer(), nullable=True, comment='高度(mm)'),
        sa.Column('depth', sa.Integer(), nullable=True, comment='深度(mm)'),
        sa.Column('images', postgresql.JSON(astext_type=sa.Text()), nullable=True, comment='商品图片'),
        sa.Column('attributes', postgresql.JSON(astext_type=sa.Text()), nullable=True, comment='商品属性'),
        sa.Column('sync_status', sa.String(length=20), nullable=False, comment='同步状态'),
        sa.Column('sync_error', sa.Text(), nullable=True, comment='同步错误信息'),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True, comment='最后同步时间'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['shop_id'], ['ozon_shops.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('shop_id', 'sku', name='uq_ozon_product_shop_sku')
    )
    
    # Create indexes
    op.create_index('ix_ozon_shops_owner_user_id', 'ozon_shops', ['owner_user_id'])
    op.create_index('ix_ozon_shops_status', 'ozon_shops', ['status'])
    op.create_index('ix_ozon_products_shop_id', 'ozon_products', ['shop_id'])
    op.create_index('ix_ozon_products_sku', 'ozon_products', ['sku'])
    op.create_index('ix_ozon_products_offer_id', 'ozon_products', ['offer_id'])
    op.create_index('ix_ozon_products_status', 'ozon_products', ['status'])
    op.create_index('ix_ozon_products_sync_status', 'ozon_products', ['sync_status'])


def downgrade() -> None:
    """Downgrade database schema"""
    # Drop indexes
    op.drop_index('ix_ozon_products_sync_status', 'ozon_products')
    op.drop_index('ix_ozon_products_status', 'ozon_products')
    op.drop_index('ix_ozon_products_offer_id', 'ozon_products')
    op.drop_index('ix_ozon_products_sku', 'ozon_products')
    op.drop_index('ix_ozon_products_shop_id', 'ozon_products')
    op.drop_index('ix_ozon_shops_status', 'ozon_shops')
    op.drop_index('ix_ozon_shops_owner_user_id', 'ozon_shops')
    
    # Drop tables
    op.drop_table('ozon_products')
    op.drop_table('ozon_shops')