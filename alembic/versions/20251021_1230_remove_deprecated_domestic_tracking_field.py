"""remove deprecated domestic_tracking_number field

删除废弃的 domestic_tracking_number 和 domestic_tracking_updated_at 字段
现在统一使用 ozon_domestic_tracking_numbers 关联表

Revision ID: remove_deprecated_001
Revises: domestic_tracking_001
Create Date: 2025-10-21 12:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'remove_deprecated_001'
down_revision = 'domestic_tracking_001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """删除废弃字段"""

    # 删除废弃的国内单号字段
    op.drop_column('ozon_postings', 'domestic_tracking_number')
    op.drop_column('ozon_postings', 'domestic_tracking_updated_at')

    print("✅ 已删除废弃字段：domestic_tracking_number、domestic_tracking_updated_at")


def downgrade() -> None:
    """恢复废弃字段（用于回滚）"""

    # 恢复字段
    op.add_column(
        'ozon_postings',
        sa.Column('domestic_tracking_number', sa.String(length=200), nullable=True, comment='国内物流单号')
    )
    op.add_column(
        'ozon_postings',
        sa.Column('domestic_tracking_updated_at', sa.DateTime(timezone=True), nullable=True, comment='国内物流单号更新时间')
    )

    # 从关联表恢复数据到原字段（取第一个单号）
    op.execute("""
        UPDATE ozon_postings
        SET domestic_tracking_number = subquery.tracking_number,
            domestic_tracking_updated_at = subquery.created_at
        FROM (
            SELECT DISTINCT ON (posting_id)
                posting_id,
                tracking_number,
                created_at
            FROM ozon_domestic_tracking_numbers
            ORDER BY posting_id, created_at ASC
        ) AS subquery
        WHERE ozon_postings.id = subquery.posting_id
    """)

    print("✅ 已恢复废弃字段并迁移数据")
