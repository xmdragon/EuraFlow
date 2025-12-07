"""drop_ozon_orders_table

移除 OzonOrder 表及相关依赖：
- 移除 ozon_postings.order_id 外键和列
- 移除 ozon_cancellations.order_id 外键（改用 posting_id）
- 移除 ozon_returns.order_id 外键（改用 posting_id）
- 移除 ozon_refunds.order_id 外键（改用 posting_id）
- 移除 kuajing84_sync_logs.ozon_order_id 外键和列
- 删除 ozon_order_items 表
- 删除 ozon_orders 表

Revision ID: e2eda785556e
Revises: add_composite_idx
Create Date: 2025-12-07 13:13:44.552890

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e2eda785556e'
down_revision = 'add_composite_idx'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """移除 OzonOrder 表及所有依赖"""

    # 1. 移除 ozon_postings.order_id 外键和列
    op.execute("ALTER TABLE ozon_postings DROP CONSTRAINT IF EXISTS ozon_postings_order_id_fkey")
    op.execute("ALTER TABLE ozon_postings DROP COLUMN IF EXISTS order_id")

    # 2. 移除 ozon_cancellations.order_id 外键（表仍保留，通过 posting_number 关联）
    op.execute("ALTER TABLE ozon_cancellations DROP CONSTRAINT IF EXISTS ozon_cancellations_order_id_fkey")
    op.execute("ALTER TABLE ozon_cancellations DROP COLUMN IF EXISTS order_id")

    # 3. 移除 ozon_returns.order_id 外键
    op.execute("ALTER TABLE ozon_returns DROP CONSTRAINT IF EXISTS ozon_returns_order_id_fkey")
    op.execute("ALTER TABLE ozon_returns DROP COLUMN IF EXISTS order_id")

    # 4. 移除 ozon_refunds.order_id 外键
    op.execute("ALTER TABLE ozon_refunds DROP CONSTRAINT IF EXISTS ozon_refunds_order_id_fkey")
    op.execute("ALTER TABLE ozon_refunds DROP COLUMN IF EXISTS order_id")

    # 5. 移除 kuajing84_sync_logs.ozon_order_id 外键和列
    op.execute("ALTER TABLE kuajing84_sync_logs DROP CONSTRAINT IF EXISTS kuajing84_sync_logs_ozon_order_id_fkey")
    op.execute("ALTER TABLE kuajing84_sync_logs DROP COLUMN IF EXISTS ozon_order_id")

    # 6. 删除 ozon_order_items 表（商品信息现在在 OzonPosting.raw_payload.products 中）
    op.execute("DROP TABLE IF EXISTS ozon_order_items CASCADE")

    # 7. 删除 ozon_orders 表
    op.execute("DROP TABLE IF EXISTS ozon_orders CASCADE")

    # 8. 删除 ozon_orders 序列
    op.execute("DROP SEQUENCE IF EXISTS ozon_orders_id_seq CASCADE")
    op.execute("DROP SEQUENCE IF EXISTS ozon_order_items_id_seq CASCADE")


def downgrade() -> None:
    """
    重建 OzonOrder 相关表结构

    注意：此降级只恢复表结构，不恢复数据。
    生产环境执行降级前必须有完整的数据备份。
    """
    # 1. 创建 ozon_orders 序列
    op.execute("""
        CREATE SEQUENCE IF NOT EXISTS ozon_orders_id_seq
        INCREMENT 1 START 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1
    """)

    # 2. 创建 ozon_orders 表
    op.execute("""
        CREATE TABLE ozon_orders (
            id BIGINT NOT NULL DEFAULT nextval('ozon_orders_id_seq'::regclass),
            shop_id INTEGER NOT NULL,
            order_id VARCHAR(100) NOT NULL,
            order_number VARCHAR(100),
            ozon_order_id VARCHAR(100),
            ozon_order_number VARCHAR(100),
            posting_number VARCHAR(100),
            status VARCHAR(50) NOT NULL,
            substatus VARCHAR(100),
            total_price NUMERIC(18, 2),
            currency VARCHAR(10),
            ordered_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            CONSTRAINT ozon_orders_pkey PRIMARY KEY (id),
            CONSTRAINT ozon_orders_order_id_key UNIQUE (order_id)
        )
    """)

    # 3. 添加 ozon_postings.order_id 列
    op.execute("""
        ALTER TABLE ozon_postings
        ADD COLUMN IF NOT EXISTS order_id BIGINT
    """)

    # 4. 创建外键
    op.execute("""
        ALTER TABLE ozon_postings
        ADD CONSTRAINT ozon_postings_order_id_fkey
        FOREIGN KEY (order_id) REFERENCES ozon_orders(id)
    """)

    # 5. 重建 ozon_order_items 表
    op.execute("""
        CREATE SEQUENCE IF NOT EXISTS ozon_order_items_id_seq
        INCREMENT 1 START 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1
    """)

    op.execute("""
        CREATE TABLE ozon_order_items (
            id BIGINT NOT NULL DEFAULT nextval('ozon_order_items_id_seq'::regclass),
            order_id BIGINT NOT NULL,
            sku VARCHAR(100),
            name VARCHAR(500),
            quantity INTEGER,
            price NUMERIC(18, 2),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            CONSTRAINT ozon_order_items_pkey PRIMARY KEY (id),
            CONSTRAINT ozon_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES ozon_orders(id)
        )
    """)