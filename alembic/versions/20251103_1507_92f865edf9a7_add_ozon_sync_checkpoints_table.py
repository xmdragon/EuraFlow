"""add_ozon_sync_checkpoints_table

Revision ID: 92f865edf9a7
Revises: 1ad6fc16f85d
Create Date: 2025-11-03 15:07:44.506891

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '92f865edf9a7'
down_revision = '1ad6fc16f85d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 创建 ozon_sync_checkpoints 表
    op.create_table(
        'ozon_sync_checkpoints',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('entity_type', sa.String(length=50), nullable=False),
        sa.Column('last_cursor', sa.String(length=500), nullable=True),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_modified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True, server_default='idle'),
        sa.Column('error_message', sa.String(length=1000), nullable=True),
        sa.Column('retry_count', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('total_processed', sa.BigInteger(), nullable=True, server_default='0'),
        sa.Column('total_success', sa.BigInteger(), nullable=True, server_default='0'),
        sa.Column('total_failed', sa.BigInteger(), nullable=True, server_default='0'),
        sa.Column('config', sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('shop_id', 'entity_type', name='uq_ozon_checkpoint')
    )

    # 创建索引
    op.create_index('idx_ozon_checkpoint_status', 'ozon_sync_checkpoints', ['status', 'last_sync_at'], unique=False)


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_index('idx_ozon_checkpoint_status', table_name='ozon_sync_checkpoints')
    op.drop_table('ozon_sync_checkpoints')