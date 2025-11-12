"""allow_null_status_in_ozon_products

Revision ID: 29a214671ef5
Revises: b44e5ecabdfc
Create Date: 2025-11-12 15:47:29.495504

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '29a214671ef5'
down_revision = 'b44e5ecabdfc'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Allow NULL values in status column
    op.alter_column('ozon_products', 'status',
                    existing_type=sa.String(50),
                    nullable=True)


def downgrade() -> None:
    """Downgrade database schema"""
    # Restore NOT NULL constraint on status column
    op.alter_column('ozon_products', 'status',
                    existing_type=sa.String(50),
                    nullable=False)