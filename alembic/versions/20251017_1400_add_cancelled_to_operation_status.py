"""add cancelled to operation_status

Revision ID: add_cancelled_operation_status
Revises: add_ozon_warehouses_table
Create Date: 2025-10-17 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_cancelled_operation_status'
down_revision = 'add_ozon_warehouses'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """更新 operation_status 字段注释，添加 cancelled 状态"""
    # 使用原生 SQL 更新字段注释
    op.execute("""
        COMMENT ON COLUMN ozon_postings.operation_status IS
        '操作状态：awaiting_stock(等待备货)/allocating(分配中)/allocated(已分配)/tracking_confirmed(单号确认)/shipping(运输中)/cancelled(已取消)'
    """)


def downgrade() -> None:
    """回滚：恢复原字段注释"""
    op.execute("""
        COMMENT ON COLUMN ozon_postings.operation_status IS
        '操作状态：awaiting_stock(等待备货)/allocating(分配中)/allocated(已分配)/tracking_confirmed(单号确认)/shipping(运输中)'
    """)
