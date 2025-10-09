"""convert_datetime_columns_to_timezone_aware

Revision ID: e199c93e7d25
Revises: bc94f8c80f6a
Create Date: 2025-10-09 19:10:20.592121

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e199c93e7d25'
down_revision = 'bc94f8c80f6a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema - convert DateTime columns to timezone-aware"""

    # ozon_orders table (9 columns)
    op.alter_column('ozon_orders', 'ordered_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=False)
    op.alter_column('ozon_orders', 'confirmed_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'shipped_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'delivered_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'cancelled_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'delivery_date',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'last_sync_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'updated_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)

    # ozon_postings table (7 columns)
    op.alter_column('ozon_postings', 'shipment_date',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'in_process_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'shipped_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'delivered_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'cancelled_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'updated_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)

    # ozon_order_items table (1 column)
    op.alter_column('ozon_order_items', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)

    # ozon_shipment_packages table (4 columns)
    op.alter_column('ozon_shipment_packages', 'label_printed_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_shipment_packages', 'status_updated_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_shipment_packages', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_shipment_packages', 'updated_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)

    # ozon_refunds table (5 columns)
    op.alter_column('ozon_refunds', 'requested_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=False)
    op.alter_column('ozon_refunds', 'approved_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_refunds', 'completed_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_refunds', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_refunds', 'updated_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)

    # ozon_sync_checkpoints table (4 columns)
    op.alter_column('ozon_sync_checkpoints', 'last_sync_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_sync_checkpoints', 'last_modified_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_sync_checkpoints', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_sync_checkpoints', 'updated_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)

    # ozon_sync_logs table (3 columns)
    op.alter_column('ozon_sync_logs', 'started_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=False)
    op.alter_column('ozon_sync_logs', 'completed_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_sync_logs', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)

    # ozon_webhook_events table (3 columns)
    op.alter_column('ozon_webhook_events', 'processed_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_webhook_events', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_webhook_events', 'updated_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)

    # ozon_api_metrics table (1 column)
    op.alter_column('ozon_api_metrics', 'requested_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=False)

    # ozon_outbox_events table (3 columns)
    op.alter_column('ozon_outbox_events', 'sent_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_outbox_events', 'next_retry_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_outbox_events', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)

    # ozon_chat_messages table (4 columns)
    op.alter_column('ozon_chat_messages', 'read_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_chat_messages', 'edited_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_chat_messages', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=False)
    op.alter_column('ozon_chat_messages', 'updated_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)

    # ozon_chats table (4 columns)
    op.alter_column('ozon_chats', 'last_message_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_chats', 'closed_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_chats', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=False)
    op.alter_column('ozon_chats', 'updated_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)

    # ozon_product_selection_items table (4 columns)
    op.alter_column('ozon_product_selection_items', 'product_created_date',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_product_selection_items', 'images_updated_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=True)
    op.alter_column('ozon_product_selection_items', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=False)
    op.alter_column('ozon_product_selection_items', 'updated_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=False)

    # ozon_product_selection_import_history table (2 columns)
    op.alter_column('ozon_product_selection_import_history', 'import_time',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=False)
    op.alter_column('ozon_product_selection_import_history', 'created_at',
                   type_=sa.DateTime(timezone=True),
                   existing_type=sa.DateTime(),
                   existing_nullable=False)


def downgrade() -> None:
    """Downgrade database schema - convert DateTime columns back to timezone-naive"""

    # ozon_orders table
    op.alter_column('ozon_orders', 'ordered_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=False)
    op.alter_column('ozon_orders', 'confirmed_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'shipped_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'delivered_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'cancelled_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'delivery_date',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'last_sync_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_orders', 'updated_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)

    # ozon_postings table
    op.alter_column('ozon_postings', 'shipment_date',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'in_process_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'shipped_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'delivered_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'cancelled_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_postings', 'updated_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)

    # ozon_order_items table
    op.alter_column('ozon_order_items', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)

    # ozon_shipment_packages table
    op.alter_column('ozon_shipment_packages', 'label_printed_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_shipment_packages', 'status_updated_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_shipment_packages', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_shipment_packages', 'updated_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)

    # ozon_refunds table
    op.alter_column('ozon_refunds', 'requested_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=False)
    op.alter_column('ozon_refunds', 'approved_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_refunds', 'completed_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_refunds', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_refunds', 'updated_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)

    # ozon_sync_checkpoints table
    op.alter_column('ozon_sync_checkpoints', 'last_sync_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_sync_checkpoints', 'last_modified_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_sync_checkpoints', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_sync_checkpoints', 'updated_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)

    # ozon_sync_logs table
    op.alter_column('ozon_sync_logs', 'started_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=False)
    op.alter_column('ozon_sync_logs', 'completed_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_sync_logs', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)

    # ozon_webhook_events table
    op.alter_column('ozon_webhook_events', 'processed_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_webhook_events', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_webhook_events', 'updated_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)

    # ozon_api_metrics table
    op.alter_column('ozon_api_metrics', 'requested_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=False)

    # ozon_outbox_events table
    op.alter_column('ozon_outbox_events', 'sent_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_outbox_events', 'next_retry_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_outbox_events', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)

    # ozon_chat_messages table
    op.alter_column('ozon_chat_messages', 'read_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_chat_messages', 'edited_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_chat_messages', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=False)
    op.alter_column('ozon_chat_messages', 'updated_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)

    # ozon_chats table
    op.alter_column('ozon_chats', 'last_message_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_chats', 'closed_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_chats', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=False)
    op.alter_column('ozon_chats', 'updated_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)

    # ozon_product_selection_items table
    op.alter_column('ozon_product_selection_items', 'product_created_date',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_product_selection_items', 'images_updated_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=True)
    op.alter_column('ozon_product_selection_items', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=False)
    op.alter_column('ozon_product_selection_items', 'updated_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=False)

    # ozon_product_selection_import_history table
    op.alter_column('ozon_product_selection_import_history', 'import_time',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=False)
    op.alter_column('ozon_product_selection_import_history', 'created_at',
                   type_=sa.DateTime(),
                   existing_type=sa.DateTime(timezone=True),
                   existing_nullable=False)
