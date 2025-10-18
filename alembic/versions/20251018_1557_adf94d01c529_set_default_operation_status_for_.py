"""set_default_operation_status_for_existing_postings

Revision ID: adf94d01c529
Revises: 1b4058952d68
Create Date: 2025-10-18 15:57:20.370223

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'adf94d01c529'
down_revision = '1b4058952d68'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema

    更新现有 posting 的 operation_status：
    - NULL + awaiting_packaging/awaiting_deliver → 'awaiting_stock'
    """
    # 更新状态为 awaiting_packaging 或 awaiting_deliver 且 operation_status 为 NULL 的记录
    op.execute("""
        UPDATE ozon_postings
        SET operation_status = 'awaiting_stock'
        WHERE operation_status IS NULL
        AND status IN ('awaiting_packaging', 'awaiting_deliver')
        AND is_cancelled = false
    """)


def downgrade() -> None:
    """Downgrade database schema

    回滚：将通过此迁移设置的 operation_status 恢复为 NULL
    """
    op.execute("""
        UPDATE ozon_postings
        SET operation_status = NULL
        WHERE operation_status = 'awaiting_stock'
        AND status IN ('awaiting_packaging', 'awaiting_deliver')
    """)
