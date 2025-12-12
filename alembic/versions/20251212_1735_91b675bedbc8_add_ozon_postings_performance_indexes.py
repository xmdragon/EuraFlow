"""add_ozon_postings_performance_indexes

Revision ID: 91b675bedbc8
Revises: add_permission_system
Create Date: 2025-12-12 17:35:42.046163

性能优化索引：
1. 标签预缓存查询优化索引 - 用于查询未下载标签的待发货订单
2. 店铺+状态+时间复合索引 - 用于订单列表分页查询

注意：使用普通 CREATE INDEX（非 CONCURRENTLY）以支持事务
生产环境表较小，阻塞时间可忽略
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '91b675bedbc8'
down_revision = 'add_permission_system'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 1. 标签预缓存查询优化索引
    # 用于查询：status IN ('awaiting_deliver', 'awaiting_packaging') AND label_pdf_path IS NULL
    # 显著加速标签预缓存任务
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_ozon_postings_label_pending
        ON ozon_postings (shop_id, status)
        WHERE label_pdf_path IS NULL OR label_pdf_path = ''
    """)

    # 2. 店铺+状态+创建时间复合索引
    # 用于订单列表分页查询（按店铺筛选、状态筛选、时间排序）
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_ozon_postings_shop_status_created
        ON ozon_postings (shop_id, status, created_at DESC)
    """)


def downgrade() -> None:
    """Downgrade database schema"""
    op.execute("DROP INDEX IF EXISTS idx_ozon_postings_label_pending")
    op.execute("DROP INDEX IF EXISTS idx_ozon_postings_shop_status_created")