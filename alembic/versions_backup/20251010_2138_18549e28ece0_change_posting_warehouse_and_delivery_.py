"""change_posting_warehouse_and_delivery_ids_to_bigint

Revision ID: 18549e28ece0
Revises: 6638e9d71116
Create Date: 2025-10-10 21:38:52.046285

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '18549e28ece0'
down_revision = '6638e9d71116'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 修改 ozon_postings 表的字段类型，从 Integer 改为 BigInteger
    op.alter_column('ozon_postings', 'warehouse_id',
               existing_type=sa.INTEGER(),
               type_=sa.BigInteger(),
               existing_nullable=True)

    op.alter_column('ozon_postings', 'delivery_method_id',
               existing_type=sa.INTEGER(),
               type_=sa.BigInteger(),
               existing_nullable=True)


def downgrade() -> None:
    """Downgrade database schema"""
    # 回滚时改回 Integer 类型（注意：可能会导致数据丢失）
    op.alter_column('ozon_postings', 'warehouse_id',
               existing_type=sa.BigInteger(),
               type_=sa.INTEGER(),
               existing_nullable=True)

    op.alter_column('ozon_postings', 'delivery_method_id',
               existing_type=sa.BigInteger(),
               type_=sa.INTEGER(),
               existing_nullable=True)