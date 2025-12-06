"""add_listing_fields_to_ozon_products

Revision ID: b44e5ecabdfc
Revises: 3708ad18ca99
Create Date: 2025-11-12 15:41:28.464963

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b44e5ecabdfc'
down_revision = '3708ad18ca99'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Add listing-related fields to ozon_products table
    op.add_column('ozon_products', sa.Column('listing_status', sa.String(50), comment='上架状态: draft/media_ready/import_submitted/created/priced/live/ready_for_sale/error'))
    op.add_column('ozon_products', sa.Column('listing_mode', sa.String(20), comment='上架模式: NEW_CARD/FOLLOW_PDP'))
    op.add_column('ozon_products', sa.Column('listing_error_code', sa.String(100), comment='上架错误代码'))
    op.add_column('ozon_products', sa.Column('listing_error_message', sa.String(1000), comment='上架错误消息'))
    op.add_column('ozon_products', sa.Column('media_ready_at', sa.DateTime(timezone=True), comment='媒体准备完成时间'))
    op.add_column('ozon_products', sa.Column('import_submitted_at', sa.DateTime(timezone=True), comment='导入提交时间'))


def downgrade() -> None:
    """Downgrade database schema"""
    # Remove listing-related fields from ozon_products table
    op.drop_column('ozon_products', 'import_submitted_at')
    op.drop_column('ozon_products', 'media_ready_at')
    op.drop_column('ozon_products', 'listing_error_message')
    op.drop_column('ozon_products', 'listing_error_code')
    op.drop_column('ozon_products', 'listing_mode')
    op.drop_column('ozon_products', 'listing_status')