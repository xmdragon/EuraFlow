"""Increase delivery_type field length from 20 to 200

Revision ID: 609304c8d92c
Revises: b89c2a4e8abc
Create Date: 2025-09-09 20:28:19.296351

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '609304c8d92c'
down_revision = 'b89c2a4e8abc'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Increase delivery_type field length from VARCHAR(20) to VARCHAR(200)
    op.alter_column('ozon_orders', 'delivery_type',
                    type_=sa.String(200),
                    existing_type=sa.String(20),
                    nullable=False)


def downgrade() -> None:
    """Downgrade database schema"""
    # Revert delivery_type field length back to VARCHAR(20)
    op.alter_column('ozon_orders', 'delivery_type',
                    type_=sa.String(20),
                    existing_type=sa.String(200),
                    nullable=False)