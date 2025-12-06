"""add_ozon_sync_logs_table

Revision ID: ded56bc5ca54
Revises: 92f865edf9a7
Create Date: 2025-11-03 16:13:11.530130

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ded56bc5ca54'
down_revision = '92f865edf9a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 创建 ozon_sync_logs 表
    op.create_table(
        'ozon_sync_logs',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('entity_type', sa.String(length=50), nullable=False),
        sa.Column('sync_type', sa.String(length=50), nullable=True),
        sa.Column('batch_id', sa.String(length=100), nullable=True),
        sa.Column('batch_size', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.Column('processed_count', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('success_count', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('failed_count', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('skipped_count', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('error_message', sa.String(length=2000), nullable=True),
        sa.Column('error_details', sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('api_calls', sa.Integer(), nullable=True),
        sa.Column('rate_limit_hits', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id')
    )

    # 创建索引
    op.create_index('idx_ozon_sync_log_shop', 'ozon_sync_logs', ['shop_id', 'entity_type', 'started_at'], unique=False)
    op.create_index('idx_ozon_sync_log_status', 'ozon_sync_logs', ['status', 'started_at'], unique=False)
    op.create_index('idx_ozon_sync_log_batch', 'ozon_sync_logs', ['batch_id'], unique=False)


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_index('idx_ozon_sync_log_batch', table_name='ozon_sync_logs')
    op.drop_index('idx_ozon_sync_log_status', table_name='ozon_sync_logs')
    op.drop_index('idx_ozon_sync_log_shop', table_name='ozon_sync_logs')
    op.drop_table('ozon_sync_logs')