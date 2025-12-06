"""add has_purchase_info to ozon_postings

Revision ID: 9cfcd92d4710
Revises: add_product_skus_001
Create Date: 2025-11-26 14:27:37.043385

添加 has_purchase_info 反范式化字段：
- 标记 posting 中的所有商品是否都有采购信息（purchase_url）
- 避免复杂的 jsonb_array_elements + NOT EXISTS 子查询
- 显著提升"待采购订单统计"查询性能（297-351ms → <10ms）
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9cfcd92d4710'
down_revision: Union[str, None] = 'add_product_skus_001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 添加 has_purchase_info 列（默认 False）
    op.add_column(
        'ozon_postings',
        sa.Column(
            'has_purchase_info',
            sa.Boolean(),
            nullable=False,
            server_default='false',
            comment='是否所有商品都有采购信息（避免jsonb_array_elements子查询）'
        )
    )

    # 2. 创建索引（用于快速筛选）
    op.create_index(
        'idx_ozon_postings_has_purchase_info',
        'ozon_postings',
        ['has_purchase_info']
    )

    # 3. 初始化现有数据
    # 逻辑：如果 posting 中的所有 SKU 都在 ozon_products 中有 purchase_url，则为 True
    # 使用 product_skus 数组（已在上一个迁移中填充）进行高效查询
    # 注意：product_skus 存储的是 ozon_sku（字符串格式），需要与 ozon_products.ozon_sku 比较
    op.execute("""
        WITH posting_purchase_status AS (
            SELECT
                p.id,
                CASE
                    WHEN p.product_skus IS NULL OR array_length(p.product_skus, 1) IS NULL THEN false
                    WHEN NOT EXISTS (
                        SELECT 1
                        FROM unnest(p.product_skus) AS posting_sku
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM ozon_products prod
                            WHERE prod.ozon_sku = posting_sku::bigint
                            AND prod.shop_id = p.shop_id
                            AND prod.purchase_url IS NOT NULL
                            AND prod.purchase_url != ''
                        )
                    ) THEN true
                    ELSE false
                END AS has_info
            FROM ozon_postings p
        )
        UPDATE ozon_postings
        SET has_purchase_info = posting_purchase_status.has_info
        FROM posting_purchase_status
        WHERE ozon_postings.id = posting_purchase_status.id
    """)


def downgrade() -> None:
    # 删除索引
    op.drop_index('idx_ozon_postings_has_purchase_info', table_name='ozon_postings')

    # 删除列
    op.drop_column('ozon_postings', 'has_purchase_info')
