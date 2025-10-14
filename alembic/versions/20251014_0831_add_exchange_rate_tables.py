"""add exchange rate tables

Revision ID: 20251014_0831_exchange
Revises: 20251013_2127_236cbc4f0d20
Create Date: 2025-10-14 08:31:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20251014_0831_exchange'
down_revision = '236cbc4f0d20'
branch_labels = None
depends_on = None


def upgrade():
    # 创建 exchange_rate_config 表
    op.create_table(
        'exchange_rate_config',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('api_key', sa.String(length=200), nullable=False, comment='API密钥（加密存储）'),
        sa.Column('api_provider', sa.String(length=50), nullable=False, server_default='exchangerate-api', comment='服务商'),
        sa.Column('is_enabled', sa.Boolean(), nullable=False, server_default='true', comment='是否启用'),
        sa.Column('base_currency', sa.String(length=3), nullable=False, server_default='CNY', comment='基准货币'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), comment='更新时间'),
        sa.PrimaryKeyConstraint('id')
    )

    # 创建 exchange_rates 表
    op.create_table(
        'exchange_rates',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('from_currency', sa.String(length=3), nullable=False, comment='源货币'),
        sa.Column('to_currency', sa.String(length=3), nullable=False, comment='目标货币'),
        sa.Column('rate', sa.Numeric(precision=18, scale=6), nullable=False, comment='汇率（6位小数精度）'),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False, comment='获取时间（UTC）'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False, comment='过期时间（24小时后）'),
        sa.Column('source', sa.String(length=50), nullable=False, server_default='exchangerate-api', comment='数据来源'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), comment='更新时间'),
        sa.PrimaryKeyConstraint('id')
    )

    # 创建索引
    op.create_index('idx_exchange_rates_currency_time', 'exchange_rates', ['from_currency', 'to_currency', 'fetched_at'])
    op.create_index(op.f('ix_exchange_rates_from_currency'), 'exchange_rates', ['from_currency'])
    op.create_index(op.f('ix_exchange_rates_to_currency'), 'exchange_rates', ['to_currency'])
    op.create_index(op.f('ix_exchange_rates_fetched_at'), 'exchange_rates', ['fetched_at'])


def downgrade():
    # 删除索引
    op.drop_index(op.f('ix_exchange_rates_fetched_at'), table_name='exchange_rates')
    op.drop_index(op.f('ix_exchange_rates_to_currency'), table_name='exchange_rates')
    op.drop_index(op.f('ix_exchange_rates_from_currency'), table_name='exchange_rates')
    op.drop_index('idx_exchange_rates_currency_time', table_name='exchange_rates')

    # 删除表
    op.drop_table('exchange_rates')
    op.drop_table('exchange_rate_config')
