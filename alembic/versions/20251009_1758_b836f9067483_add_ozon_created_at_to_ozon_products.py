"""add_ozon_created_at_to_ozon_products

Revision ID: b836f9067483
Revises: 7998fa3aaf46
Create Date: 2025-10-09 17:58:02.970889

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b836f9067483'
down_revision = '7998fa3aaf46'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    op.add_column('ozon_products',
                  sa.Column('ozon_created_at',
                           sa.DateTime(),
                           nullable=True,
                           comment='OZON平台创建时间'))


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_products', 'ozon_created_at')