"""分离cloudinary配置文件夹

Revision ID: 6b574meopj8k
Revises: 167cc11689ef
Create Date: 2025-11-03 21:03:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '6b574meopj8k'
down_revision = '167cc11689ef'
branch_labels = None
depends_on = None


def upgrade():
    # 移除旧字段 folder_prefix
    op.drop_column('cloudinary_configs', 'folder_prefix')

    # 新增两个字段：商品图片文件夹和水印图片文件夹
    op.add_column('cloudinary_configs',
        sa.Column('product_images_folder', sa.String(100), nullable=False, server_default='products'))
    op.add_column('cloudinary_configs',
        sa.Column('watermark_images_folder', sa.String(100), nullable=False, server_default='watermarks'))


def downgrade():
    # 恢复 folder_prefix 字段
    op.add_column('cloudinary_configs',
        sa.Column('folder_prefix', sa.String(50), nullable=False, server_default='euraflow'))

    # 删除新字段
    op.drop_column('cloudinary_configs', 'watermark_images_folder')
    op.drop_column('cloudinary_configs', 'product_images_folder')
