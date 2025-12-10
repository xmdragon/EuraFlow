"""update_product_dimensions_precision

更新商品尺寸字段精度：
- weight: Numeric(10,3) -> Numeric(10,1)，单位 g（克）
- width/height/depth: Numeric(10,2) -> Numeric(10,1)，单位 mm（毫米）

Revision ID: 5c953e2b700d
Revises: b666b18767b1
Create Date: 2025-12-10 07:56:38.372347

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5c953e2b700d'
down_revision = 'b666b18767b1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 更新字段精度和注释
    op.alter_column('ozon_products', 'weight',
                    type_=sa.Numeric(10, 1),
                    comment='重量(g)',
                    existing_nullable=True)
    op.alter_column('ozon_products', 'width',
                    type_=sa.Numeric(10, 1),
                    comment='宽度(mm)',
                    existing_nullable=True)
    op.alter_column('ozon_products', 'height',
                    type_=sa.Numeric(10, 1),
                    comment='高度(mm)',
                    existing_nullable=True)
    op.alter_column('ozon_products', 'depth',
                    type_=sa.Numeric(10, 1),
                    comment='深度(mm)',
                    existing_nullable=True)


def downgrade() -> None:
    """Downgrade database schema"""
    op.alter_column('ozon_products', 'weight',
                    type_=sa.Numeric(10, 3),
                    comment='重量(kg)',
                    existing_nullable=True)
    op.alter_column('ozon_products', 'width',
                    type_=sa.Numeric(10, 2),
                    comment='宽度(cm)',
                    existing_nullable=True)
    op.alter_column('ozon_products', 'height',
                    type_=sa.Numeric(10, 2),
                    comment='高度(cm)',
                    existing_nullable=True)
    op.alter_column('ozon_products', 'depth',
                    type_=sa.Numeric(10, 2),
                    comment='深度(cm)',
                    existing_nullable=True)
