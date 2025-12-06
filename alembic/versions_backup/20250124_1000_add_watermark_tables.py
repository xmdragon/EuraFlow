"""add watermark tables

Revision ID: d7f8e9a2b3c4
Revises: ad51b98f55da
Create Date: 2025-01-24 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd7f8e9a2b3c4'
down_revision: Union[str, None] = 'ad51b98f55da'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create watermark_configs table
    op.create_table('watermark_configs',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.BigInteger(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('cloudinary_public_id', sa.Text(), nullable=False),
        sa.Column('image_url', sa.Text(), nullable=False),
        sa.Column('color_type', sa.String(length=20), nullable=False),
        sa.Column('scale_ratio', sa.Numeric(precision=5, scale=3), nullable=False),
        sa.Column('opacity', sa.Numeric(precision=3, scale=2), nullable=False),
        sa.Column('margin_pixels', sa.Integer(), nullable=False),
        sa.Column('positions', sa.JSON(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['shop_id'], ['ozon_shops.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        comment='水印配置表'
    )
    op.create_index(op.f('ix_watermark_configs_shop_id'), 'watermark_configs', ['shop_id'], unique=False)

    # Create cloudinary_configs table
    op.create_table('cloudinary_configs',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.BigInteger(), nullable=False),
        sa.Column('cloud_name', sa.String(length=100), nullable=False),
        sa.Column('api_key', sa.String(length=100), nullable=False),
        sa.Column('api_secret_encrypted', sa.Text(), nullable=False),
        sa.Column('folder_prefix', sa.String(length=50), nullable=False),
        sa.Column('auto_cleanup_days', sa.Integer(), nullable=False),
        sa.Column('last_quota_check', sa.DateTime(timezone=True), nullable=True),
        sa.Column('storage_used_bytes', sa.BigInteger(), nullable=True),
        sa.Column('bandwidth_used_bytes', sa.BigInteger(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('last_test_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_test_success', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['shop_id'], ['ozon_shops.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('shop_id', name='uq_cloudinary_config_shop'),
        comment='Cloudinary配置表'
    )

    # Create watermark_tasks table
    op.create_table('watermark_tasks',
        sa.Column('id', postgresql.UUID(), nullable=False),
        sa.Column('shop_id', sa.BigInteger(), nullable=False),
        sa.Column('product_id', sa.BigInteger(), nullable=False),
        sa.Column('watermark_config_id', sa.BigInteger(), nullable=True),
        sa.Column('task_type', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('original_images', sa.JSON(), nullable=True),
        sa.Column('processed_images', sa.JSON(), nullable=True),
        sa.Column('cloudinary_public_ids', sa.JSON(), nullable=True),
        sa.Column('processing_metadata', sa.JSON(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('retry_count', sa.Integer(), nullable=False),
        sa.Column('max_retries', sa.Integer(), nullable=False),
        sa.Column('batch_id', postgresql.UUID(), nullable=True),
        sa.Column('batch_total', sa.Integer(), nullable=True),
        sa.Column('batch_position', sa.Integer(), nullable=True),
        sa.Column('processing_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['product_id'], ['ozon_products.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['shop_id'], ['ozon_shops.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['watermark_config_id'], ['watermark_configs.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        comment='水印任务表'
    )

    # Create unique constraint for preventing duplicate processing tasks
    op.create_index(
        'uq_watermark_task_processing',
        'watermark_tasks',
        ['shop_id', 'product_id', 'status'],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'processing')")
    )

    # Create indexes for better query performance
    op.create_index(op.f('ix_watermark_tasks_shop_id'), 'watermark_tasks', ['shop_id'], unique=False)
    op.create_index(op.f('ix_watermark_tasks_product_id'), 'watermark_tasks', ['product_id'], unique=False)
    op.create_index(op.f('ix_watermark_tasks_status'), 'watermark_tasks', ['status'], unique=False)
    op.create_index(op.f('ix_watermark_tasks_batch_id'), 'watermark_tasks', ['batch_id'], unique=False)
    op.create_index(op.f('ix_watermark_tasks_created_at'), 'watermark_tasks', ['created_at'], unique=False)


def downgrade() -> None:
    # Drop indexes
    op.drop_index(op.f('ix_watermark_tasks_created_at'), table_name='watermark_tasks')
    op.drop_index(op.f('ix_watermark_tasks_batch_id'), table_name='watermark_tasks')
    op.drop_index(op.f('ix_watermark_tasks_status'), table_name='watermark_tasks')
    op.drop_index(op.f('ix_watermark_tasks_product_id'), table_name='watermark_tasks')
    op.drop_index(op.f('ix_watermark_tasks_shop_id'), table_name='watermark_tasks')
    op.drop_index('uq_watermark_task_processing', table_name='watermark_tasks')

    # Drop tables
    op.drop_table('watermark_tasks')
    op.drop_table('cloudinary_configs')
    op.drop_index(op.f('ix_watermark_configs_shop_id'), table_name='watermark_configs')
    op.drop_table('watermark_configs')