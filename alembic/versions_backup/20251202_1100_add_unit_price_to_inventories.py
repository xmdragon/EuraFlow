"""add unit_price to inventories

Revision ID: b2c3d4e5f6g7
Revises: c5d6e7f8g9h0
Create Date: 2025-12-02 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6g7'
down_revision: Union[str, None] = 'c5d6e7f8g9h0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """添加采购单价字段到库存表"""
    op.add_column(
        'inventories',
        sa.Column('unit_price', sa.Numeric(18, 4), nullable=True, comment='采购单价（每件商品采购价格）')
    )


def downgrade() -> None:
    """移除采购单价字段"""
    op.drop_column('inventories', 'unit_price')
