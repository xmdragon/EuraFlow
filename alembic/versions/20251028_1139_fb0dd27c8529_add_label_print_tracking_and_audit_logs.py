"""add_label_print_tracking_and_audit_logs

Revision ID: fb0dd27c8529
Revises: f22efac03f52
Create Date: 2025-10-28 11:39:48.565756

变更说明：
1. 在 ozon_postings 表添加打印追踪字段
2. 创建全局审计日志表 audit_logs
3. 创建审计日志归档表 audit_logs_archive
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'fb0dd27c8529'
down_revision = 'f22efac03f52'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""

    # 1. 在 ozon_postings 表添加打印追踪字段
    op.add_column('ozon_postings', sa.Column(
        'label_printed_at',
        sa.DateTime(timezone=True),
        nullable=True,
        comment='标签首次打印时间'
    ))
    op.add_column('ozon_postings', sa.Column(
        'label_print_count',
        sa.Integer(),
        nullable=False,
        server_default='0',
        comment='标签打印次数'
    ))

    # 添加索引（用于查询已打印/未打印的订单）
    op.create_index(
        'idx_ozon_postings_label_printed',
        'ozon_postings',
        ['label_printed_at'],
        postgresql_where=sa.text('label_printed_at IS NOT NULL')
    )

    # 2. 创建全局审计日志表
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False, comment='用户ID'),
        sa.Column('username', sa.String(length=100), nullable=False, comment='用户名'),
        sa.Column('module', sa.String(length=50), nullable=False, comment='模块名（ozon/finance/user/system）'),
        sa.Column('action', sa.String(length=50), nullable=False, comment='操作类型（create/update/delete/print）'),
        sa.Column('action_display', sa.String(length=100), nullable=True, comment='操作显示名称'),
        sa.Column('table_name', sa.String(length=100), nullable=False, comment='表名'),
        sa.Column('record_id', sa.String(length=100), nullable=False, comment='记录ID'),
        sa.Column('changes', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='变更详情'),
        sa.Column('ip_address', postgresql.INET(), nullable=True, comment='IP地址'),
        sa.Column('user_agent', sa.String(length=500), nullable=True, comment='User Agent'),
        sa.Column('request_id', sa.String(length=100), nullable=True, comment='请求ID（trace_id）'),
        sa.Column('notes', sa.Text(), nullable=True, comment='备注'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False, comment='创建时间'),
        sa.PrimaryKeyConstraint('id')
    )

    # 创建索引（优化查询性能）
    op.create_index('idx_audit_logs_user', 'audit_logs', ['user_id', sa.text('created_at DESC')])
    op.create_index('idx_audit_logs_module', 'audit_logs', ['module', sa.text('created_at DESC')])
    op.create_index('idx_audit_logs_action', 'audit_logs', ['action', sa.text('created_at DESC')])
    op.create_index('idx_audit_logs_record', 'audit_logs', ['table_name', 'record_id'])
    op.create_index('idx_audit_logs_created', 'audit_logs', [sa.text('created_at DESC')])

    # 3. 创建审计日志归档表（用于存储6个月以上的日志）
    op.create_table(
        'audit_logs_archive',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(length=100), nullable=False),
        sa.Column('module', sa.String(length=50), nullable=False),
        sa.Column('action', sa.String(length=50), nullable=False),
        sa.Column('action_display', sa.String(length=100), nullable=True),
        sa.Column('table_name', sa.String(length=100), nullable=False),
        sa.Column('record_id', sa.String(length=100), nullable=False),
        sa.Column('changes', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('ip_address', postgresql.INET(), nullable=True),
        sa.Column('user_agent', sa.String(length=500), nullable=True),
        sa.Column('request_id', sa.String(length=100), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # 归档表索引
    op.create_index('idx_audit_logs_archive_created', 'audit_logs_archive', [sa.text('created_at DESC')])
    op.create_index('idx_audit_logs_archive_record', 'audit_logs_archive', ['table_name', 'record_id'])


def downgrade() -> None:
    """Downgrade database schema"""

    # 删除归档表
    op.drop_index('idx_audit_logs_archive_record', table_name='audit_logs_archive')
    op.drop_index('idx_audit_logs_archive_created', table_name='audit_logs_archive')
    op.drop_table('audit_logs_archive')

    # 删除审计日志表
    op.drop_index('idx_audit_logs_created', table_name='audit_logs')
    op.drop_index('idx_audit_logs_record', table_name='audit_logs')
    op.drop_index('idx_audit_logs_action', table_name='audit_logs')
    op.drop_index('idx_audit_logs_module', table_name='audit_logs')
    op.drop_index('idx_audit_logs_user', table_name='audit_logs')
    op.drop_table('audit_logs')

    # 删除 ozon_postings 的打印追踪字段
    op.drop_index('idx_ozon_postings_label_printed', table_name='ozon_postings')
    op.drop_column('ozon_postings', 'label_print_count')
    op.drop_column('ozon_postings', 'label_printed_at')
