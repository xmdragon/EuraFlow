"""create_ozon_webhook_events_table

Revision ID: 1b4058952d68
Revises: add_cancelled_operation_status
Create Date: 2025-10-18 09:18:16.545610

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '1b4058952d68'
down_revision = 'add_cancelled_operation_status'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Create ozon_webhook_events table
    op.create_table(
        'ozon_webhook_events',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('event_id', sa.String(length=200), nullable=False),
        sa.Column('event_type', sa.String(length=100), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('headers', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('signature', sa.String(length=500), nullable=True),
        sa.Column('is_verified', sa.Boolean(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('retry_count', sa.Integer(), nullable=True),
        sa.Column('idempotency_key', sa.String(length=200), nullable=True),
        sa.Column('error_message', sa.String(length=1000), nullable=True),
        sa.Column('entity_type', sa.String(length=50), nullable=True),
        sa.Column('entity_id', sa.String(length=100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('event_id')
    )

    # Create indexes
    op.create_index('idx_ozon_webhook_status', 'ozon_webhook_events', ['status', 'created_at'])
    op.create_index('idx_ozon_webhook_shop', 'ozon_webhook_events', ['shop_id', 'event_type', 'created_at'])
    op.create_index('idx_ozon_webhook_idempotency', 'ozon_webhook_events', ['idempotency_key'])
    op.create_index('idx_ozon_webhook_entity', 'ozon_webhook_events', ['entity_type', 'entity_id'])


def downgrade() -> None:
    """Downgrade database schema"""
    # Drop indexes
    op.drop_index('idx_ozon_webhook_entity', table_name='ozon_webhook_events')
    op.drop_index('idx_ozon_webhook_idempotency', table_name='ozon_webhook_events')
    op.drop_index('idx_ozon_webhook_shop', table_name='ozon_webhook_events')
    op.drop_index('idx_ozon_webhook_status', table_name='ozon_webhook_events')

    # Drop table
    op.drop_table('ozon_webhook_events')