"""add credit system

Revision ID: add_credit_system
Revises: 829bce7883c0
Create Date: 2025-12-11 17:49:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'add_credit_system'
down_revision: Union[str, None] = '829bce7883c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 创建 credit_accounts 表（额度账户）
    op.create_table(
        'credit_accounts',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False, comment='账户ID'),
        sa.Column('user_id', sa.BigInteger(), nullable=False, comment='账户所属用户ID（manager 或 admin）'),
        sa.Column('balance', sa.Numeric(precision=18, scale=4), nullable=False, server_default='0', comment='当前余额（点数）'),
        sa.Column('total_recharged', sa.Numeric(precision=18, scale=4), nullable=False, server_default='0', comment='累计充值（点数）'),
        sa.Column('total_consumed', sa.Numeric(precision=18, scale=4), nullable=False, server_default='0', comment='累计消费（点数）'),
        sa.Column('low_balance_threshold', sa.Numeric(precision=18, scale=4), nullable=False, server_default='100', comment='余额不足预警阈值'),
        sa.Column('low_balance_alert_muted', sa.Boolean(), nullable=False, server_default='false', comment='是否静默余额不足提醒'),
        sa.Column('version', sa.Integer(), nullable=False, server_default='0', comment='乐观锁版本号'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id')
    )
    op.create_index('idx_credit_accounts_user_id', 'credit_accounts', ['user_id'], unique=False)

    # 2. 创建 credit_transactions 表（交易记录）
    op.create_table(
        'credit_transactions',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False, comment='交易ID'),
        sa.Column('account_id', sa.BigInteger(), nullable=False, comment='额度账户ID'),
        sa.Column('transaction_type', sa.String(length=20), nullable=False, comment='交易类型：recharge/consume/refund/adjust'),
        sa.Column('amount', sa.Numeric(precision=18, scale=4), nullable=False, comment='交易金额（点数，正数增加，负数扣除）'),
        sa.Column('balance_before', sa.Numeric(precision=18, scale=4), nullable=False, comment='交易前余额'),
        sa.Column('balance_after', sa.Numeric(precision=18, scale=4), nullable=False, comment='交易后余额'),
        sa.Column('module', sa.String(length=50), nullable=True, comment='消费模块：print_label 等'),
        sa.Column('operator_user_id', sa.BigInteger(), nullable=False, comment='操作用户ID（实际执行者）'),
        sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}', comment='交易详情（如订单号列表）'),
        sa.Column('payment_method', sa.String(length=20), nullable=True, comment='支付方式：manual/wechat/alipay'),
        sa.Column('payment_amount_cny', sa.Numeric(precision=18, scale=2), nullable=True, comment='实付金额（CNY）'),
        sa.Column('payment_order_no', sa.String(length=64), nullable=True, comment='支付订单号'),
        sa.Column('approved_by', sa.BigInteger(), nullable=True, comment='审批人ID（充值时的管理员）'),
        sa.Column('idempotency_key', sa.String(length=64), nullable=True, comment='幂等键'),
        sa.Column('ip_address', sa.String(length=45), nullable=True, comment='客户端IP'),
        sa.Column('notes', sa.Text(), nullable=True, comment='备注'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.ForeignKeyConstraint(['account_id'], ['credit_accounts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['approved_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['operator_user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('idempotency_key')
    )
    op.create_index('idx_credit_tx_account_time', 'credit_transactions', ['account_id', 'created_at'], unique=False)
    op.create_index('idx_credit_tx_type_time', 'credit_transactions', ['transaction_type', 'created_at'], unique=False)
    op.create_index('idx_credit_tx_module_time', 'credit_transactions', ['module', 'created_at'], unique=False)
    op.create_index('idx_credit_tx_operator', 'credit_transactions', ['operator_user_id', 'created_at'], unique=False)

    # 3. 创建 credit_module_configs 表（模块消费配置）
    op.create_table(
        'credit_module_configs',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False, comment='配置ID'),
        sa.Column('module_key', sa.String(length=50), nullable=False, comment='模块标识'),
        sa.Column('module_name', sa.String(length=100), nullable=False, comment='模块显示名称'),
        sa.Column('cost_per_unit', sa.Numeric(precision=18, scale=4), nullable=False, comment='单次消费点数'),
        sa.Column('unit_description', sa.String(length=50), nullable=False, server_default='次', comment='单位描述（如：个面单、次翻译）'),
        sa.Column('is_enabled', sa.Boolean(), nullable=False, server_default='true', comment='是否启用计费'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('module_key')
    )
    op.create_index('idx_credit_module_configs_key', 'credit_module_configs', ['module_key'], unique=False)

    # 4. 插入初始数据：打印模块配置
    op.execute("""
        INSERT INTO credit_module_configs (module_key, module_name, cost_per_unit, unit_description, is_enabled)
        VALUES ('print_label', '打印快递面单', 1.0000, '个面单', true)
    """)

    # 5. 插入全局配置：系统名称、点数名称和兑换比例
    op.execute("""
        INSERT INTO ozon_global_settings (setting_key, setting_value, description)
        VALUES
            ('system_name', '{"value": "EuraFlow"}'::jsonb, '系统显示名称'),
            ('credit_name', '{"value": "积分"}'::jsonb, '点数显示名称'),
            ('credit_cny_rate', '{"value": "1.0"}'::jsonb, 'CNY 到点数的兑换比例（1 CNY = X 点数）')
        ON CONFLICT (setting_key) DO UPDATE SET
            setting_value = EXCLUDED.setting_value,
            description = EXCLUDED.description,
            updated_at = now()
    """)


def downgrade() -> None:
    # 删除全局配置
    op.execute("""
        DELETE FROM ozon_global_settings
        WHERE setting_key IN ('system_name', 'credit_name', 'credit_cny_rate')
    """)

    # 删除索引和表（按依赖顺序）
    op.drop_index('idx_credit_module_configs_key', table_name='credit_module_configs')
    op.drop_table('credit_module_configs')

    op.drop_index('idx_credit_tx_operator', table_name='credit_transactions')
    op.drop_index('idx_credit_tx_module_time', table_name='credit_transactions')
    op.drop_index('idx_credit_tx_type_time', table_name='credit_transactions')
    op.drop_index('idx_credit_tx_account_time', table_name='credit_transactions')
    op.drop_table('credit_transactions')

    op.drop_index('idx_credit_accounts_user_id', table_name='credit_accounts')
    op.drop_table('credit_accounts')
