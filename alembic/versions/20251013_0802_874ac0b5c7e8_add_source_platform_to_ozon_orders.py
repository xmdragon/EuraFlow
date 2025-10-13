"""add_source_platform_to_ozon_orders

Revision ID: 874ac0b5c7e8
Revises: a1b2c3d4e5f6
Create Date: 2025-10-13 08:02:20.168351

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '874ac0b5c7e8'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加采集平台字段到 ozon_orders 表
    op.add_column('ozon_orders', sa.Column('source_platform', sa.String(length=50), nullable=True, comment='采集平台'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除采集平台字段
    op.drop_column('ozon_orders', 'source_platform')