"""add_product_detailed_attributes_and_title_cn

Revision ID: 966935fc3a2d
Revises: d78e320ed2fd
Create Date: 2025-10-22 08:25:23.681392

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision = '966935fc3a2d'
down_revision = 'd78e320ed2fd'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加中文名称字段
    op.add_column('ozon_products', sa.Column('title_cn', sa.String(500), nullable=True, comment='中文名称'))

    # 添加OZON API详细属性字段
    op.add_column('ozon_products', sa.Column('attributes', JSONB, nullable=True, comment='商品特征数组'))
    op.add_column('ozon_products', sa.Column('complex_attributes', JSONB, nullable=True, comment='嵌套特征'))
    op.add_column('ozon_products', sa.Column('description_category_id', sa.BigInteger, nullable=True, comment='类目标识符'))
    op.add_column('ozon_products', sa.Column('color_image', sa.String(200), nullable=True, comment='市场营销色彩'))
    op.add_column('ozon_products', sa.Column('dimension_unit', sa.String(10), nullable=True, comment='尺寸单位(mm/cm/in)'))
    op.add_column('ozon_products', sa.Column('weight_unit', sa.String(10), nullable=True, comment='重量单位'))
    op.add_column('ozon_products', sa.Column('type_id', sa.BigInteger, nullable=True, comment='商品类型标识符'))
    op.add_column('ozon_products', sa.Column('model_info', JSONB, nullable=True, comment='型号信息'))
    op.add_column('ozon_products', sa.Column('pdf_list', JSONB, nullable=True, comment='PDF文件列表'))
    op.add_column('ozon_products', sa.Column('primary_image', sa.String(500), nullable=True, comment='主图链接'))
    op.add_column('ozon_products', sa.Column('barcodes', JSONB, nullable=True, comment='所有条形码数组'))
    op.add_column('ozon_products', sa.Column('attributes_with_defaults', JSONB, nullable=True, comment='具有默认值的特征ID列表'))

    # 为中文名称添加索引（便于搜索）
    op.create_index('idx_ozon_products_title_cn', 'ozon_products', ['title_cn'])


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_ozon_products_title_cn', 'ozon_products')

    # 删除所有新增字段
    op.drop_column('ozon_products', 'attributes_with_defaults')
    op.drop_column('ozon_products', 'barcodes')
    op.drop_column('ozon_products', 'primary_image')
    op.drop_column('ozon_products', 'pdf_list')
    op.drop_column('ozon_products', 'model_info')
    op.drop_column('ozon_products', 'type_id')
    op.drop_column('ozon_products', 'weight_unit')
    op.drop_column('ozon_products', 'dimension_unit')
    op.drop_column('ozon_products', 'color_image')
    op.drop_column('ozon_products', 'description_category_id')
    op.drop_column('ozon_products', 'complex_attributes')
    op.drop_column('ozon_products', 'attributes')
    op.drop_column('ozon_products', 'title_cn')