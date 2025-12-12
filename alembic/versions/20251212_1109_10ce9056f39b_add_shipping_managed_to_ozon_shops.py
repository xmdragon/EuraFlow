"""add_shipping_managed_to_ozon_shops

Revision ID: 10ce9056f39b
Revises: add_credit_system
Create Date: 2025-12-12 11:09:14.148246

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '10ce9056f39b'
down_revision = 'add_credit_system'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema

    1. 添加 ozon_shops.shipping_managed 字段（发货托管）
    """
    # 添加 shipping_managed 字段到 ozon_shops 表
    op.add_column(
        'ozon_shops',
        sa.Column(
            'shipping_managed',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
            comment='发货托管：启用后发货员可操作该店铺订单'
        )
    )


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_shops', 'shipping_managed')