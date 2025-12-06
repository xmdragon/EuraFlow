"""add_storage_provider_to_watermark_configs

Revision ID: 0e11d310c8b3
Revises: 68bb8e522039
Create Date: 2025-11-07 09:18:51.948495

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0e11d310c8b3'
down_revision = '68bb8e522039'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 storage_provider 字段
    op.add_column(
        'watermark_configs',
        sa.Column(
            'storage_provider',
            sa.String(length=20),
            nullable=False,
            server_default='cloudinary',
            comment='图床类型：cloudinary/aliyun_oss'
        )
    )

    # 为现有数据设置默认值（所有历史数据使用 cloudinary）
    # server_default 已经处理了这个问题，但为了确保，我们显式更新
    op.execute(
        "UPDATE watermark_configs SET storage_provider = 'cloudinary' WHERE storage_provider IS NULL"
    )

    # 创建索引以优化基于图床类型的查询
    op.create_index(
        'idx_watermark_configs_storage_provider',
        'watermark_configs',
        ['storage_provider']
    )

    # 创建复合索引以优化常见查询（按图床类型 + 激活状态查询）
    op.create_index(
        'idx_watermark_configs_provider_active',
        'watermark_configs',
        ['storage_provider', 'is_active']
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_watermark_configs_provider_active', table_name='watermark_configs')
    op.drop_index('idx_watermark_configs_storage_provider', table_name='watermark_configs')

    # 删除 storage_provider 字段
    op.drop_column('watermark_configs', 'storage_provider')