"""add_account_status_and_expires_at_to_users

Revision ID: bd04cae74297
Revises: user_refactor_001
Create Date: 2025-12-09 09:15:32.772502

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'bd04cae74297'
down_revision = 'user_refactor_001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加账号状态字段（仅 manager/sub_account 使用，admin 不受限制）
    # active: 正常, suspended: 停用（可登录但不能写操作）, disabled: 禁用（不能登录）
    op.add_column('users', sa.Column(
        'account_status',
        sa.String(20),
        nullable=False,
        server_default='active',
        comment='账号状态：active/suspended/disabled'
    ))

    # 添加账号过期时间字段（仅 manager 使用，子账号继承管理员的过期时间）
    # NULL 表示永不过期
    op.add_column('users', sa.Column(
        'expires_at',
        sa.DateTime(timezone=True),
        nullable=True,
        comment='账号过期时间，NULL表示永不过期'
    ))


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('users', 'expires_at')
    op.drop_column('users', 'account_status')
