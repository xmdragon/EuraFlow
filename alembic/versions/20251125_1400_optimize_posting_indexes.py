"""优化订单查询性能：添加复合索引和反范式化字段

Revision ID: a7f2c8d91e34
Revises: e9b49553b751
Create Date: 2025-11-25 14:00:00

优化内容：
1. OzonPosting 新增3个复合索引（优化JOIN/范围/统计查询）
2. OzonOrder 新增1个覆盖索引（避免回表）
3. OzonPosting 新增 order_total_price 字段（避免JSONB运行时计算）
4. 填充历史数据（使用JSONB函数提取products金额）
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "a7f2c8d91e34"
down_revision = "e9b49553b751"
branch_labels = None
depends_on = None


def upgrade():
    # 1. 添加 OzonPosting 复合索引（优化JOIN查询）
    op.create_index(
        "idx_ozon_postings_order_join",
        "ozon_postings",
        ["order_id", "in_process_at", "status", "shop_id"],
        unique=False,
    )

    # 2. 添加 OzonPosting 部分索引（优化in_process_at范围查询）
    op.create_index(
        "idx_ozon_postings_in_process",
        "ozon_postings",
        ["shop_id", "in_process_at", "status"],
        unique=False,
        postgresql_where=sa.text("in_process_at IS NOT NULL"),
    )

    # 3. 添加 OzonPosting 状态+时间索引（优化统计查询）
    op.create_index(
        "idx_ozon_postings_status_time",
        "ozon_postings",
        ["status", "in_process_at", "shop_id"],
        unique=False,
    )

    # 4. 添加 OzonOrder 覆盖索引（避免回表）
    op.create_index(
        "idx_ozon_orders_join_cover",
        "ozon_orders",
        ["id", "shop_id", "ordered_at", "total_price"],
        unique=False,
    )

    # 5. 添加 order_total_price 字段
    op.add_column(
        "ozon_postings",
        sa.Column(
            "order_total_price",
            sa.Numeric(precision=18, scale=2),
            nullable=True,
            comment="订单总金额（从raw_payload.products计算，避免运行时JSONB解析）",
        ),
    )

    # 6. 填充历史数据：从 raw_payload.products 计算总金额
    # 使用 PostgreSQL JSONB 函数提取价格并求和
    op.execute("""
        UPDATE ozon_postings
        SET order_total_price = (
            SELECT COALESCE(SUM(
                (elem->>'price')::NUMERIC * COALESCE((elem->>'quantity')::INTEGER, 1)
            ), 0)
            FROM jsonb_array_elements(raw_payload->'products') AS elem
        )
        WHERE raw_payload IS NOT NULL
          AND raw_payload->'products' IS NOT NULL
          AND jsonb_typeof(raw_payload->'products') = 'array'
    """)

    # 7. 为 order_total_price 创建索引（支持金额范围查询）
    op.create_index(
        "idx_ozon_postings_total_price",
        "ozon_postings",
        ["shop_id", "order_total_price"],
        unique=False,
        postgresql_where=sa.text("order_total_price IS NOT NULL"),
    )


def downgrade():
    # 移除索引
    op.drop_index("idx_ozon_postings_total_price", table_name="ozon_postings")
    op.drop_index("idx_ozon_orders_join_cover", table_name="ozon_orders")
    op.drop_index("idx_ozon_postings_status_time", table_name="ozon_postings")
    op.drop_index("idx_ozon_postings_in_process", table_name="ozon_postings")
    op.drop_index("idx_ozon_postings_order_join", table_name="ozon_postings")

    # 移除字段
    op.drop_column("ozon_postings", "order_total_price")
