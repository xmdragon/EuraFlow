"""add_listing_source_to_collection_records

Revision ID: b075ca2e5eb9
Revises: df25e8274194
Create Date: 2025-12-08 21:30:52.131447

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b075ca2e5eb9'
down_revision = 'df25e8274194'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 listing_source 字段：记录上架方式
    # follow - 跟卖上架（从插件直接跟卖）
    # manual - 手动上架（在新建商品页直接上架）
    # edit - 编辑上架（从采集记录编辑后上架）
    op.add_column(
        'ozon_product_collection_records',
        sa.Column(
            'listing_source',
            sa.String(20),
            nullable=True,
            comment='上架方式：follow（跟卖上架）| manual（手动上架）| edit（编辑上架）'
        )
    )

    # 为现有的跟卖记录设置默认值
    op.execute("""
        UPDATE ozon_product_collection_records
        SET listing_source = 'follow'
        WHERE collection_type = 'follow_pdp'
          AND listing_source IS NULL
    """)


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_product_collection_records', 'listing_source')