"""change_order_price_precision_to_2_decimals

Revision ID: 4505b927bc02
Revises: d9f23d82f0b6
Create Date: 2025-10-13 11:11:02.483489

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4505b927bc02'
down_revision = 'd9f23d82f0b6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    将订单额外信息中的价格字段精度从4位小数改为2位小数
    - purchase_price: NUMERIC(18,4) -> NUMERIC(18,2)
    - material_cost: NUMERIC(18,4) -> NUMERIC(18,2)
    """
    # PostgreSQL 可以直接修改类型，如果数据已存在会自动四舍五入
    op.alter_column('ozon_orders', 'purchase_price',
                    type_=sa.Numeric(precision=18, scale=2),
                    existing_type=sa.Numeric(precision=18, scale=4),
                    existing_nullable=True)

    op.alter_column('ozon_orders', 'material_cost',
                    type_=sa.Numeric(precision=18, scale=2),
                    existing_type=sa.Numeric(precision=18, scale=4),
                    existing_nullable=True)


def downgrade() -> None:
    """回滚到4位小数"""
    op.alter_column('ozon_orders', 'purchase_price',
                    type_=sa.Numeric(precision=18, scale=4),
                    existing_type=sa.Numeric(precision=18, scale=2),
                    existing_nullable=True)

    op.alter_column('ozon_orders', 'material_cost',
                    type_=sa.Numeric(precision=18, scale=4),
                    existing_type=sa.Numeric(precision=18, scale=2),
                    existing_nullable=True)