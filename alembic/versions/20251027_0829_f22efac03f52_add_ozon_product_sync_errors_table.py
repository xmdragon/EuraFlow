"""add_ozon_product_sync_errors_table

Revision ID: f22efac03f52
Revises: ae728410fd64
Create Date: 2025-10-27 08:29:35.823825

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'f22efac03f52'
down_revision = 'ae728410fd64'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 创建 ozon_product_sync_errors 表
    op.create_table(
        'ozon_product_sync_errors',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False, comment='店铺ID'),
        sa.Column('product_id', sa.BigInteger(), nullable=True, comment='关联的商品ID'),
        sa.Column('offer_id', sa.String(100), nullable=False, comment='商品 offer_id'),
        sa.Column('task_id', sa.BigInteger(), nullable=True, comment='OZON 任务ID'),
        sa.Column('status', sa.String(50), nullable=True, comment='同步状态'),
        sa.Column('errors', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='错误详情数组'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # 创建索引
    op.create_index('ix_ozon_product_sync_errors_shop_id', 'ozon_product_sync_errors', ['shop_id'])
    op.create_index('ix_ozon_product_sync_errors_product_id', 'ozon_product_sync_errors', ['product_id'])
    op.create_index('ix_ozon_product_sync_errors_offer_id', 'ozon_product_sync_errors', ['offer_id'])
    op.create_index('ix_ozon_product_sync_errors_task_id', 'ozon_product_sync_errors', ['task_id'])

    # 创建外键
    op.create_foreign_key(
        'fk_ozon_product_sync_errors_product_id',
        'ozon_product_sync_errors', 'ozon_products',
        ['product_id'], ['id'],
        ondelete='CASCADE'
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除外键
    op.drop_constraint('fk_ozon_product_sync_errors_product_id', 'ozon_product_sync_errors', type_='foreignkey')

    # 删除索引
    op.drop_index('ix_ozon_product_sync_errors_task_id', 'ozon_product_sync_errors')
    op.drop_index('ix_ozon_product_sync_errors_offer_id', 'ozon_product_sync_errors')
    op.drop_index('ix_ozon_product_sync_errors_product_id', 'ozon_product_sync_errors')
    op.drop_index('ix_ozon_product_sync_errors_shop_id', 'ozon_product_sync_errors')

    # 删除表
    op.drop_table('ozon_product_sync_errors')