"""add_manual_collection_type

添加 manual（手动新建）类型到 collection_type 检查约束

Revision ID: add_manual_type
Revises: b5661125f5d9
Create Date: 2025-12-10 09:15:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'add_manual_type'
down_revision = 'b5661125f5d9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 删除旧的检查约束
    op.drop_constraint('chk_collection_type', 'ozon_product_collection_records', type_='check')

    # 添加新的检查约束（包含 manual 类型）
    op.create_check_constraint(
        'chk_collection_type',
        'ozon_product_collection_records',
        "collection_type IN ('follow_pdp', 'collect_only', 'relist', 'manual')"
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除新的检查约束
    op.drop_constraint('chk_collection_type', 'ozon_product_collection_records', type_='check')

    # 恢复旧的检查约束（不含 manual）
    op.create_check_constraint(
        'chk_collection_type',
        'ozon_product_collection_records',
        "collection_type IN ('follow_pdp', 'collect_only', 'relist')"
    )
