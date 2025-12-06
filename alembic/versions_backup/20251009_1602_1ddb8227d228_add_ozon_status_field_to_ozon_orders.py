"""add_ozon_status_field_to_ozon_orders

Revision ID: 1ddb8227d228
Revises: cae89191f288
Create Date: 2025-10-09 16:02:51.119182

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1ddb8227d228'
down_revision = 'cae89191f288'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 ozon_status 字段到 ozon_orders 表
    op.add_column('ozon_orders', sa.Column('ozon_status', sa.String(length=50), nullable=True, comment='原始Ozon状态'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除 ozon_status 字段
    op.drop_column('ozon_orders', 'ozon_status')