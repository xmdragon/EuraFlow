"""add_shop_name_cn_to_ozon_shops

Revision ID: 482be5dccf9b
Revises: 81da131ee90a
Create Date: 2025-10-23 16:41:08.129740

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '482be5dccf9b'
down_revision = '81da131ee90a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 shop_name_cn 字段到 ozon_shops 表
    op.add_column('ozon_shops', sa.Column('shop_name_cn', sa.String(length=200), nullable=True, comment='店铺中文名称'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 移除 shop_name_cn 字段
    op.drop_column('ozon_shops', 'shop_name_cn')