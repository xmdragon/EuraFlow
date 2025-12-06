"""add_ozon_product_templates_table

Revision ID: 4c44894cf0b6
Revises: eb995fa2d1d2
Create Date: 2025-11-08 16:34:59.429036

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '4c44894cf0b6'
down_revision = 'eb995fa2d1d2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 创建 ozon_product_templates 表
    op.create_table(
        'ozon_product_templates',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('template_type', sa.String(length=20), nullable=False),
        sa.Column('template_name', sa.String(length=200), nullable=True),
        sa.Column('shop_id', sa.Integer(), nullable=True),
        sa.Column('category_id', sa.Integer(), nullable=True),
        sa.Column('form_data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.CheckConstraint("template_type IN ('draft', 'template')", name='ck_template_type')
    )

    # 创建索引
    op.create_index('idx_templates_user_type', 'ozon_product_templates', ['user_id', 'template_type'])
    op.create_index('idx_templates_shop', 'ozon_product_templates', ['shop_id'], postgresql_where=sa.text('shop_id IS NOT NULL'))
    op.create_index('idx_templates_category', 'ozon_product_templates', ['category_id'], postgresql_where=sa.text('category_id IS NOT NULL'))
    op.create_index('idx_templates_updated_at', 'ozon_product_templates', [sa.text('updated_at DESC')])

    # 唯一约束：每个用户只能有一个草稿
    op.create_index(
        'idx_templates_user_draft',
        'ozon_product_templates',
        ['user_id'],
        unique=True,
        postgresql_where=sa.text("template_type = 'draft'")
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_templates_user_draft', table_name='ozon_product_templates')
    op.drop_index('idx_templates_updated_at', table_name='ozon_product_templates')
    op.drop_index('idx_templates_category', table_name='ozon_product_templates')
    op.drop_index('idx_templates_shop', table_name='ozon_product_templates')
    op.drop_index('idx_templates_user_type', table_name='ozon_product_templates')

    # 删除表
    op.drop_table('ozon_product_templates')