"""make_total_price_nullable_in_ozon_orders

Revision ID: 14b2ff89f856
Revises: 1a9612704fdc
Create Date: 2025-09-18 10:01:08.967940

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '14b2ff89f856'
down_revision = '1a9612704fdc'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 修改total_price字段为可空
    op.alter_column('ozon_orders', 'total_price', nullable=True)


def downgrade() -> None:
    """Downgrade database schema"""
    # 回滚：将total_price字段改回非空（注意：这可能会失败如果有null值）
    op.alter_column('ozon_orders', 'total_price', nullable=False)