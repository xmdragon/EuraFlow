"""修改 ozon_categories 表支持多对多父子关系

Revision ID: 167cc11689ef
Revises: ded56bc5ca54
Create Date: 2025-11-03 17:02:40.266706

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '167cc11689ef'
down_revision = 'ded56bc5ca54'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    修改 ozon_categories 表以支持多对多父子关系

    OZON API 返回的类目树中，同一个叶子类目（type_id）可以出现在多个父类目下。
    例如："印刷书籍"、"报纸"、"杂志"同时属于"现代印刷物"、"古旧出版物"、"古董出版物"。

    改动：
    1. 添加自增主键 id
    2. category_id 改为普通列
    3. 添加 (category_id, parent_id) 唯一索引
    """

    # 1. 删除依赖 category_id 主键的外键约束
    op.drop_constraint('ozon_categories_parent_id_fkey', 'ozon_categories', type_='foreignkey')
    op.drop_constraint('ozon_category_attributes_category_id_fkey', 'ozon_category_attributes', type_='foreignkey')

    # 2. 删除原主键约束
    op.drop_constraint('ozon_categories_pkey', 'ozon_categories', type_='primary')

    # 3. 添加新的自增主键列 id（先设为可空）
    op.add_column('ozon_categories', sa.Column('id', sa.Integer(), autoincrement=True, nullable=True))

    # 4. 使用序列填充 id 列（分开执行，避免多命令问题）
    op.execute("CREATE SEQUENCE IF NOT EXISTS ozon_categories_id_seq")
    op.execute("UPDATE ozon_categories SET id = nextval('ozon_categories_id_seq')")
    op.execute("ALTER TABLE ozon_categories ALTER COLUMN id SET DEFAULT nextval('ozon_categories_id_seq')")

    # 5. 设置 id 为非空并创建主键
    op.alter_column('ozon_categories', 'id', nullable=False)
    op.create_primary_key('ozon_categories_pkey', 'ozon_categories', ['id'])

    # 5. 修改 category_id 列属性（移除主键后已经是普通列）
    op.alter_column('ozon_categories', 'category_id',
                    existing_type=sa.Integer(),
                    nullable=False,
                    comment='OZON类目ID')

    op.alter_column('ozon_categories', 'parent_id',
                    existing_type=sa.Integer(),
                    nullable=True,
                    comment='父类目ID')

    # 6. 创建新的唯一索引 (category_id, parent_id)
    op.create_index('idx_ozon_categories_category_parent', 'ozon_categories',
                    ['category_id', 'parent_id'], unique=True)

    # 7. 创建 category_id 索引（用于查询）
    op.create_index('idx_ozon_categories_category_id', 'ozon_categories', ['category_id'])

    # 8. 重新创建外键约束
    op.create_foreign_key('ozon_category_attributes_category_id_fkey', 'ozon_category_attributes', 'ozon_categories',
                         ['category_id'], ['category_id'], ondelete='CASCADE')


def downgrade() -> None:
    """回滚到原来的结构（不建议使用，会导致数据丢失）"""

    # 注意：回滚会导致数据丢失（多对多关系会被简化为一对多）

    # 1. 删除外键约束
    op.drop_constraint('ozon_category_attributes_category_id_fkey', 'ozon_category_attributes', type_='foreignkey')

    # 2. 删除新索引
    op.drop_index('idx_ozon_categories_category_id', 'ozon_categories')
    op.drop_index('idx_ozon_categories_category_parent', 'ozon_categories')

    # 2. 删除主键
    op.drop_constraint('ozon_categories_pkey', 'ozon_categories', type_='primary')

    # 3. 删除 id 列
    op.drop_column('ozon_categories', 'id')

    # 4. 将 category_id 恢复为主键
    op.create_primary_key('ozon_categories_pkey', 'ozon_categories', ['category_id'])

    # 5. 恢复外键约束
    op.create_foreign_key('ozon_categories_parent_id_fkey', 'ozon_categories', 'ozon_categories',
                         ['parent_id'], ['category_id'], ondelete='SET NULL')
    op.create_foreign_key('ozon_category_attributes_category_id_fkey', 'ozon_category_attributes', 'ozon_categories',
                         ['category_id'], ['category_id'], ondelete='CASCADE')