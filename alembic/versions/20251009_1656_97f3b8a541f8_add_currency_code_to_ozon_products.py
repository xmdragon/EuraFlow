"""add_currency_code_to_ozon_products

Revision ID: 97f3b8a541f8
Revises: ec9f36ac48db
Create Date: 2025-10-09 16:56:23.984634

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '97f3b8a541f8'
down_revision = 'ec9f36ac48db'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 currency_code 字段到 ozon_products 表
    op.add_column('ozon_products', sa.Column('currency_code', sa.String(length=10), nullable=True, comment='货币代码(CNY/RUB/USD等)'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除 currency_code 字段
    op.drop_column('ozon_products', 'currency_code')