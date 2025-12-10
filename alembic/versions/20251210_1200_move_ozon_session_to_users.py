"""move_ozon_session_to_users

将 OZON Session Cookie 从 ozon_shops 表移动到 users 表

原因：一个用户登录 OZON 后可以切换多个店铺，Cookie 应该存储在用户级别

Revision ID: move_session_to_users
Revises: 76ce564fd8a4
Create Date: 2025-12-10 12:00:00

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'move_session_to_users'
down_revision = '76ce564fd8a4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 1. 在 users 表添加 OZON Session 字段
    op.add_column(
        'users',
        sa.Column(
            'ozon_session_enc',
            sa.Text(),
            nullable=True,
            comment='加密的 OZON 浏览器 Cookie JSON'
        )
    )
    op.add_column(
        'users',
        sa.Column(
            'ozon_session_updated_at',
            sa.DateTime(timezone=True),
            nullable=True,
            comment='浏览器 Cookie 更新时间'
        )
    )

    # 2. 从 ozon_shops 表删除这两个字段
    op.drop_column('ozon_shops', 'ozon_session_updated_at')
    op.drop_column('ozon_shops', 'ozon_session_enc')


def downgrade() -> None:
    """Downgrade database schema"""
    # 1. 在 ozon_shops 表恢复字段
    op.add_column(
        'ozon_shops',
        sa.Column(
            'ozon_session_enc',
            sa.Text(),
            nullable=True,
            comment='加密的 OZON 浏览器 Cookie JSON'
        )
    )
    op.add_column(
        'ozon_shops',
        sa.Column(
            'ozon_session_updated_at',
            sa.DateTime(timezone=True),
            nullable=True,
            comment='浏览器 Cookie 更新时间'
        )
    )

    # 2. 从 users 表删除字段
    op.drop_column('users', 'ozon_session_updated_at')
    op.drop_column('users', 'ozon_session_enc')
