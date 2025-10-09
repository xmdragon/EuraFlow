"""add_raw_payload_to_ozon_products

Revision ID: 7998fa3aaf46
Revises: 97f3b8a541f8
Create Date: 2025-10-09 17:44:54.149740

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7998fa3aaf46'
down_revision = '97f3b8a541f8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    from sqlalchemy.dialects.postgresql import JSONB
    op.add_column('ozon_products',
                  sa.Column('raw_payload',
                           JSONB,
                           nullable=True,
                           comment='Ozon原始数据'))


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_products', 'raw_payload')