"""add_client_delivery_date_fields_to_orders

Revision ID: 7915f2c1b727
Revises: 400b6989de83
Create Date: 2025-10-31 14:38:21.486411

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7915f2c1b727'
down_revision = '400b6989de83'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加客户期望配送日期字段到订单表
    op.add_column('ozon_orders', sa.Column('client_delivery_date_begin', sa.DateTime(timezone=True), nullable=True, comment='客户期望配送开始日期（来自analytics_data）'))
    op.add_column('ozon_orders', sa.Column('client_delivery_date_end', sa.DateTime(timezone=True), nullable=True, comment='客户期望配送结束日期（来自analytics_data）'))

    # 添加索引以提升查询性能
    op.create_index('ix_ozon_orders_client_delivery_date', 'ozon_orders', ['client_delivery_date_begin'], unique=False)


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('ix_ozon_orders_client_delivery_date', table_name='ozon_orders')

    # 删除字段
    op.drop_column('ozon_orders', 'client_delivery_date_end')
    op.drop_column('ozon_orders', 'client_delivery_date_begin')