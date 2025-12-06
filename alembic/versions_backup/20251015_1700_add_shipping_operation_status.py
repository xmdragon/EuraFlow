"""add shipping operation status

Revision ID: add_shipping_status
Revises: add_operation_status
Create Date: 2025-10-15 17:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'add_shipping_status'
down_revision = 'add_kuajing84_sync_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    添加 shipping (运输中) 操作状态
    
    注意：无需修改数据库结构，operation_status 是 String 类型
    此迁移仅用于记录新状态值的添加
    
    新增状态：shipping (运输中)
    完整状态列表：
    - awaiting_stock (等待备货)
    - allocating (分配中)
    - allocated (已分配)
    - tracking_confirmed (单号确认)
    - shipping (运输中) ← 新增
    """
    # 更新字段注释（PostgreSQL）
    op.execute("""
        COMMENT ON COLUMN ozon_postings.operation_status IS 
        '操作状态：awaiting_stock(等待备货)/allocating(分配中)/allocated(已分配)/tracking_confirmed(单号确认)/shipping(运输中)'
    """)


def downgrade() -> None:
    """回滚：恢复原注释"""
    op.execute("""
        COMMENT ON COLUMN ozon_postings.operation_status IS 
        '操作状态：awaiting_stock(等待备货)/allocating(分配中)/allocated(已分配)/tracking_confirmed(单号确认)'
    """)
