"""add_ozon_web_sync_support

添加 OZON Web 同步支持：
1. ozon_shops 表添加浏览器 Cookie 存储字段
2. 新建 ozon_web_sync_logs 表记录同步执行状态

Revision ID: 76ce564fd8a4
Revises: add_manual_type
Create Date: 2025-12-10 09:43:17.356157

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '76ce564fd8a4'
down_revision = 'add_manual_type'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 1. 在 ozon_shops 表添加浏览器 Cookie 存储字段
    op.add_column(
        'ozon_shops',
        sa.Column(
            'ozon_session_enc',
            sa.Text(),
            nullable=True,
            comment='加密的 OZON 浏览器 Cookie JSON'
        )
    )
    op.add_column(
        'ozon_shops',
        sa.Column(
            'ozon_session_updated_at',
            sa.DateTime(timezone=True),
            nullable=True,
            comment='浏览器 Cookie 更新时间'
        )
    )

    # 2. 创建 ozon_web_sync_logs 表
    op.create_table(
        'ozon_web_sync_logs',
        sa.Column('id', sa.BigInteger(), primary_key=True, comment='日志ID'),
        sa.Column('task_type', sa.String(50), nullable=False, comment='任务类型: promo_cleaner, invoice_sync, balance_sync'),
        sa.Column('source', sa.String(20), nullable=False, server_default='backend', comment='执行来源: backend, extension'),
        sa.Column('user_id', sa.BigInteger(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, comment='用户ID'),
        sa.Column('status', sa.String(20), nullable=False, server_default='running', comment='状态: running, success, failed, skipped'),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, comment='开始时间'),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True, comment='完成时间'),
        sa.Column('shops_processed', sa.BigInteger(), server_default='0', comment='处理的店铺数量'),
        sa.Column('shops_success', sa.BigInteger(), server_default='0', comment='成功的店铺数量'),
        sa.Column('shops_failed', sa.BigInteger(), server_default='0', comment='失败的店铺数量'),
        sa.Column('error_message', sa.Text(), nullable=True, comment='错误信息'),
        sa.Column('details', postgresql.JSONB(), nullable=True, comment='详细结果'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, comment='创建时间'),
    )

    # 创建索引
    op.create_index('ix_ozon_web_sync_logs_task_type', 'ozon_web_sync_logs', ['task_type'])
    op.create_index('ix_ozon_web_sync_logs_user_id', 'ozon_web_sync_logs', ['user_id'])
    op.create_index('ix_ozon_web_sync_logs_status', 'ozon_web_sync_logs', ['status'])
    op.create_index('ix_ozon_web_sync_logs_started_at', 'ozon_web_sync_logs', ['started_at'])


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('ix_ozon_web_sync_logs_started_at', table_name='ozon_web_sync_logs')
    op.drop_index('ix_ozon_web_sync_logs_status', table_name='ozon_web_sync_logs')
    op.drop_index('ix_ozon_web_sync_logs_user_id', table_name='ozon_web_sync_logs')
    op.drop_index('ix_ozon_web_sync_logs_task_type', table_name='ozon_web_sync_logs')

    # 删除表
    op.drop_table('ozon_web_sync_logs')

    # 删除 ozon_shops 表的字段
    op.drop_column('ozon_shops', 'ozon_session_updated_at')
    op.drop_column('ozon_shops', 'ozon_session_enc')
