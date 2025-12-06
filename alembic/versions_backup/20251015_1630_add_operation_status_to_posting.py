"""add operation_status to ozon_postings

Revision ID: add_operation_status
Revises: add_operation_time_to_posting
Create Date: 2025-10-15 16:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_operation_status'
down_revision = 'add_operation_time'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """添加 operation_status 字段到 ozon_postings 表"""
    # 添加 operation_status 字段，默认值为 'awaiting_stock'
    op.add_column(
        'ozon_postings',
        sa.Column(
            'operation_status',
            sa.String(50),
            nullable=False,
            server_default='awaiting_stock',
            comment='操作状态：awaiting_stock(等待备货)/allocating(分配中)/allocated(已分配)/tracking_confirmed(单号确认)'
        )
    )

    # 添加索引以提高查询性能
    op.create_index(
        'idx_ozon_postings_operation_status',
        'ozon_postings',
        ['shop_id', 'operation_status']
    )


def downgrade() -> None:
    """回滚：删除 operation_status 字段和索引"""
    op.drop_index('idx_ozon_postings_operation_status', table_name='ozon_postings')
    op.drop_column('ozon_postings', 'operation_status')
