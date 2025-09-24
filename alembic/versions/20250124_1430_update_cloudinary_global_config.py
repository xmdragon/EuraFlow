"""update cloudinary to global config

Revision ID: c8f9a2b3d4e5
Revises: d7f8e9a2b3c4
Create Date: 2025-01-24 14:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c8f9a2b3d4e5'
down_revision = 'd7f8e9a2b3c4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 移除shop_id外键约束
    op.drop_constraint('cloudinary_configs_shop_id_fkey', 'cloudinary_configs', type_='foreignkey')

    # 移除shop_id唯一约束
    op.drop_constraint('uq_cloudinary_config_shop', 'cloudinary_configs', type_='unique')

    # 删除shop_id列
    op.drop_column('cloudinary_configs', 'shop_id')


def downgrade() -> None:
    # 恢复shop_id列
    op.add_column('cloudinary_configs', sa.Column('shop_id', sa.BigInteger(), nullable=True))

    # 为现有记录设置默认shop_id（假设为1）
    op.execute("UPDATE cloudinary_configs SET shop_id = 1 WHERE shop_id IS NULL")

    # 设置为非空
    op.alter_column('cloudinary_configs', 'shop_id', nullable=False)

    # 恢复外键约束
    op.create_foreign_key(
        'cloudinary_configs_shop_id_fkey',
        'cloudinary_configs',
        'ozon_shops',
        ['shop_id'],
        ['id'],
        ondelete='CASCADE'
    )

    # 恢复唯一约束
    op.create_unique_constraint(
        'uq_cloudinary_config_shop',
        'cloudinary_configs',
        ['shop_id']
    )