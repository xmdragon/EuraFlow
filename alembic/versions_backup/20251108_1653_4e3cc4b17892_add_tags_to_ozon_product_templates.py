"""add tags to ozon_product_templates

Revision ID: 4e3cc4b17892
Revises: 4c44894cf0b6
Create Date: 2025-11-08 16:53:29.654537

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4e3cc4b17892'
down_revision = '4c44894cf0b6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Add tags column to ozon_product_templates
    op.add_column(
        'ozon_product_templates',
        sa.Column('tags', sa.ARRAY(sa.String(length=50)), nullable=True, comment='模板标签（最多10个）')
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # Remove tags column
    op.drop_column('ozon_product_templates', 'tags')