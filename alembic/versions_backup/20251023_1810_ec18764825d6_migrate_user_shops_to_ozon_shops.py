"""migrate_user_shops_to_ozon_shops

Revision ID: ec18764825d6
Revises: 482be5dccf9b
Create Date: 2025-10-23 18:10:45.609313

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ec18764825d6'
down_revision = '482be5dccf9b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Upgrade database schema - 统一使用 ozon_shops 表

    背景：系统有两个店铺表（shops 和 ozon_shops），user_shops 关联表链接到 shops.id，
    但实际业务使用 ozon_shops。此迁移统一使用 ozon_shops 表，删除冗余的 shops 表。
    """

    # 1. 删除 user_shops 表的外键约束（指向 shops.id）
    op.drop_constraint('fk_user_shops_shop_id', 'user_shops', type_='foreignkey')

    # 2. 添加新的外键约束（指向 ozon_shops.id）
    op.create_foreign_key(
        'fk_user_shops_shop_id_ozon',
        'user_shops',
        'ozon_shops',
        ['shop_id'],
        ['id'],
        ondelete='CASCADE'
    )

    # 3. 删除 users 表的 primary_shop_id 外键约束（指向 shops.id）
    op.drop_constraint('fk_users_primary_shop_id', 'users', type_='foreignkey')

    # 4. 添加新的外键约束（指向 ozon_shops.id）
    op.create_foreign_key(
        'fk_users_primary_shop_id_ozon',
        'users',
        'ozon_shops',
        ['primary_shop_id'],
        ['id'],
        ondelete='SET NULL'
    )

    # 5. 删除 shops 表（已废弃）
    # 注意：shops 表应该是空的，所有数据都在 ozon_shops 中
    op.drop_table('shops')


def downgrade() -> None:
    """
    Downgrade database schema - 回滚到 shops 表

    警告：此回滚会重新创建 shops 表，但不会恢复数据！
    """

    # 1. 重新创建 shops 表
    op.create_table(
        'shops',
        sa.Column('id', sa.BigInteger(), nullable=False, comment='店铺ID'),
        sa.Column('name', sa.String(100), nullable=False, comment='店铺名称'),
        sa.Column('owner_user_id', sa.BigInteger(), nullable=False, comment='店铺所有者ID'),
        sa.Column('api_key_enc', sa.Text(), nullable=True, comment='加密的API密钥'),
        sa.Column('settings', sa.JSON(), nullable=False, server_default='{}', comment='店铺配置'),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
            comment='创建时间'
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
            comment='更新时间'
        ),
        sa.PrimaryKeyConstraint('id', name='pk_shops'),
        sa.UniqueConstraint('name', name='uq_shops_name'),
        sa.ForeignKeyConstraint(
            ['owner_user_id'],
            ['users.id'],
            name='fk_shops_owner_user_id',
            ondelete='CASCADE'
        )
    )

    # 2. 删除指向 ozon_shops 的外键
    op.drop_constraint('fk_user_shops_shop_id_ozon', 'user_shops', type_='foreignkey')
    op.drop_constraint('fk_users_primary_shop_id_ozon', 'users', type_='foreignkey')

    # 3. 恢复指向 shops 的外键
    op.create_foreign_key(
        'fk_user_shops_shop_id',
        'user_shops',
        'shops',
        ['shop_id'],
        ['id'],
        ondelete='CASCADE'
    )

    op.create_foreign_key(
        'fk_users_primary_shop_id',
        'users',
        'shops',
        ['primary_shop_id'],
        ['id'],
        ondelete='SET NULL'
    )