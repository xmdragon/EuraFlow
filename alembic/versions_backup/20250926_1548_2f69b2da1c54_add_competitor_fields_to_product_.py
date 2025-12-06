"""add_competitor_fields_to_product_selection

Revision ID: 2f69b2da1c54
Revises: 8649280daab1
Create Date: 2025-09-26 15:48:02.030370

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '2f69b2da1c54'
down_revision = '8649280daab1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加竞争对手相关字段
    op.add_column('ozon_product_selection_items',
                  sa.Column('competitor_count', sa.Integer(), server_default='0', nullable=True, comment='跟卖者数量'))
    op.add_column('ozon_product_selection_items',
                  sa.Column('competitor_min_price', sa.Numeric(precision=18, scale=2), nullable=True, comment='跟卖最低价(卢布)'))
    op.add_column('ozon_product_selection_items',
                  sa.Column('market_min_price', sa.Numeric(precision=18, scale=2), nullable=True, comment='市场最低价(卢布)'))
    op.add_column('ozon_product_selection_items',
                  sa.Column('price_index', sa.Numeric(precision=10, scale=2), nullable=True, comment='价格指数'))
    op.add_column('ozon_product_selection_items',
                  sa.Column('competitor_data', sa.JSON(), nullable=True, comment='竞争对手详细数据'))
    op.add_column('ozon_product_selection_items',
                  sa.Column('competitor_updated_at', sa.DateTime(), nullable=True, comment='竞争数据更新时间'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除竞争对手相关字段
    op.drop_column('ozon_product_selection_items', 'competitor_updated_at')
    op.drop_column('ozon_product_selection_items', 'competitor_data')
    op.drop_column('ozon_product_selection_items', 'price_index')
    op.drop_column('ozon_product_selection_items', 'market_min_price')
    op.drop_column('ozon_product_selection_items', 'competitor_min_price')
    op.drop_column('ozon_product_selection_items', 'competitor_count')