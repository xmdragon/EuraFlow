"""add ozon_daily_stats table

Revision ID: 4ed4e5fbb633
Revises: a7f2c8d91e34
Create Date: 2025-11-25 12:11:40.877612

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '4ed4e5fbb633'
down_revision = 'a7f2c8d91e34'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    op.create_table(
        'ozon_daily_stats',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False, comment='统计日期'),
        # 订单统计
        sa.Column('order_count', sa.Integer(), nullable=False, server_default='0', comment='订单数'),
        sa.Column('delivered_count', sa.Integer(), nullable=False, server_default='0', comment='已签收订单数'),
        sa.Column('cancelled_count', sa.Integer(), nullable=False, server_default='0', comment='已取消订单数'),
        # 金额统计（CNY）
        sa.Column('total_sales', sa.Numeric(18, 4), nullable=False, server_default='0', comment='销售总额(CNY)'),
        sa.Column('total_purchase', sa.Numeric(18, 4), nullable=False, server_default='0', comment='采购成本(CNY)'),
        sa.Column('total_profit', sa.Numeric(18, 4), nullable=False, server_default='0', comment='毛利润(CNY)'),
        sa.Column('total_commission', sa.Numeric(18, 4), nullable=False, server_default='0', comment='平台佣金(CNY)'),
        sa.Column('total_logistics', sa.Numeric(18, 4), nullable=False, server_default='0', comment='物流费用(CNY)'),
        sa.Column('total_material_cost', sa.Numeric(18, 4), nullable=False, server_default='0', comment='物料成本(CNY)'),
        # 商品维度
        sa.Column('top_products', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='TOP商品'),
        # 元数据
        sa.Column('generated_at', sa.DateTime(timezone=True), nullable=True, comment='统计生成时间'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        # 主键和外键
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['shop_id'], ['ozon_shops.id']),
        # 唯一约束
        sa.UniqueConstraint('shop_id', 'date', name='uq_ozon_daily_stats_shop_date'),
    )
    # 创建索引
    op.create_index('idx_ozon_daily_stats_date', 'ozon_daily_stats', ['date'])
    op.create_index('idx_ozon_daily_stats_shop_date', 'ozon_daily_stats', ['shop_id', 'date'])
    op.create_index('idx_ozon_daily_stats_shop_id', 'ozon_daily_stats', ['shop_id'])


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_index('idx_ozon_daily_stats_shop_id', table_name='ozon_daily_stats')
    op.drop_index('idx_ozon_daily_stats_shop_date', table_name='ozon_daily_stats')
    op.drop_index('idx_ozon_daily_stats_date', table_name='ozon_daily_stats')
    op.drop_table('ozon_daily_stats')