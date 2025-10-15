"""add_finance_fields_to_posting

Revision ID: add_finance_fields
Revises: add_shipping_status
Create Date: 2025-10-15 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_finance_fields'
down_revision = 'add_shipping_status'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    添加财务费用字段到 ozon_postings 表

    新增字段：
    - last_mile_delivery_fee_cny: 尾程派送费(CNY)，即"国际运输代理费"
    - international_logistics_fee_cny: 国际物流费(CNY)，即"配送服务费转移"
    - ozon_commission_cny: Ozon佣金(CNY)，即"销售佣金"
    - finance_synced_at: 财务同步时间

    这些字段用于存储从OZON财务API获取的费用数据，
    使用历史汇率（商品价格CNY / 商品成本RUB）转换后的CNY金额
    """

    # 添加财务费用字段
    op.add_column('ozon_postings', sa.Column(
        'last_mile_delivery_fee_cny',
        sa.Numeric(18, 2),
        nullable=True,
        comment='尾程派送费(CNY)'
    ))

    op.add_column('ozon_postings', sa.Column(
        'international_logistics_fee_cny',
        sa.Numeric(18, 2),
        nullable=True,
        comment='国际物流费(CNY)'
    ))

    op.add_column('ozon_postings', sa.Column(
        'ozon_commission_cny',
        sa.Numeric(18, 2),
        nullable=True,
        comment='Ozon佣金(CNY)'
    ))

    op.add_column('ozon_postings', sa.Column(
        'finance_synced_at',
        sa.DateTime(timezone=True),
        nullable=True,
        comment='财务同步时间'
    ))


def downgrade() -> None:
    """
    回滚迁移：删除财务费用字段
    """
    op.drop_column('ozon_postings', 'finance_synced_at')
    op.drop_column('ozon_postings', 'ozon_commission_cny')
    op.drop_column('ozon_postings', 'international_logistics_fee_cny')
    op.drop_column('ozon_postings', 'last_mile_delivery_fee_cny')
