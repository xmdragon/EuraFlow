"""rename_item_sku_to_ozon_sku_in_finance

Revision ID: 73a29e73b774
Revises: 1560ebc0f694
Create Date: 2025-10-25 10:33:23.547288

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '73a29e73b774'
down_revision = '1560ebc0f694'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema - Rename item_sku to ozon_sku for consistency"""
    # 1. Drop old unique constraint
    op.drop_constraint('uq_ozon_finance_transaction', 'ozon_finance_transactions', type_='unique')

    # 2. Rename column
    op.alter_column('ozon_finance_transactions', 'item_sku', new_column_name='ozon_sku')

    # 3. Create new unique constraint with renamed column
    op.create_unique_constraint(
        'uq_ozon_finance_transaction',
        'ozon_finance_transactions',
        ['shop_id', 'operation_id', 'ozon_sku']
    )


def downgrade() -> None:
    """Downgrade database schema - Restore item_sku column name"""
    # 1. Drop new unique constraint
    op.drop_constraint('uq_ozon_finance_transaction', 'ozon_finance_transactions', type_='unique')

    # 2. Rename column back
    op.alter_column('ozon_finance_transactions', 'ozon_sku', new_column_name='item_sku')

    # 3. Restore old unique constraint
    op.create_unique_constraint(
        'uq_ozon_finance_transaction',
        'ozon_finance_transactions',
        ['shop_id', 'operation_id', 'item_sku']
    )