"""remove_email_from_users

Revision ID: c36ac787e745
Revises: 952e39a9b298
Create Date: 2025-10-23 14:36:04.717853

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c36ac787e745'
down_revision = '952e39a9b298'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 删除 email 索引
    op.drop_index('ix_users_email', table_name='users')

    # 删除 email 列
    op.drop_column('users', 'email')


def downgrade() -> None:
    """Downgrade database schema"""
    # 恢复 email 列
    op.add_column('users', sa.Column('email', sa.String(255), nullable=True, comment='邮箱地址（选填）'))

    # 恢复 email 索引
    op.create_index('ix_users_email', 'users', ['email'])