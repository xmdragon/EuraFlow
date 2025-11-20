"""add purchase_note to ozon_products

Revision ID: de39ff739d87
Revises: e503d23c57e6
Create Date: 2025-11-20 11:58:03.521361

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'de39ff739d87'
down_revision = 'e503d23c57e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加采购备注字段
    op.add_column('ozon_products', sa.Column('purchase_note', sa.String(length=500), nullable=True, comment='采购备注'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除采购备注字段
    op.drop_column('ozon_products', 'purchase_note')