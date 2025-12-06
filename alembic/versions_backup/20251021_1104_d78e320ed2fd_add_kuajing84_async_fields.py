"""add_kuajing84_async_fields

Revision ID: d78e320ed2fd
Revises: remove_deprecated_001
Create Date: 2025-10-21 11:04:07.584541

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd78e320ed2fd'
down_revision = 'remove_deprecated_001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 1. 添加 sync_type 字段（同步类型：submit_tracking/discard_order）
    op.add_column(
        'kuajing84_sync_logs',
        sa.Column(
            'sync_type',
            sa.String(20),
            nullable=False,
            server_default='submit_tracking',
            comment='同步类型: submit_tracking/discard_order'
        )
    )

    # 2. 添加 posting_id 字段（货件ID关联）
    op.add_column(
        'kuajing84_sync_logs',
        sa.Column(
            'posting_id',
            sa.BigInteger(),
            nullable=True,
            comment='货件ID（关联ozon_postings表）'
        )
    )

    # 3. 添加外键约束
    op.create_foreign_key(
        'fk_kuajing84_sync_logs_posting_id',
        'kuajing84_sync_logs',
        'ozon_postings',
        ['posting_id'],
        ['id'],
        ondelete='CASCADE'
    )

    # 4. 添加 started_at 字段（开始同步时间）
    op.add_column(
        'kuajing84_sync_logs',
        sa.Column(
            'started_at',
            sa.DateTime(timezone=True),
            nullable=True,
            comment='开始同步时间'
        )
    )

    # 5. 创建 posting_id 索引
    op.create_index(
        'ix_kuajing84_sync_logs_posting_id',
        'kuajing84_sync_logs',
        ['posting_id']
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 1. 删除索引
    op.drop_index('ix_kuajing84_sync_logs_posting_id', table_name='kuajing84_sync_logs')

    # 2. 删除外键约束
    op.drop_constraint('fk_kuajing84_sync_logs_posting_id', 'kuajing84_sync_logs', type_='foreignkey')

    # 3. 删除列
    op.drop_column('kuajing84_sync_logs', 'started_at')
    op.drop_column('kuajing84_sync_logs', 'posting_id')
    op.drop_column('kuajing84_sync_logs', 'sync_type')