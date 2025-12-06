"""add_missing_fields_to_ozon_category_attributes

Revision ID: 117ed2bf5331
Revises: 5cb8f86a84bc
Create Date: 2025-11-10 10:55:21.091736

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '117ed2bf5331'
down_revision = '5cb8f86a84bc'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 新增高优先级字段
    op.add_column('ozon_category_attributes',
        sa.Column('is_aspect', sa.Boolean(), nullable=True, server_default='false',
                  comment='是否方面属性（变体维度，入库后不可改）'))
    op.add_column('ozon_category_attributes',
        sa.Column('group_id', sa.Integer(), nullable=True,
                  comment='特征组ID'))
    op.add_column('ozon_category_attributes',
        sa.Column('group_name', sa.String(200), nullable=True,
                  comment='特征组名称'))

    # 新增中优先级字段
    op.add_column('ozon_category_attributes',
        sa.Column('category_dependent', sa.Boolean(), nullable=True, server_default='false',
                  comment='字典值是否依赖类别'))
    op.add_column('ozon_category_attributes',
        sa.Column('attribute_complex_id', sa.Integer(), nullable=True,
                  comment='复合属性标识符'))
    op.add_column('ozon_category_attributes',
        sa.Column('max_value_count', sa.Integer(), nullable=True,
                  comment='多值属性的最大值数量'))

    # 新增低优先级字段
    op.add_column('ozon_category_attributes',
        sa.Column('complex_is_collection', sa.Boolean(), nullable=True, server_default='false',
                  comment='复合特征是否为集合'))

    # 为现有数据设置默认值（移除 NULL）
    op.execute("UPDATE ozon_category_attributes SET is_aspect = false WHERE is_aspect IS NULL")
    op.execute("UPDATE ozon_category_attributes SET category_dependent = false WHERE category_dependent IS NULL")
    op.execute("UPDATE ozon_category_attributes SET complex_is_collection = false WHERE complex_is_collection IS NULL")

    # 添加组合索引优化查询性能
    op.create_index('idx_ozon_category_attrs_aspect',
                    'ozon_category_attributes',
                    ['category_id', 'is_aspect'])
    op.create_index('idx_ozon_category_attrs_group',
                    'ozon_category_attributes',
                    ['category_id', 'group_id'])


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_ozon_category_attrs_group', table_name='ozon_category_attributes')
    op.drop_index('idx_ozon_category_attrs_aspect', table_name='ozon_category_attributes')

    # 删除字段
    op.drop_column('ozon_category_attributes', 'complex_is_collection')
    op.drop_column('ozon_category_attributes', 'max_value_count')
    op.drop_column('ozon_category_attributes', 'attribute_complex_id')
    op.drop_column('ozon_category_attributes', 'category_dependent')
    op.drop_column('ozon_category_attributes', 'group_name')
    op.drop_column('ozon_category_attributes', 'group_id')
    op.drop_column('ozon_category_attributes', 'is_aspect')