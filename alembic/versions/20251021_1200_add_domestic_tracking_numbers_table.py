"""add domestic tracking numbers table

添加国内物流单号表,支持一对多关系:
- ozon_domestic_tracking_numbers: 国内物流单号表（一个posting对应多个国内单号）

Revision ID: domestic_tracking_001
Revises: fin_trans_001
Create Date: 2025-10-21 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'domestic_tracking_001'
down_revision = 'fin_trans_001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """创建国内物流单号表"""

    # 创建国内物流单号表
    op.create_table(
        'ozon_domestic_tracking_numbers',
        sa.Column('id', sa.BigInteger(), nullable=False, comment='主键'),
        sa.Column('posting_id', sa.BigInteger(), nullable=False, comment='发货单ID'),
        sa.Column('tracking_number', sa.String(length=200), nullable=False, comment='国内物流单号'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True, comment='创建时间'),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['posting_id'],
            ['ozon_postings.id'],
            ondelete='CASCADE'  # 级联删除
        ),
        sa.UniqueConstraint(
            'posting_id',
            'tracking_number',
            name='uq_posting_tracking'
        )
    )

    # 创建索引
    # 索引1：反查优化（从单号查posting）
    op.create_index(
        'idx_domestic_tracking_number',
        'ozon_domestic_tracking_numbers',
        ['tracking_number'],
        unique=False
    )

    # 索引2：正查优化（从posting查所有单号）
    op.create_index(
        'idx_domestic_posting_id',
        'ozon_domestic_tracking_numbers',
        ['posting_id'],
        unique=False
    )

    # 数据迁移：将现有 domestic_tracking_number 迁移到新表
    op.execute("""
        INSERT INTO ozon_domestic_tracking_numbers (posting_id, tracking_number, created_at)
        SELECT
            id as posting_id,
            domestic_tracking_number,
            COALESCE(domestic_tracking_updated_at, created_at) as created_at
        FROM ozon_postings
        WHERE domestic_tracking_number IS NOT NULL
          AND domestic_tracking_number != ''
    """)

    # 验证数据迁移（输出到日志）
    # 注意：这只是记录，不会影响迁移成功/失败
    print("📊 数据迁移统计:")
    print("  - 已迁移国内单号数量:", end=" ")
    result = op.get_bind().execute(
        sa.text("SELECT COUNT(*) FROM ozon_domestic_tracking_numbers")
    )
    count = result.scalar()
    print(f"{count}")

    # 更新OzonPosting的comment标记字段为废弃
    op.alter_column(
        'ozon_postings',
        'domestic_tracking_number',
        existing_type=sa.String(length=200),
        comment='[已废弃] 请使用 domestic_trackings 关系',
        existing_nullable=True
    )


def downgrade() -> None:
    """删除国内物流单号表"""

    # 恢复原字段comment
    op.alter_column(
        'ozon_postings',
        'domestic_tracking_number',
        existing_type=sa.String(length=200),
        comment='国内物流单号',
        existing_nullable=True
    )

    # 删除索引
    op.drop_index('idx_domestic_posting_id', table_name='ozon_domestic_tracking_numbers')
    op.drop_index('idx_domestic_tracking_number', table_name='ozon_domestic_tracking_numbers')

    # 删除表
    op.drop_table('ozon_domestic_tracking_numbers')
