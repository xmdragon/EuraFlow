"""add display_shop_name_format to user_settings

Revision ID: 2d8f3a5c7e91
Revises: b82768a8424b
Create Date: 2025-12-09 17:15:00

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '2d8f3a5c7e91'
down_revision = 'b82768a8424b'
branch_labels = None
depends_on = None


def upgrade():
    # 添加 display_shop_name_format 字段到 user_settings 表
    op.add_column(
        'user_settings',
        sa.Column(
            'display_shop_name_format',
            sa.String(10),
            nullable=False,
            server_default='both',
            comment='店铺名称显示格式：ru(俄文)/cn(中文)/both(俄文【中文】)'
        )
    )


def downgrade():
    op.drop_column('user_settings', 'display_shop_name_format')
