"""make_old_order_columns_nullable

Revision ID: 6638e9d71116
Revises: e199c93e7d25
Create Date: 2025-10-09 21:15:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '6638e9d71116'
down_revision = 'e199c93e7d25'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema - make old order columns nullable"""

    # 将旧的列改为可空，避免与新模型冲突
    # 这些列在旧的迁移中定义为 NOT NULL，但新模型中已不使用或改名

    # order_number -> 已改为 ozon_order_number (可空)
    op.alter_column('ozon_orders', 'order_number',
                   existing_type=sa.String(100),
                   nullable=True)

    # posting_number -> 已改为使用 order_id 字段存储
    op.alter_column('ozon_orders', 'posting_number',
                   existing_type=sa.String(100),
                   nullable=True)

    # delivery_type -> 已改为 order_type
    op.alter_column('ozon_orders', 'delivery_type',
                   existing_type=sa.String(20),
                   nullable=True)

    # total_price -> 保留但改为可空
    op.alter_column('ozon_orders', 'total_price',
                   existing_type=sa.Numeric(18, 4),
                   nullable=True)

    # status -> 保留但改为可空（防止映射问题）
    op.alter_column('ozon_orders', 'status',
                   existing_type=sa.String(50),
                   nullable=True)

    # sync_status -> 保留但改为可空
    op.alter_column('ozon_orders', 'sync_status',
                   existing_type=sa.String(20),
                   nullable=True)


def downgrade() -> None:
    """Downgrade database schema - restore NOT NULL constraints"""

    # 恢复 NOT NULL 约束（如果需要回滚）
    op.alter_column('ozon_orders', 'sync_status',
                   existing_type=sa.String(20),
                   nullable=False)

    op.alter_column('ozon_orders', 'status',
                   existing_type=sa.String(50),
                   nullable=False)

    op.alter_column('ozon_orders', 'total_price',
                   existing_type=sa.Numeric(18, 4),
                   nullable=False)

    op.alter_column('ozon_orders', 'delivery_type',
                   existing_type=sa.String(20),
                   nullable=False)

    op.alter_column('ozon_orders', 'posting_number',
                   existing_type=sa.String(100),
                   nullable=False)

    op.alter_column('ozon_orders', 'order_number',
                   existing_type=sa.String(100),
                   nullable=False)
