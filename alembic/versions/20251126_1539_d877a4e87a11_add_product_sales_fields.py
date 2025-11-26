"""add_product_sales_fields

Revision ID: d877a4e87a11
Revises: 9cfcd92d4710
Create Date: 2025-11-26 15:39:23.996205

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd877a4e87a11'
down_revision = '9cfcd92d4710'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加销量字段
    op.add_column('ozon_products', sa.Column('sales_count', sa.Integer(), server_default='0', comment='累计销量'))
    op.add_column('ozon_products', sa.Column('last_sale_at', sa.DateTime(timezone=True), nullable=True, comment='最后销售时间'))

    # 添加索引，优化销量排序查询
    op.create_index('idx_ozon_products_sales', 'ozon_products', ['shop_id', 'sales_count'], postgresql_using='btree')


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_index('idx_ozon_products_sales', table_name='ozon_products')
    op.drop_column('ozon_products', 'last_sale_at')
    op.drop_column('ozon_products', 'sales_count')