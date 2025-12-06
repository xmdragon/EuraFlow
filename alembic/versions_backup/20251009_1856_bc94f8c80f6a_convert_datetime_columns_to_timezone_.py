"""convert_datetime_columns_to_timezone_aware

Revision ID: bc94f8c80f6a
Revises: 2deb27629242
Create Date: 2025-10-09 18:56:08.979458

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'bc94f8c80f6a'
down_revision = '2deb27629242'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema - Convert DateTime columns to timezone-aware"""

    # 只修改 ozon_products 表（其他表尚未创建）
    op.execute("ALTER TABLE ozon_products ALTER COLUMN last_sync_at TYPE TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE ozon_products ALTER COLUMN ozon_created_at TYPE TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE ozon_products ALTER COLUMN created_at TYPE TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE ozon_products ALTER COLUMN updated_at TYPE TIMESTAMP WITH TIME ZONE")


def downgrade() -> None:
    """Downgrade database schema - Convert DateTime columns back to timezone-naive"""

    # 只修改 ozon_products 表
    op.execute("ALTER TABLE ozon_products ALTER COLUMN last_sync_at TYPE TIMESTAMP WITHOUT TIME ZONE")
    op.execute("ALTER TABLE ozon_products ALTER COLUMN ozon_created_at TYPE TIMESTAMP WITHOUT TIME ZONE")
    op.execute("ALTER TABLE ozon_products ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE")
    op.execute("ALTER TABLE ozon_products ALTER COLUMN updated_at TYPE TIMESTAMP WITHOUT TIME ZONE")