"""add_shop_balance_fields

Revision ID: b666b18767b1
Revises: 77ce9ece76c5
Create Date: 2025-12-09 20:50:22.959106

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b666b18767b1'
down_revision = '77ce9ece76c5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    op.add_column('ozon_shops', sa.Column(
        'current_balance_rub',
        sa.Numeric(18, 2),
        nullable=True,
        comment='当前余额（卢布）'
    ))
    op.add_column('ozon_shops', sa.Column(
        'balance_updated_at',
        sa.DateTime(timezone=True),
        nullable=True,
        comment='余额更新时间'
    ))


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_shops', 'balance_updated_at')
    op.drop_column('ozon_shops', 'current_balance_rub')