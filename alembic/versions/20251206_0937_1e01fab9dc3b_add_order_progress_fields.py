"""add order progress fields

Revision ID: 1e01fab9dc3b
Revises: 8005a952704d
Create Date: 2025-12-06 09:37:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1e01fab9dc3b'
down_revision = '8005a952704d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加国际追踪号首次同步时间字段
    op.add_column(
        'ozon_postings',
        sa.Column('tracking_synced_at', sa.DateTime(timezone=True), nullable=True, comment='国际追踪号首次同步时间')
    )
    # 添加国内单号最后更新时间字段
    op.add_column(
        'ozon_postings',
        sa.Column('domestic_tracking_updated_at', sa.DateTime(timezone=True), nullable=True, comment='国内单号最后更新时间')
    )


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_postings', 'domestic_tracking_updated_at')
    op.drop_column('ozon_postings', 'tracking_synced_at')
