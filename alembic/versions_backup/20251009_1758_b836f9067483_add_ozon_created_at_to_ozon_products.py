"""add_ozon_created_at_to_ozon_products

Revision ID: b836f9067483
Revises: 7998fa3aaf46
Create Date: 2025-10-09 17:58:02.970889

⚠️ 注意：本迁移是碎片化迁移的一部分
建议：未来对同一张表的多个字段修改应合并为一个迁移

相关碎片化迁移（都修改 ozon_products 表）：
- 97f3b8a541f8: 添加 currency_code 字段
- 7998fa3aaf46: 添加 raw_payload 字段
- b836f9067483: 添加 ozon_created_at 字段（本迁移）
- 2deb27629242: 添加其他缺失字段

建议合并为：add_multiple_fields_to_ozon_products
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b836f9067483'
down_revision = '7998fa3aaf46'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    op.add_column('ozon_products',
                  sa.Column('ozon_created_at',
                           sa.DateTime(),
                           nullable=True,
                           comment='OZON平台创建时间'))


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_column('ozon_products', 'ozon_created_at')