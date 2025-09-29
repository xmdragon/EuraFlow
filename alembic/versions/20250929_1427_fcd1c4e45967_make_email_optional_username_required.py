"""make_email_optional_username_required

Revision ID: fcd1c4e45967
Revises: 37613747626c
Create Date: 2025-09-29 14:27:01.000755

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'fcd1c4e45967'
down_revision = '37613747626c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 1. 移除email的唯一约束
    op.drop_index('ix_users_email', 'users')

    # 2. 让email字段可为空
    op.alter_column('users', 'email',
                    nullable=True,
                    existing_type=sa.String(255))

    # 3. 确保username不为空（先为现有记录填充username）
    op.execute("""
        UPDATE users
        SET username = COALESCE(username, split_part(email, '@', 1) || '_' || id::text)
        WHERE username IS NULL
    """)

    # 4. 让username字段不可为空
    op.alter_column('users', 'username',
                    nullable=False,
                    existing_type=sa.String(50))

    # 5. 创建新的索引
    op.create_index('ix_users_email', 'users', ['email'], unique=False)
    op.create_index('ix_users_username', 'users', ['username'], unique=True)


def downgrade() -> None:
    """Downgrade database schema"""
    # 1. 移除新索引
    op.drop_index('ix_users_username', 'users')
    op.drop_index('ix_users_email', 'users')

    # 2. 恢复email为必填（先为空的email填充默认值）
    op.execute("""
        UPDATE users
        SET email = username || '@example.com'
        WHERE email IS NULL
    """)

    # 3. 让email字段不可为空
    op.alter_column('users', 'email',
                    nullable=False,
                    existing_type=sa.String(255))

    # 4. 让username字段可为空
    op.alter_column('users', 'username',
                    nullable=True,
                    existing_type=sa.String(50))

    # 5. 恢复email的唯一索引
    op.create_index('ix_users_email', 'users', ['email'], unique=True)