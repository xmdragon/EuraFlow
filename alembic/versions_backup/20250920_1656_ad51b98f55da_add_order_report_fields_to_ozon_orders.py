"""add_order_report_fields_to_ozon_orders

Revision ID: ad51b98f55da
Revises: 948ce22fbbbf
Create Date: 2025-09-20 16:56:17.095445

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ad51b98f55da'
down_revision = '948ce22fbbbf'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加进货价格字段
    op.add_column('ozon_orders', sa.Column('purchase_price', sa.Numeric(precision=18, scale=4), nullable=True, comment='进货价格'))

    # 添加国内运单号字段
    op.add_column('ozon_orders', sa.Column('domestic_tracking_number', sa.String(length=100), nullable=True, comment='国内运单号'))

    # 添加材料费用字段
    op.add_column('ozon_orders', sa.Column('material_cost', sa.Numeric(precision=18, scale=4), nullable=True, comment='材料费用'))

    # 添加备注字段
    op.add_column('ozon_orders', sa.Column('order_notes', sa.Text(), nullable=True, comment='订单备注'))


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_orders', 'order_notes')
    op.drop_column('ozon_orders', 'material_cost')
    op.drop_column('ozon_orders', 'domestic_tracking_number')
    op.drop_column('ozon_orders', 'purchase_price')