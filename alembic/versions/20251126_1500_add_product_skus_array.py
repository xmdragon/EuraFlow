"""add product_skus array to ozon_postings

Revision ID: add_product_skus_001
Revises: f1527db524c9
Create Date: 2025-11-26 15:00:00.000000

添加 product_skus 数组列，用于优化 SKU 搜索性能：
- 使用 TEXT[] 数组存储 posting 关联的所有 SKU
- 使用 GIN 索引支持高效的数组包含查询
- 从 raw_payload.products 迁移现有数据
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'add_product_skus_001'
down_revision: Union[str, None] = 'f1527db524c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 添加 product_skus 列
    op.add_column(
        'ozon_postings',
        sa.Column(
            'product_skus',
            postgresql.ARRAY(sa.String()),
            nullable=True,
            comment='商品SKU数组（反范式化，优化SKU搜索性能，使用GIN索引）'
        )
    )

    # 2. 创建 GIN 索引
    op.create_index(
        'idx_ozon_postings_product_skus_gin',
        'ozon_postings',
        ['product_skus'],
        postgresql_using='gin'
    )

    # 3. 从 raw_payload.products 迁移现有数据
    # 注意：如果数据量大，此更新可能需要较长时间
    # 新同步的订单会自动填充 product_skus 字段
    op.execute("""
        UPDATE ozon_postings
        SET product_skus = (
            SELECT array_agg(DISTINCT (elem->>'sku')::text)
            FROM jsonb_array_elements(raw_payload->'products') AS elem
            WHERE elem->>'sku' IS NOT NULL
        )
        WHERE raw_payload IS NOT NULL
        AND raw_payload->'products' IS NOT NULL
        AND jsonb_typeof(raw_payload->'products') = 'array'
    """)


def downgrade() -> None:
    # 删除索引
    op.drop_index('idx_ozon_postings_product_skus_gin', table_name='ozon_postings')

    # 删除列
    op.drop_column('ozon_postings', 'product_skus')
