"""add_ozon_chat_tables

Revision ID: cae89191f288
Revises: d7cdcefb56b3
Create Date: 2025-10-09 10:47:09.578951

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'cae89191f288'
down_revision = 'd7cdcefb56b3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 创建聊天会话表
    op.create_table(
        'ozon_chats',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('chat_id', sa.String(length=100), nullable=False),
        sa.Column('chat_type', sa.String(length=50), nullable=True),
        sa.Column('subject', sa.String(length=500), nullable=True),
        sa.Column('customer_id', sa.String(length=100), nullable=True),
        sa.Column('customer_name', sa.String(length=200), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('is_closed', sa.Boolean(), nullable=True),
        sa.Column('order_number', sa.String(length=100), nullable=True),
        sa.Column('product_id', sa.BigInteger(), nullable=True),
        sa.Column('message_count', sa.Integer(), nullable=True),
        sa.Column('unread_count', sa.Integer(), nullable=True),
        sa.Column('last_message_at', sa.DateTime(), nullable=True),
        sa.Column('last_message_preview', sa.String(length=500), nullable=True),
        sa.Column('metadata', sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('closed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('chat_id')
    )
    op.create_index('idx_ozon_chat_shop_status', 'ozon_chats', ['shop_id', 'status', 'last_message_at'])
    op.create_index('idx_ozon_chat_order', 'ozon_chats', ['order_number'])
    op.create_index(op.f('ix_ozon_chats_shop_id'), 'ozon_chats', ['shop_id'])

    # 创建聊天消息表
    op.create_table(
        'ozon_chat_messages',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('chat_id', sa.String(length=100), nullable=False),
        sa.Column('message_id', sa.String(length=100), nullable=False),
        sa.Column('message_type', sa.String(length=50), nullable=True),
        sa.Column('sender_type', sa.String(length=50), nullable=False),
        sa.Column('sender_id', sa.String(length=100), nullable=True),
        sa.Column('sender_name', sa.String(length=200), nullable=True),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('content_data', sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('is_read', sa.Boolean(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=True),
        sa.Column('is_edited', sa.Boolean(), nullable=True),
        sa.Column('order_number', sa.String(length=100), nullable=True),
        sa.Column('product_id', sa.BigInteger(), nullable=True),
        sa.Column('metadata', sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('read_at', sa.DateTime(), nullable=True),
        sa.Column('edited_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('message_id')
    )
    op.create_index('idx_ozon_chat_shop_chat', 'ozon_chat_messages', ['shop_id', 'chat_id', 'created_at'])
    op.create_index('idx_ozon_chat_unread', 'ozon_chat_messages', ['shop_id', 'is_read', 'created_at'])
    op.create_index(op.f('ix_ozon_chat_messages_shop_id'), 'ozon_chat_messages', ['shop_id'])
    op.create_index(op.f('ix_ozon_chat_messages_chat_id'), 'ozon_chat_messages', ['chat_id'])


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除消息表
    op.drop_index(op.f('ix_ozon_chat_messages_chat_id'), table_name='ozon_chat_messages')
    op.drop_index(op.f('ix_ozon_chat_messages_shop_id'), table_name='ozon_chat_messages')
    op.drop_index('idx_ozon_chat_unread', table_name='ozon_chat_messages')
    op.drop_index('idx_ozon_chat_shop_chat', table_name='ozon_chat_messages')
    op.drop_table('ozon_chat_messages')

    # 删除会话表
    op.drop_index(op.f('ix_ozon_chats_shop_id'), table_name='ozon_chats')
    op.drop_index('idx_ozon_chat_order', table_name='ozon_chats')
    op.drop_index('idx_ozon_chat_shop_status', table_name='ozon_chats')
    op.drop_table('ozon_chats')