"""add ozon finance transactions tables

添加OZON财务交易数据表：
- ozon_finance_transactions: 财务交易记录（扁平化存储）
- ozon_finance_sync_watermarks: 财务数据同步水位线

Revision ID: fin_trans_001
Revises: ed0f0b69f3ee
Create Date: 2025-10-21 08:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'fin_trans_001'
down_revision = 'ed0f0b69f3ee'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """创建财务交易表"""

    # 创建财务交易记录表
    op.create_table(
        'ozon_finance_transactions',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('operation_id', sa.BigInteger(), nullable=False, comment='OZON操作ID'),
        sa.Column('operation_type', sa.String(length=200), nullable=False, comment='操作类型'),
        sa.Column('operation_type_name', sa.String(length=500), nullable=True, comment='操作类型名称'),
        sa.Column('transaction_type', sa.String(length=50), nullable=False, comment='收费类型: orders/returns/services/compensation/transferDelivery/other'),
        sa.Column('posting_number', sa.String(length=100), nullable=True, comment='发货单号'),
        sa.Column('operation_date', sa.DateTime(timezone=True), nullable=False, comment='操作日期'),
        sa.Column('accruals_for_sale', sa.Numeric(precision=18, scale=4), nullable=True, server_default='0', comment='考虑卖家折扣的商品成本'),
        sa.Column('amount', sa.Numeric(precision=18, scale=4), nullable=True, server_default='0', comment='交易总额'),
        sa.Column('delivery_charge', sa.Numeric(precision=18, scale=4), nullable=True, server_default='0', comment='运费'),
        sa.Column('return_delivery_charge', sa.Numeric(precision=18, scale=4), nullable=True, server_default='0', comment='退货运费'),
        sa.Column('sale_commission', sa.Numeric(precision=18, scale=4), nullable=True, server_default='0', comment='销售佣金或佣金返还'),
        sa.Column('item_sku', sa.String(length=100), nullable=True, comment='商品SKU'),
        sa.Column('item_name', sa.String(length=500), nullable=True, comment='商品名称'),
        sa.Column('item_quantity', sa.Integer(), nullable=True, comment='商品数量'),
        sa.Column('item_price', sa.Numeric(precision=18, scale=4), nullable=True, comment='商品价格'),
        sa.Column('posting_delivery_schema', sa.String(length=200), nullable=True, comment='配送方式'),
        sa.Column('posting_warehouse_name', sa.String(length=200), nullable=True, comment='仓库名称'),
        sa.Column('services_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='附加服务费用列表'),
        sa.Column('raw_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='OZON原始交易数据'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True, comment='记录创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True, comment='记录更新时间'),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['shop_id'], ['ozon_shops.id'], ),
        sa.UniqueConstraint('shop_id', 'operation_id', 'item_sku', name='uq_ozon_finance_transaction')
    )

    # 创建索引
    op.create_index('idx_ozon_finance_shop_date', 'ozon_finance_transactions', ['shop_id', 'operation_date'], unique=False)
    op.create_index('idx_ozon_finance_posting', 'ozon_finance_transactions', ['posting_number'], unique=False)
    op.create_index('idx_ozon_finance_operation', 'ozon_finance_transactions', ['operation_id'], unique=False)
    op.create_index('idx_ozon_finance_type', 'ozon_finance_transactions', ['shop_id', 'transaction_type', 'operation_type'], unique=False)

    # 创建财务同步水位线表
    op.create_table(
        'ozon_finance_sync_watermarks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('last_sync_date', sa.DateTime(timezone=True), nullable=True, comment='最后成功同步的日期（UTC）'),
        sa.Column('sync_status', sa.String(length=20), nullable=True, server_default='idle', comment='同步状态: idle/running/failed'),
        sa.Column('sync_error', sa.Text(), nullable=True, comment='同步错误信息'),
        sa.Column('total_synced_count', sa.Integer(), nullable=True, server_default='0', comment='总同步交易数'),
        sa.Column('last_sync_count', sa.Integer(), nullable=True, server_default='0', comment='最后一次同步的交易数'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['shop_id'], ['ozon_shops.id'], ),
        sa.UniqueConstraint('shop_id')
    )

    # 创建索引
    op.create_index('idx_ozon_finance_watermark_shop', 'ozon_finance_sync_watermarks', ['shop_id'], unique=False)


def downgrade() -> None:
    """删除财务交易表"""

    # 删除水位线表
    op.drop_index('idx_ozon_finance_watermark_shop', table_name='ozon_finance_sync_watermarks')
    op.drop_table('ozon_finance_sync_watermarks')

    # 删除交易记录表
    op.drop_index('idx_ozon_finance_type', table_name='ozon_finance_transactions')
    op.drop_index('idx_ozon_finance_operation', table_name='ozon_finance_transactions')
    op.drop_index('idx_ozon_finance_posting', table_name='ozon_finance_transactions')
    op.drop_index('idx_ozon_finance_shop_date', table_name='ozon_finance_transactions')
    op.drop_table('ozon_finance_transactions')
