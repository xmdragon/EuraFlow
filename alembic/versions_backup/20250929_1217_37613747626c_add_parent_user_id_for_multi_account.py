"""add_parent_user_id_for_multi_account

Revision ID: 37613747626c
Revises: a9519ef9136d
Create Date: 2025-09-29 12:17:03.231176

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '37613747626c'
down_revision = 'a9519ef9136d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加parent_user_id字段支持多账号体系
    op.add_column('users', sa.Column('parent_user_id', sa.BigInteger(), nullable=True, comment='父账号ID'))

    # 添加外键约束
    op.create_foreign_key(
        'fk_users_parent_user_id',
        'users', 'users',
        ['parent_user_id'], ['id'],
        ondelete='CASCADE'
    )

    # 添加索引
    op.create_index('ix_users_parent_user_id', 'users', ['parent_user_id'])

    # 为现有admin账号设置parent_user_id为NULL（表示主账号）
    op.execute("""
        UPDATE users
        SET parent_user_id = NULL
        WHERE role = 'admin'
    """)

    # 添加user_id到选品表（如果不存在）
    # 检查列是否存在
    conn = op.get_bind()
    result = conn.execute(sa.text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'ozon_product_selection_items'
        AND column_name = 'user_id'
    """))

    if not result.fetchone():
        op.add_column('ozon_product_selection_items',
                     sa.Column('user_id', sa.Integer(), nullable=True, comment='用户ID'))

        # 设置默认值为第一个admin用户
        op.execute("""
            UPDATE ozon_product_selection_items
            SET user_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1)
            WHERE user_id IS NULL
        """)

        # 改为非空
        op.alter_column('ozon_product_selection_items', 'user_id', nullable=False)

        # 添加外键和索引
        op.create_foreign_key(
            'fk_product_selection_user_id',
            'ozon_product_selection_items', 'users',
            ['user_id'], ['id'],
            ondelete='CASCADE'
        )
        op.create_index('ix_product_selection_user_id', 'ozon_product_selection_items', ['user_id'])


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除选品表的user_id相关约束
    conn = op.get_bind()
    result = conn.execute(sa.text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'ozon_product_selection_items'
        AND column_name = 'user_id'
    """))

    if result.fetchone():
        op.drop_index('ix_product_selection_user_id', 'ozon_product_selection_items')
        op.drop_constraint('fk_product_selection_user_id', 'ozon_product_selection_items', type_='foreignkey')
        op.drop_column('ozon_product_selection_items', 'user_id')

    # 删除users表的parent_user_id相关约束
    op.drop_index('ix_users_parent_user_id', 'users')
    op.drop_constraint('fk_users_parent_user_id', 'users', type_='foreignkey')
    op.drop_column('users', 'parent_user_id')