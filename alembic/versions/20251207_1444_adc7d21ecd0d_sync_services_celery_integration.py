"""sync_services_celery_integration

Revision ID: adc7d21ecd0d
Revises: e2eda785556e
Create Date: 2025-12-07 14:44:55.269492

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'adc7d21ecd0d'
down_revision = 'e2eda785556e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    conn = op.get_bind()

    # 检查 sync_services 表是否存在
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_services')"
    ))
    table_exists = result.scalar()

    if not table_exists:
        # 如果表不存在，创建表
        op.execute('''
            CREATE TABLE sync_services (
                id SERIAL PRIMARY KEY,
                service_key VARCHAR(100) NOT NULL UNIQUE,
                service_name VARCHAR(200) NOT NULL,
                service_description TEXT,
                service_type VARCHAR(20) NOT NULL DEFAULT 'cron',
                schedule_config VARCHAR(200) NOT NULL,
                is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                last_run_at TIMESTAMP WITH TIME ZONE,
                last_run_status VARCHAR(20),
                last_run_message TEXT,
                run_count INTEGER NOT NULL DEFAULT 0,
                success_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                config_json JSONB,
                celery_task_name VARCHAR(200),
                plugin_name VARCHAR(100),
                source VARCHAR(20) DEFAULT 'code',
                is_deleted BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        op.execute('CREATE INDEX idx_sync_services_celery_task ON sync_services(celery_task_name)')

        # 创建 sync_service_logs 表
        op.execute('''
            CREATE TABLE IF NOT EXISTS sync_service_logs (
                id SERIAL PRIMARY KEY,
                service_key VARCHAR(100) NOT NULL,
                run_id VARCHAR(100) NOT NULL,
                started_at TIMESTAMP WITH TIME ZONE NOT NULL,
                finished_at TIMESTAMP WITH TIME ZONE,
                status VARCHAR(20) NOT NULL DEFAULT 'running',
                records_processed INTEGER NOT NULL DEFAULT 0,
                records_updated INTEGER NOT NULL DEFAULT 0,
                execution_time_ms INTEGER,
                error_message TEXT,
                extra_data JSONB,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        op.execute('CREATE INDEX idx_sync_service_logs_service_key ON sync_service_logs(service_key)')
        op.execute('CREATE INDEX idx_sync_service_logs_started_at ON sync_service_logs(started_at)')

    else:
        # 表存在，添加新列（如果不存在）
        # 检查列是否存在
        result = conn.execute(sa.text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'sync_services' AND column_name = 'celery_task_name'"
        ))
        if not result.fetchone():
            op.add_column('sync_services', sa.Column('celery_task_name', sa.String(200), comment='Celery任务名（如 ef.ozon.orders.pull）'))

        result = conn.execute(sa.text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'sync_services' AND column_name = 'plugin_name'"
        ))
        if not result.fetchone():
            op.add_column('sync_services', sa.Column('plugin_name', sa.String(100), comment='所属插件标识'))

        result = conn.execute(sa.text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'sync_services' AND column_name = 'source'"
        ))
        if not result.fetchone():
            op.add_column('sync_services', sa.Column('source', sa.String(20), server_default='code', comment='配置来源: code=代码注册 | manual=手动添加'))

        result = conn.execute(sa.text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'sync_services' AND column_name = 'is_deleted'"
        ))
        if not result.fetchone():
            op.add_column('sync_services', sa.Column('is_deleted', sa.Boolean(), server_default='false', comment='是否已从代码中移除（软删除）'))

        # 创建索引（如果不存在）
        result = conn.execute(sa.text(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'sync_services' AND indexname = 'idx_sync_services_celery_task'"
        ))
        if not result.fetchone():
            op.create_index('idx_sync_services_celery_task', 'sync_services', ['celery_task_name'])

        # 填充已知映射的 celery_task_name（asyncpg 要求每条语句单独执行）
        task_mappings = [
            ("database_backup", "ef.system.database_backup"),
            ("ozon_finance_sync", "ef.ozon.finance.sync"),
            ("ozon_finance_transactions_daily", "ef.ozon.finance.transactions"),
            ("ozon_sync_incremental", "ef.ozon.orders.pull"),
            ("exchange_rate_refresh", "ef.finance.rates.refresh"),
            ("ozon_promotion_sync", "ef.ozon.promotions.sync"),
            ("ozon_cancellations_sync", "ef.ozon.cancellations.sync"),
            ("ozon_returns_sync", "ef.ozon.returns.sync"),
        ]
        for service_key, task_name in task_mappings:
            op.execute(sa.text(
                f"UPDATE sync_services SET celery_task_name = '{task_name}', source = 'code' "
                f"WHERE service_key = '{service_key}' AND celery_task_name IS NULL"
            ))


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_index('idx_sync_services_celery_task', table_name='sync_services')
    op.drop_column('sync_services', 'is_deleted')
    op.drop_column('sync_services', 'source')
    op.drop_column('sync_services', 'plugin_name')
    op.drop_column('sync_services', 'celery_task_name')