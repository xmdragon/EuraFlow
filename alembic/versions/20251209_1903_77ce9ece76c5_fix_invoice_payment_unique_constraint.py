"""fix_invoice_payment_unique_constraint

Revision ID: 77ce9ece76c5
Revises: 2d8f3a5c7e91
Create Date: 2025-12-09 19:03:41.820265

修复 invoice_payment 唯一约束：
1. 修正 period_start/period_end（按实际付款日期推算）
2. 删除重复数据（保留最新的）
3. 更换唯一约束为 (shop_id, period_start, period_end, payment_type)
"""
from alembic import op
import sqlalchemy as sa
from datetime import date
from calendar import monthrange


# revision identifiers, used by Alembic.
revision = '77ce9ece76c5'
down_revision = '2d8f3a5c7e91'
branch_labels = None
depends_on = None


def calculate_billing_period_by_payment_date(payment_date: date):
    """
    根据付款日期推算账单周期
    - 付款日在某月 1-15 号 → 对应上月 16-月末的周期
    - 付款日在某月 16-月末 → 对应当月 1-15 号的周期
    """
    if payment_date.day <= 15:
        # 付款日在上半月 → 对应上月下半月周期
        if payment_date.month == 1:
            prev_year = payment_date.year - 1
            prev_month = 12
        else:
            prev_year = payment_date.year
            prev_month = payment_date.month - 1

        period_start = date(prev_year, prev_month, 16)
        _, last_day = monthrange(prev_year, prev_month)
        period_end = date(prev_year, prev_month, last_day)
    else:
        # 付款日在下半月 → 对应当月上半月周期
        period_start = date(payment_date.year, payment_date.month, 1)
        period_end = date(payment_date.year, payment_date.month, 15)

    return period_start, period_end


def upgrade() -> None:
    """Upgrade database schema"""
    conn = op.get_bind()

    # 1. 先修正所有记录的 period_start/period_end
    # 已付款：用实际付款日期
    # 等待付款：用当前日期
    result = conn.execute(sa.text("""
        SELECT id, payment_status, actual_payment_date
        FROM ozon_invoice_payments
    """))
    rows = result.fetchall()

    today = date.today()
    for row in rows:
        record_id = row[0]
        payment_status = row[1]
        actual_payment_date = row[2]

        if payment_status == 'paid' and actual_payment_date:
            period_start, period_end = calculate_billing_period_by_payment_date(actual_payment_date)
        else:
            period_start, period_end = calculate_billing_period_by_payment_date(today)

        conn.execute(sa.text("""
            UPDATE ozon_invoice_payments
            SET period_start = :period_start, period_end = :period_end
            WHERE id = :id
        """), {"id": record_id, "period_start": period_start, "period_end": period_end})

    # 2. 删除重复数据（按 shop_id, period_start, period_end, payment_type 去重，保留 id 最大的）
    conn.execute(sa.text("""
        DELETE FROM ozon_invoice_payments
        WHERE id NOT IN (
            SELECT MAX(id)
            FROM ozon_invoice_payments
            GROUP BY shop_id, period_start, period_end, payment_type
        )
    """))

    # 3. 删除旧的唯一约束
    op.drop_constraint('uq_ozon_invoice_payment', 'ozon_invoice_payments', type_='unique')

    # 4. 添加新的唯一约束
    op.create_unique_constraint(
        'uq_ozon_invoice_payment_period',
        'ozon_invoice_payments',
        ['shop_id', 'period_start', 'period_end', 'payment_type']
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除新约束
    op.drop_constraint('uq_ozon_invoice_payment_period', 'ozon_invoice_payments', type_='unique')

    # 恢复旧约束
    op.create_unique_constraint(
        'uq_ozon_invoice_payment',
        'ozon_invoice_payments',
        ['shop_id', 'scheduled_payment_date', 'amount_cny']
    )
