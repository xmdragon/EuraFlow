"""add_images_data_to_product_selection

Revision ID: 43a58fab5db1
Revises: 2f69b2da1c54
Create Date: 2025-09-26 16:35:12.100074

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '43a58fab5db1'
down_revision = '2f69b2da1c54'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Add images_data and images_updated_at columns to ozon_product_selection_items
    op.add_column('ozon_product_selection_items',
                  sa.Column('images_data', sa.JSON(), nullable=True, comment='商品图片信息列表'))
    op.add_column('ozon_product_selection_items',
                  sa.Column('images_updated_at', sa.DateTime(), nullable=True, comment='图片信息更新时间'))


def downgrade() -> None:
    """Downgrade database schema"""
    # Remove the added columns
    op.drop_column('ozon_product_selection_items', 'images_updated_at')
    op.drop_column('ozon_product_selection_items', 'images_data')