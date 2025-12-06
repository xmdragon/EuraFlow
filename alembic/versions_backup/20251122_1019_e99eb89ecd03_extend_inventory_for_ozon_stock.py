"""extend_inventory_for_ozon_stock

Revision ID: e99eb89ecd03
Revises: de39ff739d87
Create Date: 2025-11-22 10:19:01.421958

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e99eb89ecd03'
down_revision = 'de39ff739d87'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加商品信息字段（快照，便于查询和展示）
    op.add_column('inventories', sa.Column('product_title', sa.String(length=500), nullable=True, comment='商品名称'))
    op.add_column('inventories', sa.Column('product_image', sa.String(length=1000), nullable=True, comment='商品图片URL'))
    op.add_column('inventories', sa.Column('product_price', sa.Numeric(precision=18, scale=4), nullable=True, comment='商品价格'))
    op.add_column('inventories', sa.Column('notes', sa.String(length=500), nullable=True, comment='备注'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除商品信息字段
    op.drop_column('inventories', 'notes')
    op.drop_column('inventories', 'product_price')
    op.drop_column('inventories', 'product_image')
    op.drop_column('inventories', 'product_title')