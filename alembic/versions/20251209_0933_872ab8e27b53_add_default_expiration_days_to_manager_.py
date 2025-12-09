"""add_default_expiration_days_to_manager_levels

Revision ID: 872ab8e27b53
Revises: bd04cae74297
Create Date: 2025-12-09 09:33:25.862800

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '872ab8e27b53'
down_revision = 'bd04cae74297'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 default_expiration_days 字段到 manager_levels 表
    op.add_column(
        'manager_levels',
        sa.Column(
            'default_expiration_days',
            sa.Integer(),
            nullable=False,
            server_default='30',
            comment='默认过期周期（天数）：7/30/90/365/0'
        )
    )


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('manager_levels', 'default_expiration_days')