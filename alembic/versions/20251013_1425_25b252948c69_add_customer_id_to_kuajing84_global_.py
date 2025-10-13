"""add_customer_id_to_kuajing84_global_config

Revision ID: 25b252948c69
Revises: 4505b927bc02
Create Date: 2025-10-13 14:25:53.608617

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '25b252948c69'
down_revision = '4505b927bc02'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 customer_id 字段到 kuajing84_global_config 表
    op.add_column('kuajing84_global_config', sa.Column('customer_id', sa.String(length=50), nullable=True, comment='客户ID（从控制台页面获取）'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除 customer_id 字段
    op.drop_column('kuajing84_global_config', 'customer_id')