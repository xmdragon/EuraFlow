"""add_missing_fields_to_ozon_products

Revision ID: 2deb27629242
Revises: b836f9067483
Create Date: 2025-10-09 18:34:05.339280

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '2deb27629242'
down_revision = 'b836f9067483'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    from sqlalchemy.dialects.postgresql import JSONB

    # 添加图片数据字段
    op.add_column('ozon_products',
                  sa.Column('images',
                           JSONB,
                           nullable=True,
                           comment='商品图片数据'))

    # 添加OZON可见性详情字段
    op.add_column('ozon_products',
                  sa.Column('ozon_visibility_details',
                           JSONB,
                           nullable=True,
                           comment='OZON可见性详情'))

    # 添加OZON原始状态字段
    op.add_column('ozon_products',
                  sa.Column('ozon_status',
                           sa.String(length=50),
                           nullable=True,
                           comment='OZON原始状态'))

    # 添加状态原因说明字段
    op.add_column('ozon_products',
                  sa.Column('status_reason',
                           sa.String(length=200),
                           nullable=True,
                           comment='状态原因说明'))


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_products', 'status_reason')
    op.drop_column('ozon_products', 'ozon_status')
    op.drop_column('ozon_products', 'ozon_visibility_details')
    op.drop_column('ozon_products', 'images')