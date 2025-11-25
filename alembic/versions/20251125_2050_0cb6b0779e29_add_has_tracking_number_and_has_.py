"""add has_tracking_number and has_domestic_tracking to ozon_postings

Revision ID: 0cb6b0779e29
Revises: 4ed4e5fbb633
Create Date: 2025-11-25 20:50:15.082997

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0cb6b0779e29'
down_revision = '4ed4e5fbb633'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    pass


def downgrade() -> None:
    """Downgrade database schema"""
    pass