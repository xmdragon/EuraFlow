"""add_advanced_product_fields_variants_type_id_images360

Revision ID: e9ddc769bb96
Revises: 117ed2bf5331
Create Date: 2025-11-10 17:53:38.963618

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e9ddc769bb96'
down_revision = '117ed2bf5331'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 注意：type_id, color_image, pdf_list, premium_price 在模型中已存在
    # 仅添加新字段：images360, promotions, variants

    # 添加 images360 字段（360度全景图URL数组，存储为JSONB）
    op.add_column('ozon_products', sa.Column('images360', sa.dialects.postgresql.JSONB(), nullable=True, comment="360度全景图URL数组"))

    # 添加 promotions 字段（关联的促销活动ID数组，存储为JSONB）
    op.add_column('ozon_products', sa.Column('promotions', sa.dialects.postgresql.JSONB(), nullable=True, comment="促销活动ID数组"))

    # 添加 variants 字段（变体数据，存储完整的变体信息包括属性、图片、价格等）
    op.add_column('ozon_products', sa.Column('variants', sa.dialects.postgresql.JSONB(), nullable=True, comment="OZON原始变体数据"))


def downgrade() -> None:
    """Downgrade database schema"""
    # 按添加的逆序删除字段
    op.drop_column('ozon_products', 'variants')
    op.drop_column('ozon_products', 'promotions')
    op.drop_column('ozon_products', 'images360')