"""init_default_sync_services

Revision ID: xwy7f8isbyle
Revises: qwf4q7isbyle
Create Date: 2025-10-13 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision = 'xwy7f8isbyle'
down_revision = 'qwf4q7isbyle'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""

    # 插入默认的同步服务配置
    op.execute("""
        INSERT INTO sync_services (
            service_key,
            service_name,
            service_description,
            service_type,
            schedule_config,
            is_enabled,
            run_count,
            success_count,
            error_count,
            config_json,
            created_at,
            updated_at
        ) VALUES
        (
            'kuajing84_material_cost',
            '跨境巴士物料成本同步',
            '自动从跨境巴士查询并更新"已打包"订单的物料成本和国内物流单号（每3秒处理一条，批量10条/次）',
            'interval',
            '300',
            false,
            0,
            0,
            0,
            '{"batch_size": 10, "delay_seconds": 3}',
            NOW(),
            NOW()
        ),
        (
            'ozon_sync_incremental',
            'OZON商品订单增量同步',
            '增量同步OZON平台的商品和订单数据（最近48小时内变更的数据，每30分钟执行一次）',
            'interval',
            '1800',
            false,
            0,
            0,
            0,
            '{"time_window_hours": 48, "sync_products": true, "sync_orders": true}',
            NOW(),
            NOW()
        )
        ON CONFLICT (service_key) DO NOTHING;
    """)


def downgrade() -> None:
    """Downgrade database schema"""

    # 删除默认服务配置
    op.execute("""
        DELETE FROM sync_services
        WHERE service_key IN ('kuajing84_material_cost', 'ozon_sync_incremental');
    """)
