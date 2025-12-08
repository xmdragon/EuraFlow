"""add_is_deprecated_to_attributes_and_dict_values

Revision ID: df25e8274194
Revises: rename_listing_task
Create Date: 2025-12-08 17:02:18.312225

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'df25e8274194'
down_revision = 'rename_listing_task'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 为 ozon_category_attributes 添加 is_deprecated 字段
    op.add_column(
        'ozon_category_attributes',
        sa.Column('is_deprecated', sa.Boolean(), nullable=False, server_default='false',
                  comment='是否已废弃（OZON平台已移除此特征）')
    )

    # 为 ozon_attribute_dictionary_values 添加 is_deprecated 字段
    op.add_column(
        'ozon_attribute_dictionary_values',
        sa.Column('is_deprecated', sa.Boolean(), nullable=False, server_default='false',
                  comment='是否已废弃（OZON平台已移除此字典值）')
    )

    # 添加索引以加速查询未废弃的记录
    op.create_index(
        'idx_ozon_cat_attrs_deprecated',
        'ozon_category_attributes',
        ['category_id', 'is_deprecated'],
        postgresql_where=sa.text('is_deprecated = false')
    )

    op.create_index(
        'idx_ozon_dict_values_deprecated',
        'ozon_attribute_dictionary_values',
        ['dictionary_id', 'is_deprecated'],
        postgresql_where=sa.text('is_deprecated = false')
    )


def downgrade() -> None:
    op.drop_index('idx_ozon_dict_values_deprecated', table_name='ozon_attribute_dictionary_values')
    op.drop_index('idx_ozon_cat_attrs_deprecated', table_name='ozon_category_attributes')
    op.drop_column('ozon_attribute_dictionary_values', 'is_deprecated')
    op.drop_column('ozon_category_attributes', 'is_deprecated')
