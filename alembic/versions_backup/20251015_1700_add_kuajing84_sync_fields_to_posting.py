"""add kuajing84 sync fields to posting

Revision ID: add_kuajing84_sync_fields
Revises: add_operation_status
Create Date: 2025-10-15 17:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_kuajing84_sync_fields'
down_revision = 'add_operation_status'
branch_labels = None
depends_on = None


def upgrade():
    """添加跨境巴士同步状态字段到 ozon_postings 表"""

    # 添加 kuajing84_sync_error 字段
    op.add_column('ozon_postings',
        sa.Column('kuajing84_sync_error', sa.String(length=200), nullable=True,
                  comment='跨境巴士同步错误信息（如"订单不存在"则跳过后续同步）')
    )

    # 添加 kuajing84_last_sync_at 字段
    op.add_column('ozon_postings',
        sa.Column('kuajing84_last_sync_at', sa.DateTime(timezone=True), nullable=True,
                  comment='最后尝试同步跨境巴士的时间')
    )

    # 创建索引以提升查询性能
    op.create_index('idx_ozon_postings_kuajing84_sync', 'ozon_postings',
                    ['kuajing84_sync_error', 'material_cost'],
                    unique=False)


def downgrade():
    """回滚：删除跨境巴士同步状态字段"""

    # 删除索引
    op.drop_index('idx_ozon_postings_kuajing84_sync', table_name='ozon_postings')

    # 删除字段
    op.drop_column('ozon_postings', 'kuajing84_last_sync_at')
    op.drop_column('ozon_postings', 'kuajing84_sync_error')
