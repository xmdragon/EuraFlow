"""add_relist_collection_type

添加 relist（下架重上）类型到 collection_type 检查约束

Revision ID: b5661125f5d9
Revises: 5c953e2b700d
Create Date: 2025-12-10 08:13:24.077311

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'b5661125f5d9'
down_revision = '5c953e2b700d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 删除旧的检查约束
    op.drop_constraint('chk_collection_type', 'ozon_product_collection_records', type_='check')

    # 添加新的检查约束（包含 relist 类型）
    op.create_check_constraint(
        'chk_collection_type',
        'ozon_product_collection_records',
        "collection_type IN ('follow_pdp', 'collect_only', 'relist')"
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除新的检查约束
    op.drop_constraint('chk_collection_type', 'ozon_product_collection_records', type_='check')

    # 恢复旧的检查约束
    op.create_check_constraint(
        'chk_collection_type',
        'ozon_product_collection_records',
        "collection_type IN ('follow_pdp', 'collect_only')"
    )
