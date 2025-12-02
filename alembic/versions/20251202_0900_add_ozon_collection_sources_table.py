"""add_ozon_collection_sources_table

创建 OZON 自动采集地址表，用于管理需要定期自动采集的类目或店铺 URL

Revision ID: c5d6e7f8g9h0
Revises: 968cf9d4ad77
Create Date: 2025-12-02 09:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c5d6e7f8g9h0'
down_revision = '968cf9d4ad77'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """创建 ozon_collection_sources 表"""
    op.create_table(
        'ozon_collection_sources',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False, comment='用户ID'),
        sa.Column('source_type', sa.String(20), nullable=False, comment='类型：category | seller'),
        sa.Column('source_url', sa.Text(), nullable=False, comment='完整 URL'),
        sa.Column('source_path', sa.String(500), nullable=False, comment='URL 路径部分（用于批次名）'),
        sa.Column('display_name', sa.String(200), nullable=True, comment='显示名称'),
        sa.Column('is_enabled', sa.Boolean(), nullable=False, default=True, comment='是否启用'),
        sa.Column('priority', sa.Integer(), nullable=False, default=0, comment='优先级'),
        sa.Column('target_count', sa.Integer(), nullable=False, default=100, comment='目标采集数量'),
        sa.Column('status', sa.String(20), nullable=False, default='pending', comment='状态'),
        sa.Column('last_collected_at', sa.DateTime(timezone=True), nullable=True, comment='上次采集完成时间'),
        sa.Column('last_product_count', sa.Integer(), nullable=False, default=0, comment='上次采集商品数量'),
        sa.Column('total_collected_count', sa.Integer(), nullable=False, default=0, comment='累计采集商品数量'),
        sa.Column('last_error', sa.Text(), nullable=True, comment='最后一次错误信息'),
        sa.Column('error_count', sa.Integer(), nullable=False, default=0, comment='连续错误次数'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'source_path', name='uq_collection_source_user_path'),
        sa.CheckConstraint("source_type IN ('category', 'seller')", name='chk_collection_source_type'),
        sa.CheckConstraint("status IN ('pending', 'collecting', 'completed', 'failed')", name='chk_collection_source_status'),
        sa.CheckConstraint('target_count > 0', name='chk_collection_source_target_count'),
    )

    # 创建索引
    op.create_index('idx_collection_source_user_enabled', 'ozon_collection_sources', ['user_id', 'is_enabled'])
    op.create_index('idx_collection_source_last_collected', 'ozon_collection_sources', ['last_collected_at'])
    op.create_index('idx_collection_source_status', 'ozon_collection_sources', ['user_id', 'status'])


def downgrade() -> None:
    """删除 ozon_collection_sources 表"""
    op.drop_index('idx_collection_source_status', table_name='ozon_collection_sources')
    op.drop_index('idx_collection_source_last_collected', table_name='ozon_collection_sources')
    op.drop_index('idx_collection_source_user_enabled', table_name='ozon_collection_sources')
    op.drop_table('ozon_collection_sources')
