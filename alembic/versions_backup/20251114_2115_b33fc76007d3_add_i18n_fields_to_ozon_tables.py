"""add_i18n_fields_to_ozon_tables

Revision ID: b33fc76007d3
Revises: 29a214671ef5
Create Date: 2025-11-14 21:15:22.009106

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b33fc76007d3'
down_revision = '29a214671ef5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # ===== OzonCategory 表 =====
    # 添加中文和俄文名称字段
    op.add_column('ozon_categories',
        sa.Column('name_zh', sa.String(500), nullable=True, comment='类目中文名称'))
    op.add_column('ozon_categories',
        sa.Column('name_ru', sa.String(500), nullable=True, comment='类目俄文名称'))

    # 数据迁移：将现有 name 数据复制到 name_zh（假设现有数据为中文）
    op.execute("UPDATE ozon_categories SET name_zh = name WHERE name IS NOT NULL")

    # 添加索引以优化查询
    op.create_index('idx_ozon_categories_name_zh', 'ozon_categories', ['name_zh'])

    # ===== OzonCategoryAttribute 表 =====
    # 添加中文和俄文名称、描述、组名字段
    op.add_column('ozon_category_attributes',
        sa.Column('name_zh', sa.String(500), nullable=True, comment='属性中文名称'))
    op.add_column('ozon_category_attributes',
        sa.Column('name_ru', sa.String(500), nullable=True, comment='属性俄文名称'))
    op.add_column('ozon_category_attributes',
        sa.Column('description_zh', sa.Text(), nullable=True, comment='属性中文描述'))
    op.add_column('ozon_category_attributes',
        sa.Column('description_ru', sa.Text(), nullable=True, comment='属性俄文描述'))
    op.add_column('ozon_category_attributes',
        sa.Column('group_name_zh', sa.String(200), nullable=True, comment='特征组中文名称'))
    op.add_column('ozon_category_attributes',
        sa.Column('group_name_ru', sa.String(200), nullable=True, comment='特征组俄文名称'))

    # 数据迁移：将现有数据复制到中文字段
    op.execute("UPDATE ozon_category_attributes SET name_zh = name WHERE name IS NOT NULL")
    op.execute("UPDATE ozon_category_attributes SET description_zh = description WHERE description IS NOT NULL")
    op.execute("UPDATE ozon_category_attributes SET group_name_zh = group_name WHERE group_name IS NOT NULL")

    # ===== OzonAttributeDictionaryValue 表 =====
    # 添加中文和俄文值、附加信息字段
    op.add_column('ozon_attribute_dictionary_values',
        sa.Column('value_zh', sa.Text(), nullable=True, comment='字典值中文'))
    op.add_column('ozon_attribute_dictionary_values',
        sa.Column('value_ru', sa.Text(), nullable=True, comment='字典值俄文'))
    op.add_column('ozon_attribute_dictionary_values',
        sa.Column('info_zh', sa.Text(), nullable=True, comment='附加信息中文'))
    op.add_column('ozon_attribute_dictionary_values',
        sa.Column('info_ru', sa.Text(), nullable=True, comment='附加信息俄文'))

    # 数据迁移：将现有数据复制到中文字段
    op.execute("UPDATE ozon_attribute_dictionary_values SET value_zh = value WHERE value IS NOT NULL")
    op.execute("UPDATE ozon_attribute_dictionary_values SET info_zh = info WHERE info IS NOT NULL")

    # 添加索引以优化查询
    op.create_index('idx_ozon_dict_values_value_zh', 'ozon_attribute_dictionary_values', ['value_zh'])


def downgrade() -> None:
    """Downgrade database schema"""
    # ===== OzonAttributeDictionaryValue 表 =====
    # 删除索引
    op.drop_index('idx_ozon_dict_values_value_zh', table_name='ozon_attribute_dictionary_values')

    # 删除字段
    op.drop_column('ozon_attribute_dictionary_values', 'info_ru')
    op.drop_column('ozon_attribute_dictionary_values', 'info_zh')
    op.drop_column('ozon_attribute_dictionary_values', 'value_ru')
    op.drop_column('ozon_attribute_dictionary_values', 'value_zh')

    # ===== OzonCategoryAttribute 表 =====
    # 删除字段
    op.drop_column('ozon_category_attributes', 'group_name_ru')
    op.drop_column('ozon_category_attributes', 'group_name_zh')
    op.drop_column('ozon_category_attributes', 'description_ru')
    op.drop_column('ozon_category_attributes', 'description_zh')
    op.drop_column('ozon_category_attributes', 'name_ru')
    op.drop_column('ozon_category_attributes', 'name_zh')

    # ===== OzonCategory 表 =====
    # 删除索引
    op.drop_index('idx_ozon_categories_name_zh', table_name='ozon_categories')

    # 删除字段
    op.drop_column('ozon_categories', 'name_ru')
    op.drop_column('ozon_categories', 'name_zh')