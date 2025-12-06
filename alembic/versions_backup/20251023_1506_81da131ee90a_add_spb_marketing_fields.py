"""add_spb_marketing_fields

Revision ID: 81da131ee90a
Revises: c36ac787e745
Create Date: 2025-10-23 15:06:58.406483

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '81da131ee90a'
down_revision = 'c36ac787e745'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 营销分析字段（上品帮新增）
    op.add_column('ozon_product_selection_items', sa.Column('card_views', sa.Integer(), nullable=True, comment='商品卡片浏览量'))
    op.add_column('ozon_product_selection_items', sa.Column('card_add_to_cart_rate', sa.Numeric(precision=5, scale=2), nullable=True, comment='商品卡片加购率(%)'))
    op.add_column('ozon_product_selection_items', sa.Column('search_views', sa.Integer(), nullable=True, comment='搜索和目录浏览量'))
    op.add_column('ozon_product_selection_items', sa.Column('search_add_to_cart_rate', sa.Numeric(precision=5, scale=2), nullable=True, comment='搜索和目录加购率(%)'))
    op.add_column('ozon_product_selection_items', sa.Column('click_through_rate', sa.Numeric(precision=5, scale=2), nullable=True, comment='点击率(%)'))
    op.add_column('ozon_product_selection_items', sa.Column('promo_days', sa.Integer(), nullable=True, comment='参与促销天数'))
    op.add_column('ozon_product_selection_items', sa.Column('promo_discount_percent', sa.Numeric(precision=5, scale=2), nullable=True, comment='参与促销的折扣(%)'))
    op.add_column('ozon_product_selection_items', sa.Column('promo_conversion_rate', sa.Numeric(precision=5, scale=2), nullable=True, comment='促销活动的转化率(%)'))
    op.add_column('ozon_product_selection_items', sa.Column('paid_promo_days', sa.Integer(), nullable=True, comment='付费推广天数'))
    op.add_column('ozon_product_selection_items', sa.Column('return_cancel_rate', sa.Numeric(precision=5, scale=2), nullable=True, comment='退货取消率(%)'))

    # 基础字段（上品帮新增）
    op.add_column('ozon_product_selection_items', sa.Column('category_path', sa.String(length=500), nullable=True, comment='类目路径'))
    op.add_column('ozon_product_selection_items', sa.Column('avg_price', sa.Numeric(precision=18, scale=2), nullable=True, comment='平均价格(RUB)'))
    op.add_column('ozon_product_selection_items', sa.Column('listing_date', sa.DateTime(timezone=True), nullable=True, comment='上架时间'))
    op.add_column('ozon_product_selection_items', sa.Column('listing_days', sa.Integer(), nullable=True, comment='上架天数'))
    op.add_column('ozon_product_selection_items', sa.Column('seller_mode', sa.String(length=20), nullable=True, comment='发货模式(FBS/FBO)'))

    # 添加 category_path 索引
    op.create_index('idx_category_path', 'ozon_product_selection_items', ['category_path'], unique=False)


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_category_path', table_name='ozon_product_selection_items')

    # 删除基础字段
    op.drop_column('ozon_product_selection_items', 'seller_mode')
    op.drop_column('ozon_product_selection_items', 'listing_days')
    op.drop_column('ozon_product_selection_items', 'listing_date')
    op.drop_column('ozon_product_selection_items', 'avg_price')
    op.drop_column('ozon_product_selection_items', 'category_path')

    # 删除营销分析字段
    op.drop_column('ozon_product_selection_items', 'return_cancel_rate')
    op.drop_column('ozon_product_selection_items', 'paid_promo_days')
    op.drop_column('ozon_product_selection_items', 'promo_conversion_rate')
    op.drop_column('ozon_product_selection_items', 'promo_discount_percent')
    op.drop_column('ozon_product_selection_items', 'promo_days')
    op.drop_column('ozon_product_selection_items', 'click_through_rate')
    op.drop_column('ozon_product_selection_items', 'search_add_to_cart_rate')
    op.drop_column('ozon_product_selection_items', 'search_views')
    op.drop_column('ozon_product_selection_items', 'card_add_to_cart_rate')
    op.drop_column('ozon_product_selection_items', 'card_views')