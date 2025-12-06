"""add_kuajing84_support

Revision ID: ff5864c02457
Revises: daa19950a0ed
Create Date: 2025-10-11 16:06:04.923000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'ff5864c02457'
down_revision = 'daa19950a0ed'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 1. 给 ozon_shops 表添加 kuajing84_config 字段
    op.add_column(
        'ozon_shops',
        sa.Column(
            'kuajing84_config',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment='跨境巴士配置（用户名、密码、Cookie等）'
        )
    )

    # 2. 创建 kuajing84_sync_logs 表
    op.create_table(
        'kuajing84_sync_logs',
        sa.Column('id', sa.BigInteger(), nullable=False, primary_key=True),
        sa.Column('ozon_order_id', sa.BigInteger(), nullable=False, comment='OZON订单ID'),
        sa.Column('shop_id', sa.Integer(), nullable=False, comment='店铺ID'),
        sa.Column('order_number', sa.String(length=100), nullable=False, comment='订单号'),
        sa.Column('logistics_order', sa.String(length=100), nullable=False, comment='国内物流单号'),
        sa.Column('kuajing84_oid', sa.String(length=100), nullable=True, comment='跨境巴士订单OID'),
        sa.Column('sync_status', sa.String(length=20), nullable=False, server_default='pending', comment='同步状态: pending/success/failed'),
        sa.Column('error_message', sa.Text(), nullable=True, comment='错误信息'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0', comment='尝试次数'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('synced_at', sa.DateTime(timezone=True), nullable=True, comment='同步成功时间'),
        sa.ForeignKeyConstraint(['ozon_order_id'], ['ozon_orders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # 3. 创建索引提升查询性能
    op.create_index('ix_kuajing84_sync_logs_order_id', 'kuajing84_sync_logs', ['ozon_order_id'])
    op.create_index('ix_kuajing84_sync_logs_status', 'kuajing84_sync_logs', ['shop_id', 'sync_status'])
    op.create_index('ix_kuajing84_sync_logs_order_number', 'kuajing84_sync_logs', ['order_number'])


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引和表
    op.drop_index('ix_kuajing84_sync_logs_order_number', table_name='kuajing84_sync_logs')
    op.drop_index('ix_kuajing84_sync_logs_status', table_name='kuajing84_sync_logs')
    op.drop_index('ix_kuajing84_sync_logs_order_id', table_name='kuajing84_sync_logs')
    op.drop_table('kuajing84_sync_logs')

    # 删除配置字段
    op.drop_column('ozon_shops', 'kuajing84_config')