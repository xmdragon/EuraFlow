"""add package_weight to ozon_postings

Revision ID: 8005a952704d
Revises: init_001
Create Date: 2025-12-05 19:51:07.482558

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '8005a952704d'
down_revision = 'init_001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    op.add_column(
        'ozon_postings',
        sa.Column('package_weight', sa.Integer, nullable=True, comment='包装重量（克），用于跨境物流申报')
    )


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_postings', 'package_weight')