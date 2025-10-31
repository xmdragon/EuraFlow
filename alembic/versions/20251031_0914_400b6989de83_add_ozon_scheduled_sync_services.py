"""add_ozon_scheduled_sync_services

Revision ID: 400b6989de83
Revises: 66847d15939c
Create Date: 2025-10-31 09:14:21.581745

"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime, timezone


# revision identifiers, used by Alembic.
revision = '400b6989de83'
down_revision = '66847d15939c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """添加 OZON 定时同步服务到 sync_services 表"""
    # 插入类目树定时同步服务
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
        ) VALUES (
            'ozon_scheduled_category_sync',
            'OZON 类目树定时同步',
            '每周二凌晨5:00自动同步所有启用店铺的类目树',
            'cron',
            '0 5 * * 2',
            true,
            0,
            0,
            0,
            '{"task_name": "ef.ozon.scheduled_category_sync"}'::jsonb,
            NOW(),
            NOW()
        )
        ON CONFLICT (service_key) DO NOTHING;
    """)

    # 插入类目特征定时同步服务
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
        ) VALUES (
            'ozon_scheduled_attributes_sync',
            'OZON 类目特征定时同步',
            '每周二凌晨5:30自动同步所有启用店铺的类目特征（不含字典值）',
            'cron',
            '30 5 * * 2',
            true,
            0,
            0,
            0,
            '{"task_name": "ef.ozon.scheduled_attributes_sync", "sync_dictionary_values": false}'::jsonb,
            NOW(),
            NOW()
        )
        ON CONFLICT (service_key) DO NOTHING;
    """)


def downgrade() -> None:
    """删除 OZON 定时同步服务"""
    op.execute("""
        DELETE FROM sync_services
        WHERE service_key IN ('ozon_scheduled_category_sync', 'ozon_scheduled_attributes_sync');
    """)