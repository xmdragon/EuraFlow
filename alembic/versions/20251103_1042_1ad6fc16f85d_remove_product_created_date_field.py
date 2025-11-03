"""remove_product_created_date_field

Revision ID: 1ad6fc16f85d
Revises: b53c7fbe939b
Create Date: 2025-11-03 10:42:57.855240

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1ad6fc16f85d'
down_revision = 'b53c7fbe939b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 删除废弃的 product_created_date 字段
    op.drop_column('ozon_product_selection_items', 'product_created_date')


def downgrade() -> None:
    """Downgrade database schema"""
    # 恢复 product_created_date 字段
    op.add_column('ozon_product_selection_items',
                  sa.Column('product_created_date', sa.DateTime(timezone=True), nullable=True, comment='商品创建日期'))