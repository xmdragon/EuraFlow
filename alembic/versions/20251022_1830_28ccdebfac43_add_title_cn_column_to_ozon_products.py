"""add title_cn column to ozon_products

Revision ID: 28ccdebfac43
Revises: 966935fc3a2d
Create Date: 2025-10-22 18:30:46.565245

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '28ccdebfac43'
down_revision = '966935fc3a2d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 title_cn 列到 ozon_products 表
    op.add_column(
        'ozon_products',
        sa.Column('title_cn', sa.String(500), nullable=True, comment='中文名称(用于商品创建和管理)')
    )

    # 添加索引
    op.create_index(
        'idx_ozon_products_title_cn',
        'ozon_products',
        ['title_cn'],
        unique=False
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_ozon_products_title_cn', table_name='ozon_products')

    # 删除列
    op.drop_column('ozon_products', 'title_cn')