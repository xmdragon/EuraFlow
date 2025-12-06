"""add_delivery_method_name_to_ozon_returns

Revision ID: e503d23c57e6
Revises: 9655f6fcf686
Create Date: 2025-11-20 10:50:43.108866

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e503d23c57e6'
down_revision = '9655f6fcf686'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加配送方式字段
    op.add_column('ozon_returns', sa.Column('delivery_method_name', sa.String(length=200), nullable=True, comment='配送方式名称'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除配送方式字段
    op.drop_column('ozon_returns', 'delivery_method_name')