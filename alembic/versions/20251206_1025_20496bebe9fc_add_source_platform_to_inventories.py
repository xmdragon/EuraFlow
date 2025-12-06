"""add_source_platform_to_inventories

Revision ID: 20496bebe9fc
Revises: 1e01fab9dc3b
Create Date: 2025-12-06 10:25:08.091310

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision = '20496bebe9fc'
down_revision = '1e01fab9dc3b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    op.add_column(
        'inventories',
        sa.Column(
            'source_platform',
            JSONB,
            nullable=True,
            comment="采购平台来源（如：['1688', '拼多多']）"
        )
    )


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('inventories', 'source_platform')