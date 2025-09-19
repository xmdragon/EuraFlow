"""add_ozon_created_at_to_products

Revision ID: 1a9612704fdc
Revises: add_ozon_status_fields
Create Date: 2025-09-17 21:49:09.287629

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1a9612704fdc'
down_revision = 'add_ozon_status_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    op.add_column('ozon_products', sa.Column('ozon_created_at', sa.DateTime(timezone=True), nullable=True, comment='商品在OZON平台的创建时间'))


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_products', 'ozon_created_at')