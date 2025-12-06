"""add_missing_fields_to_ozon_orders

Revision ID: b74b49cec77f
Revises: 1ddb8227d228
Create Date: 2025-10-09 16:16:11.722787

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b74b49cec77f'
down_revision = '1ddb8227d228'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加缺失的字段到 ozon_orders 表
    op.add_column('ozon_orders', sa.Column('payment_status', sa.String(length=50), nullable=True, comment='支付状态'))
    op.add_column('ozon_orders', sa.Column('order_type', sa.String(length=50), nullable=True, server_default='FBS', comment='订单类型'))
    op.add_column('ozon_orders', sa.Column('delivery_date', sa.DateTime(), nullable=True, comment='配送日期'))
    op.add_column('ozon_orders', sa.Column('delivery_time_slot', sa.String(length=50), nullable=True, comment='配送时间段'))
    op.add_column('ozon_orders', sa.Column('raw_payload', sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='Ozon原始订单数据'))
    op.add_column('ozon_orders', sa.Column('ordered_at', sa.DateTime(), nullable=True, comment='下单时间'))
    op.add_column('ozon_orders', sa.Column('confirmed_at', sa.DateTime(), nullable=True, comment='确认时间'))
    op.add_column('ozon_orders', sa.Column('shipped_at', sa.DateTime(), nullable=True, comment='发货时间'))

    # 为现有数据设置默认值（使用 created_at 作为 ordered_at 的默认值）
    op.execute('UPDATE ozon_orders SET ordered_at = created_at WHERE ordered_at IS NULL')

    # 现在将 ordered_at 设置为 NOT NULL
    op.alter_column('ozon_orders', 'ordered_at', nullable=False)


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除添加的字段
    op.drop_column('ozon_orders', 'shipped_at')
    op.drop_column('ozon_orders', 'confirmed_at')
    op.drop_column('ozon_orders', 'ordered_at')
    op.drop_column('ozon_orders', 'raw_payload')
    op.drop_column('ozon_orders', 'delivery_time_slot')
    op.drop_column('ozon_orders', 'delivery_date')
    op.drop_column('ozon_orders', 'order_type')
    op.drop_column('ozon_orders', 'payment_status')