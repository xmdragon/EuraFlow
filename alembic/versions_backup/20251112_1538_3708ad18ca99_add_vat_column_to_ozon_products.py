"""add_vat_column_to_ozon_products

Revision ID: 3708ad18ca99
Revises: 5fc2dfec80b3
Create Date: 2025-11-12 15:38:21.491367

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3708ad18ca99'
down_revision = '5fc2dfec80b3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Add vat column to ozon_products table
    op.add_column('ozon_products', sa.Column('vat', sa.String(10), server_default='0', comment='增值税率'))


def downgrade() -> None:
    """Downgrade database schema"""
    # Remove vat column from ozon_products table
    op.drop_column('ozon_products', 'vat')