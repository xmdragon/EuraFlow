"""rename_variants_column_to_ozon_variants

Revision ID: 5fc2dfec80b3
Revises: e9ddc769bb96
Create Date: 2025-11-12 11:37:36.590444

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5fc2dfec80b3'
down_revision = 'e9ddc769bb96'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Rename variants column to ozon_variants to avoid conflict with relationship
    op.alter_column('ozon_products', 'variants', new_column_name='ozon_variants')


def downgrade() -> None:
    """Downgrade database schema"""
    # Rename back to variants
    op.alter_column('ozon_products', 'ozon_variants', new_column_name='variants')