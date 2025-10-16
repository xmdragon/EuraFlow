"""add_profit_fields_to_posting

Revision ID: add_profit_fields
Revises: add_finance_fields
Create Date: 2025-10-16 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_profit_fields'
down_revision = 'add_finance_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    添加利润字段到 ozon_postings 表

    新增字段：
    - profit: 利润金额(CNY) = 订单金额 - (进货价格 + Ozon佣金 + 国际物流费 + 尾程派送费 + 打包费用)
    - profit_rate: 利润比率(%) = (利润金额 / 订单金额) * 100

    这些字段在以下时机计算更新：
    1. OZON财务费用同步时
    2. 手动修改订单详情的进货价格和打包费用时
    """

    # 添加利润金额字段
    op.add_column('ozon_postings', sa.Column(
        'profit',
        sa.Numeric(18, 2),
        nullable=True,
        comment='利润金额(CNY)'
    ))

    # 添加利润比率字段
    op.add_column('ozon_postings', sa.Column(
        'profit_rate',
        sa.Numeric(10, 4),
        nullable=True,
        comment='利润比率(%)'
    ))


def downgrade() -> None:
    """
    回滚迁移：删除利润字段
    """
    op.drop_column('ozon_postings', 'profit_rate')
    op.drop_column('ozon_postings', 'profit')
