"""add_product_videos_folder_to_storage_configs

Revision ID: a59eacff576f
Revises: bcd678373dcd
Create Date: 2025-11-09 22:23:59.223373

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a59eacff576f'
down_revision = 'bcd678373dcd'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 为 cloudinary_configs 表添加 product_videos_folder 列
    op.add_column(
        'cloudinary_configs',
        sa.Column('product_videos_folder', sa.String(100), nullable=False, server_default='videos')
    )

    # 为 aliyun_oss_configs 表添加 product_videos_folder 列
    op.add_column(
        'aliyun_oss_configs',
        sa.Column('product_videos_folder', sa.String(100), nullable=False, server_default='videos')
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除 cloudinary_configs 表的 product_videos_folder 列
    op.drop_column('cloudinary_configs', 'product_videos_folder')

    # 删除 aliyun_oss_configs 表的 product_videos_folder 列
    op.drop_column('aliyun_oss_configs', 'product_videos_folder')