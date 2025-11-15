"""add ozon_product_collection_records table

Revision ID: 81f93e05caf8
Revises: b33fc76007d3
Create Date: 2025-11-15 09:17:50.059825

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision = '81f93e05caf8'
down_revision = 'b33fc76007d3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 创建采集记录表
    op.create_table(
        'ozon_product_collection_records',
        # 主键与关联
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('ozon_shops.id'), nullable=True),

        # 采集类型（核心区分字段）
        sa.Column('collection_type', sa.String(20), nullable=False),

        # 采集来源
        sa.Column('source_url', sa.Text(), nullable=False),
        sa.Column('source_product_id', sa.String(100), nullable=True),

        # 商品数据（JSONB格式）
        sa.Column('product_data', JSONB(), nullable=False),

        # 跟卖上架专属字段（仅 collection_type='follow_pdp' 时使用）
        sa.Column('listing_request_payload', JSONB(), nullable=True),
        sa.Column('listing_task_id', sa.String(100), nullable=True),
        sa.Column('listing_status', sa.String(50), nullable=True),
        sa.Column('listing_product_id', sa.BigInteger(), nullable=True),
        sa.Column('listing_error_message', sa.Text(), nullable=True),
        sa.Column('listing_at', sa.DateTime(), nullable=True),

        # 状态管理
        sa.Column('is_read', sa.Boolean(), default=False, server_default=sa.false()),
        sa.Column('is_deleted', sa.Boolean(), default=False, server_default=sa.false()),

        # 用户行为记录
        sa.Column('last_edited_at', sa.DateTime(), nullable=True),
        sa.Column('last_edited_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),

        # 时间戳（UTC）
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text("(NOW() AT TIME ZONE 'UTC')")),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text("(NOW() AT TIME ZONE 'UTC')")),

        # 约束
        sa.CheckConstraint("collection_type IN ('follow_pdp', 'collect_only')", name='chk_collection_type')
    )

    # 创建索引
    op.create_index('idx_collection_user', 'ozon_product_collection_records', ['user_id', sa.text('created_at DESC')])
    op.create_index('idx_collection_type_status', 'ozon_product_collection_records', ['collection_type', 'listing_status'])
    op.create_index(
        'idx_collection_shop',
        'ozon_product_collection_records',
        ['shop_id'],
        postgresql_where=sa.text('shop_id IS NOT NULL')
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_collection_shop', table_name='ozon_product_collection_records')
    op.drop_index('idx_collection_type_status', table_name='ozon_product_collection_records')
    op.drop_index('idx_collection_user', table_name='ozon_product_collection_records')

    # 删除表
    op.drop_table('ozon_product_collection_records')