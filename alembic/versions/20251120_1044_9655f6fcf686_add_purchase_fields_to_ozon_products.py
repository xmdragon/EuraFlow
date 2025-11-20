"""add purchase fields to ozon products

Revision ID: 9655f6fcf686
Revises: be53632dce86
Create Date: 2025-11-20 10:44:14.879351

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9655f6fcf686'
down_revision = 'be53632dce86'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加采购信息字段
    op.add_column('ozon_products', sa.Column('purchase_url', sa.String(length=1000), nullable=True, comment='采购地址'))
    op.add_column('ozon_products', sa.Column('suggested_purchase_price', sa.Numeric(precision=18, scale=4), nullable=True, comment='建议采购价'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除采购信息字段
    op.drop_column('ozon_products', 'suggested_purchase_price')
    op.drop_column('ozon_products', 'purchase_url')