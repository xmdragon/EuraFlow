"""add_aliyun_oss_config_and_image_storage_selection

Revision ID: 68bb8e522039
Revises: a5d2a3cbe7b5
Create Date: 2025-11-05 20:57:56.256825

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '68bb8e522039'
down_revision = 'a5d2a3cbe7b5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 创建 aliyun_oss_configs 表
    op.create_table(
        'aliyun_oss_configs',
        sa.Column('id', sa.Integer(), nullable=False, comment='配置ID（固定为1）'),
        sa.Column('access_key_id', sa.String(length=100), nullable=True, comment='阿里云AccessKey ID'),
        sa.Column('access_key_secret_encrypted', sa.Text(), nullable=True, comment='加密的AccessKey Secret (TODO: 实现加密)'),
        sa.Column('bucket_name', sa.String(length=100), nullable=False, comment='OSS Bucket名称'),
        sa.Column('endpoint', sa.String(length=255), nullable=False, comment='OSS Endpoint地址'),
        sa.Column('region_id', sa.String(length=50), nullable=False, server_default='cn-shanghai', comment='阿里云区域ID'),
        sa.Column('product_images_folder', sa.String(length=100), nullable=False, server_default='products', comment='商品图片文件夹路径'),
        sa.Column('watermark_images_folder', sa.String(length=100), nullable=False, server_default='watermarks', comment='水印图片文件夹路径'),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default='false', comment='是否作为默认图床'),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='false', comment='是否启用'),
        sa.Column('last_test_at', sa.DateTime(timezone=True), nullable=True, comment='最后测试连接时间'),
        sa.Column('last_test_success', sa.Boolean(), nullable=True, comment='最后测试是否成功'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
        comment='阿里云OSS配置表'
    )

    # 添加 is_default 字段到 cloudinary_configs 表
    op.add_column('cloudinary_configs', sa.Column('is_default', sa.Boolean(), nullable=False, server_default='true', comment='是否作为默认图床'))

    # 创建唯一部分索引，确保 Cloudinary 只有一个默认配置
    op.create_index(
        'idx_only_one_default_cloudinary',
        'cloudinary_configs',
        ['is_default'],
        unique=True,
        postgresql_where=sa.text('is_default = true')
    )

    # 创建唯一部分索引，确保阿里云 OSS 只有一个默认配置
    op.create_index(
        'idx_only_one_default_aliyun_oss',
        'aliyun_oss_configs',
        ['is_default'],
        unique=True,
        postgresql_where=sa.text('is_default = true')
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_only_one_default_aliyun_oss', table_name='aliyun_oss_configs')
    op.drop_index('idx_only_one_default_cloudinary', table_name='cloudinary_configs')

    # 删除 cloudinary_configs 的 is_default 字段
    op.drop_column('cloudinary_configs', 'is_default')

    # 删除 aliyun_oss_configs 表
    op.drop_table('aliyun_oss_configs')