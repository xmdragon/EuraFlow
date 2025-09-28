"""remove_competitor_data_and_updated_at_fields

Revision ID: f80dfc685db5
Revises: 43a58fab5db1
Create Date: 2025-09-28 22:25:35.739686

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f80dfc685db5'
down_revision = '43a58fab5db1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Remove competitor_data and competitor_updated_at columns from ozon_product_selection_items
    op.drop_column('ozon_product_selection_items', 'competitor_data')
    op.drop_column('ozon_product_selection_items', 'competitor_updated_at')


def downgrade() -> None:
    """Downgrade database schema"""
    # Re-add competitor_data and competitor_updated_at columns
    op.add_column('ozon_product_selection_items',
                  sa.Column('competitor_data', sa.JSON(), nullable=True, comment='竞争对手详细数据'))
    op.add_column('ozon_product_selection_items',
                  sa.Column('competitor_updated_at', sa.DateTime(), nullable=True, comment='竞争数据更新时间'))