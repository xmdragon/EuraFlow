"""add_sync_service_tables

Revision ID: qwf4q7isbyle
Revises: 25b252948c69
Create Date: 2025-10-13 15:50:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision = 'qwf4q7isbyle'
down_revision = '25b252948c69'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""

    # 创建同步服务配置表
    op.create_table(
        'sync_services',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('service_key', sa.String(100), nullable=False, unique=True, comment='服务唯一标识'),
        sa.Column('service_name', sa.String(200), nullable=False, comment='服务显示名称'),
        sa.Column('service_description', sa.Text, comment='服务功能说明'),

        # 调度配置
        sa.Column('service_type', sa.String(20), nullable=False, default='interval', comment='调度类型: cron定时 | interval周期'),
        sa.Column('schedule_config', sa.String(200), nullable=False, comment='调度配置：cron表达式或间隔秒数'),
        sa.Column('is_enabled', sa.Boolean, nullable=False, default=True, comment='启用开关'),

        # 运行状态
        sa.Column('last_run_at', sa.DateTime(timezone=True), comment='最后运行时间'),
        sa.Column('last_run_status', sa.String(20), comment='最后运行状态: success/failed/running'),
        sa.Column('last_run_message', sa.Text, comment='最后运行日志摘要'),

        # 统计信息
        sa.Column('run_count', sa.Integer, nullable=False, default=0, comment='总运行次数'),
        sa.Column('success_count', sa.Integer, nullable=False, default=0, comment='成功次数'),
        sa.Column('error_count', sa.Integer, nullable=False, default=0, comment='失败次数'),

        # 服务特定配置
        sa.Column('config_json', JSONB, comment='服务特定配置（如批次大小、超时时间）'),

        # 时间戳
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), comment='更新时间'),

        comment='同步服务配置表'
    )

    # 创建索引
    op.create_index('idx_sync_services_enabled', 'sync_services', ['is_enabled', 'service_type'])
    op.create_index('idx_sync_services_last_run', 'sync_services', ['last_run_at'])

    # 创建同步服务日志表
    op.create_table(
        'sync_service_logs',
        sa.Column('id', sa.BigInteger, primary_key=True),
        sa.Column('service_key', sa.String(100), nullable=False, comment='服务标识'),
        sa.Column('run_id', sa.String(100), nullable=False, comment='运行批次ID'),

        # 执行信息
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False, comment='开始时间'),
        sa.Column('finished_at', sa.DateTime(timezone=True), comment='完成时间'),
        sa.Column('status', sa.String(20), nullable=False, comment='运行状态: success/failed'),

        # 统计信息
        sa.Column('records_processed', sa.Integer, default=0, comment='处理记录数'),
        sa.Column('records_updated', sa.Integer, default=0, comment='更新记录数'),
        sa.Column('execution_time_ms', sa.Integer, comment='执行耗时（毫秒）'),

        # 错误信息
        sa.Column('error_message', sa.Text, comment='错误详情'),
        sa.Column('error_stack', sa.Text, comment='错误堆栈'),

        # 额外数据
        sa.Column('metadata', JSONB, comment='附加元数据'),

        comment='同步服务执行日志表'
    )

    # 创建索引
    op.create_index('idx_sync_logs_service', 'sync_service_logs', ['service_key', 'started_at'])
    op.create_index('idx_sync_logs_status', 'sync_service_logs', ['status', 'started_at'])
    op.create_index('idx_sync_logs_run_id', 'sync_service_logs', ['run_id'])


def downgrade() -> None:
    """Downgrade database schema"""

    # 删除索引
    op.drop_index('idx_sync_logs_run_id', table_name='sync_service_logs')
    op.drop_index('idx_sync_logs_status', table_name='sync_service_logs')
    op.drop_index('idx_sync_logs_service', table_name='sync_service_logs')
    op.drop_index('idx_sync_services_last_run', table_name='sync_services')
    op.drop_index('idx_sync_services_enabled', table_name='sync_services')

    # 删除表
    op.drop_table('sync_service_logs')
    op.drop_table('sync_services')
