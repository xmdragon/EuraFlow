"""remove_color_type_from_watermark_configs

Revision ID: eb995fa2d1d2
Revises: ea9472b2b81e
Create Date: 2025-11-08 08:39:27.377536

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'eb995fa2d1d2'
down_revision = 'ea9472b2b81e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 移除watermark_configs表的color_type列
    # 水印默认使用透明PNG，不再需要颜色类型字段
    op.drop_column('watermark_configs', 'color_type')


def downgrade() -> None:
    """Downgrade database schema"""
    # 恢复color_type列
    op.add_column('watermark_configs',
        sa.Column('color_type', sa.String(length=50), nullable=False, server_default='transparent')
    )