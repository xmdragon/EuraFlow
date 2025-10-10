"""add_raw_payload_to_ozon_products

Revision ID: 7998fa3aaf46
Revises: 97f3b8a541f8
Create Date: 2025-10-09 17:44:54.149740

⚠️ 注意：本迁移是碎片化迁移的一部分
建议：未来对同一张表的多个字段修改应合并为一个迁移

相关碎片化迁移（都修改 ozon_products 表）：
- 97f3b8a541f8: 添加 currency_code 字段
- 7998fa3aaf46: 添加 raw_payload 字段（本迁移）
- b836f9067483: 添加 ozon_created_at 字段
- 2deb27629242: 添加其他缺失字段

建议合并为：add_multiple_fields_to_ozon_products
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7998fa3aaf46'
down_revision = '97f3b8a541f8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    from sqlalchemy.dialects.postgresql import JSONB
    op.add_column('ozon_products',
                  sa.Column('raw_payload',
                           JSONB,
                           nullable=True,
                           comment='Ozon原始数据'))


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_products', 'raw_payload')