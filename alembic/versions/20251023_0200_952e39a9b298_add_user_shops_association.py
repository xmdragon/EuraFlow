"""add_user_shops_association

Revision ID: 952e39a9b298
Revises: 966935fc3a2d
Create Date: 2025-10-23 02:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '952e39a9b298'
down_revision = '966935fc3a2d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema - 添加用户店铺关联表"""

    # 1. 创建 user_shops 关联表
    op.create_table(
        'user_shops',
        sa.Column('user_id', sa.BigInteger(), nullable=False, comment='用户ID'),
        sa.Column('shop_id', sa.BigInteger(), nullable=False, comment='店铺ID'),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
            comment='关联创建时间'
        ),
        sa.ForeignKeyConstraint(
            ['user_id'],
            ['users.id'],
            name='fk_user_shops_user_id',
            ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['shop_id'],
            ['shops.id'],
            name='fk_user_shops_shop_id',
            ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('user_id', 'shop_id', name='pk_user_shops')
    )

    # 2. 创建索引（提高查询性能）
    op.create_index(
        'ix_user_shops_user_id',
        'user_shops',
        ['user_id']
    )

    op.create_index(
        'ix_user_shops_shop_id',
        'user_shops',
        ['shop_id']
    )

    # 3. 为所有现有 admin 用户关联所有现有店铺
    op.execute("""
        INSERT INTO user_shops (user_id, shop_id)
        SELECT u.id, s.id
        FROM users u
        CROSS JOIN shops s
        WHERE u.role = 'admin'
    """)


def downgrade() -> None:
    """Downgrade database schema - 删除用户店铺关联表"""

    # 1. 删除索引
    op.drop_index('ix_user_shops_shop_id', table_name='user_shops')
    op.drop_index('ix_user_shops_user_id', table_name='user_shops')

    # 2. 删除表（外键约束会自动删除）
    op.drop_table('user_shops')
