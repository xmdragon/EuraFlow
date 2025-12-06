"""move_fields_to_posting_dimension

Revision ID: 236cbc4f0d20
Revises: ed7a29b32ac4
Create Date: 2025-10-13 21:27:04.053139

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '236cbc4f0d20'
down_revision = 'ed7a29b32ac4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    将订单相关字段从 ozon_orders 迁移到 ozon_postings

    理由：这些字段实际是 posting 维度的数据，不是 order 维度
    - material_cost: 物料成本与posting_number关联
    - domestic_tracking_number: 国内物流单号与posting关联
    - purchase_price: 进货价格与posting关联
    - order_notes: 订单备注与posting关联
    - source_platform: 采集平台与posting关联
    """

    # 1. 添加字段到 ozon_postings 表
    op.add_column('ozon_postings', sa.Column('material_cost', sa.Numeric(18, 2), nullable=True, comment='物料成本（包装、标签等）'))
    op.add_column('ozon_postings', sa.Column('domestic_tracking_number', sa.String(200), nullable=True, comment='国内物流单号'))
    op.add_column('ozon_postings', sa.Column('domestic_tracking_updated_at', sa.DateTime(timezone=True), nullable=True, comment='国内物流单号更新时间'))
    op.add_column('ozon_postings', sa.Column('purchase_price', sa.Numeric(18, 2), nullable=True, comment='进货价格'))
    op.add_column('ozon_postings', sa.Column('purchase_price_updated_at', sa.DateTime(timezone=True), nullable=True, comment='进货价格更新时间'))
    op.add_column('ozon_postings', sa.Column('order_notes', sa.String(1000), nullable=True, comment='订单备注'))
    op.add_column('ozon_postings', sa.Column('source_platform', sa.String(50), nullable=True, comment='采集平台'))

    # 2. 迁移现有数据：将 ozon_orders 中的数据复制到对应的 ozon_postings
    # 注意：一个order可能有多个posting，需要将order级别的数据复制到每个posting
    op.execute("""
        UPDATE ozon_postings AS p
        SET
            material_cost = o.material_cost,
            domestic_tracking_number = o.domestic_tracking_number,
            domestic_tracking_updated_at = o.domestic_tracking_updated_at,
            purchase_price = o.purchase_price,
            purchase_price_updated_at = o.purchase_price_updated_at,
            order_notes = o.order_notes,
            source_platform = o.source_platform
        FROM ozon_orders AS o
        WHERE p.order_id = o.id
            AND (
                o.material_cost IS NOT NULL
                OR o.domestic_tracking_number IS NOT NULL
                OR o.purchase_price IS NOT NULL
                OR o.order_notes IS NOT NULL
                OR o.source_platform IS NOT NULL
            );
    """)

    # 注意：暂时保留 ozon_orders 表中的这些字段，以便向后兼容
    # 后续确认无问题后可以手动删除


def downgrade() -> None:
    """
    回滚迁移：从 ozon_postings 删除新增字段

    注意：回滚会丢失已迁移的数据（因为ozon_orders的字段我们没有删除，数据仍在）
    """

    # 删除从 ozon_postings 新增的字段
    op.drop_column('ozon_postings', 'source_platform')
    op.drop_column('ozon_postings', 'order_notes')
    op.drop_column('ozon_postings', 'purchase_price_updated_at')
    op.drop_column('ozon_postings', 'purchase_price')
    op.drop_column('ozon_postings', 'domestic_tracking_updated_at')
    op.drop_column('ozon_postings', 'domestic_tracking_number')
    op.drop_column('ozon_postings', 'material_cost')