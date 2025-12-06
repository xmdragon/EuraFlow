"""add_warehouse_stocks_to_ozon_products

Revision ID: 491abd05714d
Revises: fb0dd27c8529
Create Date: 2025-10-29 09:55:58.023940

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision = '491abd05714d'
down_revision = 'fb0dd27c8529'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加warehouse_stocks字段到ozon_products表
    # 格式: [{"warehouse_id": 123, "warehouse_name": "UMI", "present": 9, "reserved": 0}]
    op.add_column(
        'ozon_products',
        sa.Column('warehouse_stocks', JSONB, nullable=True, comment='按仓库分组的库存详情')
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除warehouse_stocks字段
    op.drop_column('ozon_products', 'warehouse_stocks')