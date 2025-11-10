"""add_videos_to_ozon_products

Revision ID: 5cb8f86a84bc
Revises: a59eacff576f
Create Date: 2025-11-09 22:30:00.130461

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision = '5cb8f86a84bc'
down_revision = 'a59eacff576f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 为 ozon_products 表添加 videos 列
    op.add_column(
        'ozon_products',
        sa.Column('videos', JSONB, nullable=True, comment='商品视频数据 [{url, name, is_cover}]')
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除 ozon_products 表的 videos 列
    op.drop_column('ozon_products', 'videos')