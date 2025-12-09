"""remove_kuajing84_module

Revision ID: a38701eceff6
Revises: 872ab8e27b53
Create Date: 2025-12-09 12:26:23.257624

完全移除跨境巴士模块：
- 删除 kuajing84_sync_logs 表
- 删除 kuajing84_global_config 表
- 删除 ozon_postings 表中的 kuajing84_sync_error 和 kuajing84_last_sync_at 字段
- 删除相关索引和外键约束
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a38701eceff6'
down_revision = '872ab8e27b53'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema - 移除跨境巴士模块"""
    conn = op.get_bind()

    # 1. 删除 ozon_postings 表中的 kuajing84 相关索引
    op.execute("DROP INDEX IF EXISTS idx_ozon_postings_kuajing84_sync")

    # 2. 删除 kuajing84_sync_logs 表的索引和外键
    op.execute("DROP INDEX IF EXISTS ix_kuajing84_sync_logs_order_id")
    op.execute("DROP INDEX IF EXISTS ix_kuajing84_sync_logs_order_number")
    op.execute("DROP INDEX IF EXISTS ix_kuajing84_sync_logs_posting_id")
    op.execute("DROP INDEX IF EXISTS ix_kuajing84_sync_logs_status")

    # 3. 删除外键约束（如果存在）
    op.execute("ALTER TABLE kuajing84_sync_logs DROP CONSTRAINT IF EXISTS fk_kuajing84_sync_logs_posting_id")
    op.execute("ALTER TABLE kuajing84_sync_logs DROP CONSTRAINT IF EXISTS kuajing84_sync_logs_ozon_order_id_fkey")

    # 4. 删除表
    op.execute("DROP TABLE IF EXISTS kuajing84_sync_logs")
    op.execute("DROP TABLE IF EXISTS kuajing84_global_config")

    # 5. 删除序列（如果存在）
    op.execute("DROP SEQUENCE IF EXISTS kuajing84_sync_logs_id_seq")
    op.execute("DROP SEQUENCE IF EXISTS kuajing84_global_config_id_seq")

    # 6. 删除 ozon_postings 中的字段
    # 检查字段是否存在再删除
    result = conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'ozon_postings' AND column_name = 'kuajing84_sync_error'"
    ))
    if result.fetchone():
        op.drop_column('ozon_postings', 'kuajing84_sync_error')

    result = conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'ozon_postings' AND column_name = 'kuajing84_last_sync_at'"
    ))
    if result.fetchone():
        op.drop_column('ozon_postings', 'kuajing84_last_sync_at')

    # 7. 删除 sync_services 中的 kuajing84 相关记录
    op.execute("DELETE FROM sync_services WHERE service_key = 'kuajing84_material_cost'")


def downgrade() -> None:
    """Downgrade database schema - 回滚（重建跨境巴士模块）"""
    # 1. 重建 kuajing84_global_config 表
    op.execute('''
        CREATE TABLE kuajing84_global_config (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100),
            password TEXT,
            base_url VARCHAR(200) DEFAULT 'https://www.kuajing84.com',
            cookies TEXT,
            cookies_expires_at TIMESTAMP WITH TIME ZONE,
            enabled BOOLEAN DEFAULT FALSE,
            customer_id VARCHAR(50),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 2. 重建 kuajing84_sync_logs 表
    op.execute('''
        CREATE TABLE kuajing84_sync_logs (
            id SERIAL PRIMARY KEY,
            shop_id INTEGER NOT NULL,
            posting_id INTEGER,
            order_number VARCHAR(100),
            kuajing84_oid VARCHAR(100),
            sync_status VARCHAR(20) DEFAULT 'pending',
            sync_type VARCHAR(20),
            error_message TEXT,
            request_data TEXT,
            response_data TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 3. 重建索引
    op.execute("CREATE INDEX ix_kuajing84_sync_logs_order_number ON kuajing84_sync_logs(order_number)")
    op.execute("CREATE INDEX ix_kuajing84_sync_logs_posting_id ON kuajing84_sync_logs(posting_id)")
    op.execute("CREATE INDEX ix_kuajing84_sync_logs_status ON kuajing84_sync_logs(shop_id, sync_status)")

    # 4. 重建外键约束
    op.execute('''
        ALTER TABLE kuajing84_sync_logs
        ADD CONSTRAINT fk_kuajing84_sync_logs_posting_id
        FOREIGN KEY (posting_id) REFERENCES ozon_postings(id) ON DELETE CASCADE
    ''')

    # 5. 重建 ozon_postings 字段
    op.add_column('ozon_postings', sa.Column(
        'kuajing84_sync_error', sa.String(200), nullable=True,
        comment='跨境巴士同步错误信息（如"订单不存在"则跳过后续同步）'
    ))
    op.add_column('ozon_postings', sa.Column(
        'kuajing84_last_sync_at', sa.DateTime(timezone=True), nullable=True,
        comment='最后尝试同步跨境巴士的时间'
    ))

    # 6. 重建索引
    op.execute("CREATE INDEX idx_ozon_postings_kuajing84_sync ON ozon_postings(kuajing84_sync_error, material_cost)")
