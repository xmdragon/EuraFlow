"""rename_metadata_to_extra_data

Revision ID: 6ae71f9a3655
Revises: xwy7f8isbyle
Create Date: 2025-10-13 16:13:58.544565

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '6ae71f9a3655'
down_revision = 'xwy7f8isbyle'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Rename metadata column to extra_data in sync_service_logs table
    op.alter_column('sync_service_logs', 'metadata', new_column_name='extra_data')


def downgrade() -> None:
    """Downgrade database schema"""
    # Rename extra_data column back to metadata
    op.alter_column('sync_service_logs', 'extra_data', new_column_name='metadata')