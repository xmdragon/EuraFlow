"""remove_inventory_snapshot_fields

Revision ID: 138c109c8830
Revises: e99eb89ecd03
Create Date: 2025-11-22 14:13:30.793133

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '138c109c8830'
down_revision = 'e99eb89ecd03'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 删除商品快照字段（改为查询时 JOIN 获取）
    op.drop_column('inventories', 'product_title')
    op.drop_column('inventories', 'product_image')
    op.drop_column('inventories', 'product_price')


def downgrade() -> None:
    """Downgrade database schema"""
    # 恢复商品快照字段
    op.add_column('inventories', sa.Column('product_price', sa.Numeric(precision=18, scale=4), nullable=True, comment='商品价格'))
    op.add_column('inventories', sa.Column('product_image', sa.String(length=1000), nullable=True, comment='商品图片URL'))
    op.add_column('inventories', sa.Column('product_title', sa.String(length=500), nullable=True, comment='商品名称'))