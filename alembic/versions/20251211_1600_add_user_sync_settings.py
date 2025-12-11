"""add_user_sync_settings

在 user_settings 表添加三个同步开关字段：
- sync_promotions: 自动同步促销活动
- sync_finance_transactions: 自动同步财务账单
- sync_balance: 自动同步余额

Revision ID: add_user_sync_settings
Revises: move_session_to_users
Create Date: 2025-12-11 16:00:00

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_user_sync_settings'
down_revision = 'move_session_to_users'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加三个同步开关字段到 user_settings 表
    op.add_column(
        'user_settings',
        sa.Column(
            'sync_promotions',
            sa.Boolean(),
            nullable=False,
            server_default='true',
            comment='自动同步促销活动'
        )
    )
    op.add_column(
        'user_settings',
        sa.Column(
            'sync_finance_transactions',
            sa.Boolean(),
            nullable=False,
            server_default='true',
            comment='自动同步财务账单'
        )
    )
    op.add_column(
        'user_settings',
        sa.Column(
            'sync_balance',
            sa.Boolean(),
            nullable=False,
            server_default='true',
            comment='自动同步余额'
        )
    )


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('user_settings', 'sync_balance')
    op.drop_column('user_settings', 'sync_finance_transactions')
    op.drop_column('user_settings', 'sync_promotions')
