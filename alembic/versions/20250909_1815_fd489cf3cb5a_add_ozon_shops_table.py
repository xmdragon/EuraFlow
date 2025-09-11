"""add_ozon_shops_table

Revision ID: fd489cf3cb5a
Revises: create_users_and_shops
Create Date: 2025-09-09 18:15:48.711739

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'fd489cf3cb5a'
down_revision = 'create_users_and_shops'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Create ozon_shops table with status as string instead of enum
    op.create_table('ozon_shops',
        sa.Column('id', sa.BigInteger(), nullable=False, comment='Ozon店铺ID'),
        sa.Column('shop_name', sa.String(length=200), nullable=False, comment='店铺名称'),
        sa.Column('platform', sa.String(length=50), nullable=False, server_default='ozon', comment='平台名称'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active', comment='店铺状态'),
        sa.Column('owner_user_id', sa.BigInteger(), nullable=False, comment='店铺所有者ID'),
        sa.Column('client_id', sa.String(length=200), nullable=False, comment='Ozon Client ID'),
        sa.Column('api_key_enc', sa.Text(), nullable=False, comment='加密的API Key'),
        sa.Column('config', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='{}', comment='店铺配置（Webhook、同步设置等）'),
        sa.Column('stats', postgresql.JSON(astext_type=sa.Text()), nullable=True, comment='店铺统计信息'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True, comment='最后同步时间'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('owner_user_id', 'shop_name', name='uq_ozon_shop_owner_name')
    )
    
    # Create index for better performance
    op.create_index('ix_ozon_shops_owner_user_id', 'ozon_shops', ['owner_user_id'])
    op.create_index('ix_ozon_shops_status', 'ozon_shops', ['status'])


def downgrade() -> None:
    """Downgrade database schema"""
    # Drop indexes
    op.drop_index('ix_ozon_shops_status', table_name='ozon_shops')
    op.drop_index('ix_ozon_shops_owner_user_id', table_name='ozon_shops')
    
    # Drop table
    op.drop_table('ozon_shops')