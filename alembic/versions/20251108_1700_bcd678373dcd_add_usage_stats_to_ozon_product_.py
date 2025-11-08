"""add usage stats to ozon_product_templates

Revision ID: bcd678373dcd
Revises: 4e3cc4b17892
Create Date: 2025-11-08 17:00:53.678176

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'bcd678373dcd'
down_revision = '4e3cc4b17892'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Add usage statistics columns
    op.add_column(
        'ozon_product_templates',
        sa.Column('used_count', sa.Integer(), nullable=False, server_default='0', comment='模板使用次数')
    )
    op.add_column(
        'ozon_product_templates',
        sa.Column('last_used_at', sa.TIMESTAMP(timezone=True), nullable=True, comment='最后使用时间（UTC）')
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # Remove usage statistics columns
    op.drop_column('ozon_product_templates', 'last_used_at')
    op.drop_column('ozon_product_templates', 'used_count')