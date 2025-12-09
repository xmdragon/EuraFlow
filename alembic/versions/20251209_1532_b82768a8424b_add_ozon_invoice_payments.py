"""add_ozon_invoice_payments

Revision ID: b82768a8424b
Revises: a38701eceff6
Create Date: 2025-12-09 15:32:31.968729

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'b82768a8424b'
down_revision = 'a38701eceff6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create ozon_invoice_payments table"""
    op.create_table(
        'ozon_invoice_payments',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('payment_type', sa.String(length=100), nullable=False, comment='付款类型'),
        sa.Column('amount_cny', sa.Numeric(precision=18, scale=4), nullable=False, comment='金额(CNY)'),
        sa.Column('payment_status', sa.String(length=50), nullable=False, comment='付款状态: waiting/paid'),
        sa.Column('scheduled_payment_date', sa.Date(), nullable=False, comment='计划付款日期'),
        sa.Column('actual_payment_date', sa.Date(), nullable=True, comment='实际付款日期'),
        sa.Column('period_start', sa.Date(), nullable=False, comment='周期开始日期'),
        sa.Column('period_end', sa.Date(), nullable=False, comment='周期结束日期'),
        sa.Column('payment_method', sa.String(length=100), nullable=True, comment='支付方式'),
        sa.Column('payment_file_number', sa.String(length=100), nullable=True, comment='付款文件编号'),
        sa.Column('period_text', sa.String(length=100), nullable=True, comment='原始周期文本'),
        sa.Column('raw_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='原始数据'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True, comment='记录创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True, comment='记录更新时间'),
        sa.ForeignKeyConstraint(['shop_id'], ['ozon_shops.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('shop_id', 'scheduled_payment_date', 'amount_cny', name='uq_ozon_invoice_payment')
    )
    op.create_index('idx_ozon_invoice_payment_shop_period', 'ozon_invoice_payments', ['shop_id', 'period_start', 'period_end'], unique=False)
    op.create_index(op.f('ix_ozon_invoice_payments_shop_id'), 'ozon_invoice_payments', ['shop_id'], unique=False)


def downgrade() -> None:
    """Drop ozon_invoice_payments table"""
    op.drop_index(op.f('ix_ozon_invoice_payments_shop_id'), table_name='ozon_invoice_payments')
    op.drop_index('idx_ozon_invoice_payment_shop_period', table_name='ozon_invoice_payments')
    op.drop_table('ozon_invoice_payments')
