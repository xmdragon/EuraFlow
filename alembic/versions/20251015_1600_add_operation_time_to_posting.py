"""add operation_time to posting

Revision ID: add_operation_time
Revises: 20251014_1635
Create Date: 2025-10-15 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_operation_time'
down_revision = '20251014_1635_cleanup'
branch_labels = None
depends_on = None


def upgrade():
    """添加operation_time字段到ozon_postings表"""
    # 添加operation_time字段
    op.add_column('ozon_postings', sa.Column('operation_time', sa.DateTime(timezone=True), nullable=True, comment='用户操作时间（备货/打包等操作的时间戳）'))

    # 添加索引以优化按操作时间查询
    op.create_index('idx_ozon_postings_operation_time', 'ozon_postings', ['shop_id', 'operation_time'], unique=False)


def downgrade():
    """回滚：删除operation_time字段"""
    # 删除索引
    op.drop_index('idx_ozon_postings_operation_time', table_name='ozon_postings')

    # 删除字段
    op.drop_column('ozon_postings', 'operation_time')
