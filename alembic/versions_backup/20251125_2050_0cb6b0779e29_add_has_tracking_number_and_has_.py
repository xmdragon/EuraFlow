"""add has_tracking_number and has_domestic_tracking to ozon_postings

Revision ID: 0cb6b0779e29
Revises: 4ed4e5fbb633
Create Date: 2025-11-25 20:50:15.082997

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0cb6b0779e29'
down_revision = '4ed4e5fbb633'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """添加 has_tracking_number 和 has_domestic_tracking 字段并回填数据"""
    # 1. 添加字段
    op.add_column('ozon_postings', sa.Column(
        'has_tracking_number',
        sa.Boolean(),
        nullable=False,
        server_default='false',
        comment='是否有追踪号（避免JSONB查询）'
    ))
    op.add_column('ozon_postings', sa.Column(
        'has_domestic_tracking',
        sa.Boolean(),
        nullable=False,
        server_default='false',
        comment='是否有国内单号（避免EXISTS子查询）'
    ))

    # 2. 添加索引（优化查询性能）
    op.create_index(
        'idx_ozon_postings_has_tracking',
        'ozon_postings',
        ['has_tracking_number', 'has_domestic_tracking', 'status', 'operation_status']
    )

    # 3. 回填现有数据
    # has_tracking_number: raw_payload->>'tracking_number' IS NOT NULL AND != ''
    op.execute("""
        UPDATE ozon_postings
        SET has_tracking_number = true
        WHERE raw_payload->>'tracking_number' IS NOT NULL
          AND raw_payload->>'tracking_number' != ''
    """)

    # has_domestic_tracking: EXISTS in ozon_domestic_tracking_numbers
    op.execute("""
        UPDATE ozon_postings p
        SET has_domestic_tracking = true
        WHERE EXISTS (
            SELECT 1 FROM ozon_domestic_tracking_numbers d
            WHERE d.posting_id = p.id
        )
    """)


def downgrade() -> None:
    """移除字段"""
    op.drop_index('idx_ozon_postings_has_tracking', table_name='ozon_postings')
    op.drop_column('ozon_postings', 'has_domestic_tracking')
    op.drop_column('ozon_postings', 'has_tracking_number')
