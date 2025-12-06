"""add_performance_indexes_for_webhook

优化 webhook 处理性能的索引：
1. ozon_shops(client_id, status) - webhook 通过 client_id 查找店铺
2. ozon_postings(shop_id, posting_number) - webhook 更新 posting 状态

Revision ID: 968cf9d4ad77
Revises: d877a4e87a11
Create Date: 2025-11-27 07:46:28.039141

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '968cf9d4ad77'
down_revision = 'd877a4e87a11'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """添加性能优化索引"""
    # ozon_shops: webhook 通过 client_id + status 查找店铺
    # 原来只有 status 单列索引，添加复合索引
    op.create_index(
        'idx_ozon_shops_client_status',
        'ozon_shops',
        ['client_id', 'status'],
        unique=False
    )

    # ozon_postings: webhook 通过 shop_id + posting_number 查找 posting
    # posting_number 已有唯一索引，添加 shop_id 前缀的复合索引加速查询
    op.create_index(
        'idx_ozon_postings_shop_posting',
        'ozon_postings',
        ['shop_id', 'posting_number'],
        unique=False  # 不设唯一，因为 posting_number 本身已是唯一的
    )


def downgrade() -> None:
    """删除索引"""
    op.drop_index('idx_ozon_postings_shop_posting', table_name='ozon_postings')
    op.drop_index('idx_ozon_shops_client_status', table_name='ozon_shops')