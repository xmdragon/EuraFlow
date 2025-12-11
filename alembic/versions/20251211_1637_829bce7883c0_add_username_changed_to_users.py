"""add_username_changed_to_users

Revision ID: 829bce7883c0
Revises: 101a7bcbbddd
Create Date: 2025-12-11 16:37:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '829bce7883c0'
down_revision = '101a7bcbbddd'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """添加 username_changed 字段，标记用户名是否已被修改过"""
    op.add_column('users', sa.Column('username_changed', sa.Boolean(), nullable=False, server_default='false', comment='用户名是否已修改过（注册用户仅可修改一次）'))


def downgrade() -> None:
    """移除 username_changed 字段"""
    op.drop_column('users', 'username_changed')
