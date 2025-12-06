"""create_user_settings_table

Revision ID: daa19950a0ed
Revises: c03c560d6cfd
Create Date: 2025-10-11 14:19:49.913909

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'daa19950a0ed'
down_revision = 'c03c560d6cfd'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create user_settings table"""
    op.create_table('user_settings',
    sa.Column('id', sa.BigInteger(), nullable=False, comment='设置ID'),
    sa.Column('user_id', sa.BigInteger(), nullable=False, comment='用户ID'),
    sa.Column('notifications_email', sa.Boolean(), nullable=False, comment='邮件通知'),
    sa.Column('notifications_browser', sa.Boolean(), nullable=False, comment='浏览器通知'),
    sa.Column('notifications_order_updates', sa.Boolean(), nullable=False, comment='订单更新通知'),
    sa.Column('notifications_price_alerts', sa.Boolean(), nullable=False, comment='价格预警通知'),
    sa.Column('notifications_inventory_alerts', sa.Boolean(), nullable=False, comment='库存预警通知'),
    sa.Column('display_language', sa.String(length=10), nullable=False, comment='界面语言'),
    sa.Column('display_timezone', sa.String(length=50), nullable=False, comment='时区'),
    sa.Column('display_currency', sa.String(length=3), nullable=False, comment='默认货币：RUB/CNY/USD/EUR'),
    sa.Column('display_date_format', sa.String(length=20), nullable=False, comment='日期格式'),
    sa.Column('sync_auto_sync', sa.Boolean(), nullable=False, comment='自动同步'),
    sa.Column('sync_interval', sa.Integer(), nullable=False, comment='同步间隔（分钟）'),
    sa.Column('sync_on_login', sa.Boolean(), nullable=False, comment='登录时同步'),
    sa.Column('security_two_factor_auth', sa.Boolean(), nullable=False, comment='双因素认证'),
    sa.Column('security_session_timeout', sa.Integer(), nullable=False, comment='会话超时（分钟）'),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id')
    )
    op.create_index('ix_user_settings_user_id', 'user_settings', ['user_id'], unique=False)


def downgrade() -> None:
    """Drop user_settings table"""
    op.drop_index('ix_user_settings_user_id', table_name='user_settings')
    op.drop_table('user_settings')
