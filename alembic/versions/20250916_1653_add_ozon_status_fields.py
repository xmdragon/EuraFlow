"""Add OZON native status fields to products table

Revision ID: add_ozon_status_fields
Revises: 609304c8d92c
Create Date: 2025-09-16 16:53:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_ozon_status_fields'
down_revision = '609304c8d92c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add OZON native status fields to ozon_products table"""
    # Add new columns to ozon_products table
    op.add_column('ozon_products', sa.Column('ozon_archived', sa.Boolean(), nullable=True, default=False, comment='OZON归档状态'))
    op.add_column('ozon_products', sa.Column('ozon_has_fbo_stocks', sa.Boolean(), nullable=True, default=False, comment='是否有FBO库存'))
    op.add_column('ozon_products', sa.Column('ozon_has_fbs_stocks', sa.Boolean(), nullable=True, default=False, comment='是否有FBS库存'))
    op.add_column('ozon_products', sa.Column('ozon_is_discounted', sa.Boolean(), nullable=True, default=False, comment='是否打折'))
    op.add_column('ozon_products', sa.Column('ozon_visibility_status', sa.String(length=100), nullable=True, comment='OZON可见性状态'))

    # Create indexes for the new columns
    op.create_index('idx_ozon_products_ozon_archived', 'ozon_products', ['ozon_archived'])
    op.create_index('idx_ozon_products_ozon_visibility', 'ozon_products', ['ozon_visibility_status'])

    # Set default values for existing records
    op.execute("UPDATE ozon_products SET ozon_archived = false WHERE ozon_archived IS NULL")
    op.execute("UPDATE ozon_products SET ozon_has_fbo_stocks = false WHERE ozon_has_fbo_stocks IS NULL")
    op.execute("UPDATE ozon_products SET ozon_has_fbs_stocks = false WHERE ozon_has_fbs_stocks IS NULL")
    op.execute("UPDATE ozon_products SET ozon_is_discounted = false WHERE ozon_is_discounted IS NULL")

    # Now make the boolean columns NOT NULL with default values
    op.alter_column('ozon_products', 'ozon_archived', nullable=False, server_default=sa.text('false'))
    op.alter_column('ozon_products', 'ozon_has_fbo_stocks', nullable=False, server_default=sa.text('false'))
    op.alter_column('ozon_products', 'ozon_has_fbs_stocks', nullable=False, server_default=sa.text('false'))
    op.alter_column('ozon_products', 'ozon_is_discounted', nullable=False, server_default=sa.text('false'))


def downgrade() -> None:
    """Remove OZON native status fields from ozon_products table"""
    # Drop indexes first
    op.drop_index('idx_ozon_products_ozon_visibility', table_name='ozon_products')
    op.drop_index('idx_ozon_products_ozon_archived', table_name='ozon_products')

    # Drop columns
    op.drop_column('ozon_products', 'ozon_visibility_status')
    op.drop_column('ozon_products', 'ozon_is_discounted')
    op.drop_column('ozon_products', 'ozon_has_fbs_stocks')
    op.drop_column('ozon_products', 'ozon_has_fbo_stocks')
    op.drop_column('ozon_products', 'ozon_archived')