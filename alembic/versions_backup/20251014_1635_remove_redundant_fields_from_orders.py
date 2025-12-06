"""remove redundant fields from ozon_orders

Revision ID: 20251014_1635_cleanup
Revises: 20251014_0831_exchange
Create Date: 2025-10-14 16:35:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20251014_1635_cleanup'
down_revision = '20251014_0831_exchange'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    删除 ozon_orders 表中的冗余字段

    理由：这些字段已经迁移到 ozon_postings 表（见 236cbc4f0d20 迁移）
    这些字段实际是 posting 维度的数据，不是 order 维度：
    - material_cost: 物料成本与posting_number关联
    - domestic_tracking_number: 国内物流单号与posting关联
    - domestic_tracking_updated_at: 国内物流单号更新时间
    - purchase_price: 进货价格与posting关联
    - purchase_price_updated_at: 进货价格更新时间
    - order_notes: 订单备注与posting关联
    - source_platform: 采集平台与posting关联

    数据已在之前的迁移中复制到 ozon_postings，这些字段已无用处
    """

    # 删除冗余字段
    op.drop_column('ozon_orders', 'source_platform')
    op.drop_column('ozon_orders', 'order_notes')
    op.drop_column('ozon_orders', 'purchase_price_updated_at')
    op.drop_column('ozon_orders', 'purchase_price')
    op.drop_column('ozon_orders', 'domestic_tracking_updated_at')
    op.drop_column('ozon_orders', 'domestic_tracking_number')
    op.drop_column('ozon_orders', 'material_cost')


def downgrade() -> None:
    """
    回滚：恢复被删除的字段

    注意：回滚会重新创建这些字段，但数据已丢失
    实际数据仍在 ozon_postings 表中
    """

    # 恢复字段（按删除的逆序）
    op.add_column('ozon_orders', sa.Column('material_cost', sa.Numeric(18, 2), nullable=True, comment='物料成本（包装、标签等）'))
    op.add_column('ozon_orders', sa.Column('domestic_tracking_number', sa.String(200), nullable=True, comment='国内物流单号'))
    op.add_column('ozon_orders', sa.Column('domestic_tracking_updated_at', postgresql.TIMESTAMP(timezone=True), nullable=True, comment='国内物流单号更新时间'))
    op.add_column('ozon_orders', sa.Column('purchase_price', sa.Numeric(18, 2), nullable=True, comment='进货价格'))
    op.add_column('ozon_orders', sa.Column('purchase_price_updated_at', postgresql.TIMESTAMP(timezone=True), nullable=True, comment='进货价格更新时间'))
    op.add_column('ozon_orders', sa.Column('order_notes', sa.String(1000), nullable=True, comment='订单备注'))
    op.add_column('ozon_orders', sa.Column('source_platform', sa.String(50), nullable=True, comment='采集平台'))
