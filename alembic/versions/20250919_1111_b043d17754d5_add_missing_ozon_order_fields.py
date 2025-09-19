"""add missing ozon order fields

Revision ID: b043d17754d5
Revises: f8c38de1e41f
Create Date: 2025-09-19 11:11:01.571949+00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'b043d17754d5'
down_revision = '14b2ff89f856'
branch_labels = None
depends_on = None


def upgrade():
    # 添加配送详情字段
    op.add_column('ozon_orders', sa.Column('warehouse_id', sa.BigInteger(), nullable=True, comment='仓库ID'))
    op.add_column('ozon_orders', sa.Column('warehouse_name', sa.String(200), nullable=True, comment='仓库名称'))
    op.add_column('ozon_orders', sa.Column('tpl_provider_id', sa.Integer(), nullable=True, comment='物流商ID'))
    op.add_column('ozon_orders', sa.Column('tpl_provider_name', sa.String(200), nullable=True, comment='物流商名称'))
    op.add_column('ozon_orders', sa.Column('tpl_integration_type', sa.String(50), nullable=True, comment='物流集成类型'))
    op.add_column('ozon_orders', sa.Column('provider_status', sa.String(100), nullable=True, comment='物流商状态'))

    # 添加条形码字段
    op.add_column('ozon_orders', sa.Column('upper_barcode', sa.String(100), nullable=True, comment='上条形码'))
    op.add_column('ozon_orders', sa.Column('lower_barcode', sa.String(100), nullable=True, comment='下条形码'))

    # 添加取消详情字段
    op.add_column('ozon_orders', sa.Column('cancel_reason_id', sa.Integer(), nullable=True, comment='取消原因ID'))
    op.add_column('ozon_orders', sa.Column('cancellation_type', sa.String(50), nullable=True, comment='取消类型'))
    op.add_column('ozon_orders', sa.Column('cancelled_after_ship', sa.Boolean(), nullable=True, default=False, comment='发货后取消'))
    op.add_column('ozon_orders', sa.Column('affect_cancellation_rating', sa.Boolean(), nullable=True, default=False, comment='影响评分'))
    op.add_column('ozon_orders', sa.Column('cancellation_initiator', sa.String(50), nullable=True, comment='取消发起方'))

    # 添加其他重要字段
    op.add_column('ozon_orders', sa.Column('previous_substatus', sa.String(50), nullable=True, comment='前一个子状态'))
    op.add_column('ozon_orders', sa.Column('requirements', postgresql.JSON(), nullable=True, comment='特殊要求'))
    op.add_column('ozon_orders', sa.Column('addressee', postgresql.JSON(), nullable=True, comment='收件人信息'))
    op.add_column('ozon_orders', sa.Column('is_legal', sa.Boolean(), nullable=True, default=False, comment='是否法人订单'))
    op.add_column('ozon_orders', sa.Column('payment_type', sa.String(100), nullable=True, comment='支付类型组'))
    op.add_column('ozon_orders', sa.Column('delivery_date_begin', sa.DateTime(timezone=True), nullable=True, comment='配送开始时间'))
    op.add_column('ozon_orders', sa.Column('delivery_date_end', sa.DateTime(timezone=True), nullable=True, comment='配送结束时间'))

    # 添加同步控制字段
    op.add_column('ozon_orders', sa.Column('sync_mode', sa.String(20), nullable=True, default='incremental', comment='同步模式：full或incremental'))
    op.add_column('ozon_orders', sa.Column('sync_version', sa.Integer(), nullable=True, default=1, comment='同步版本号'))

    # 添加更多JSON字段存储复杂数据
    op.add_column('ozon_orders', sa.Column('barcodes', postgresql.JSON(), nullable=True, comment='条形码对象'))
    op.add_column('ozon_orders', sa.Column('cancellation_detail', postgresql.JSON(), nullable=True, comment='取消详情对象'))
    op.add_column('ozon_orders', sa.Column('delivery_method_detail', postgresql.JSON(), nullable=True, comment='配送方式详情'))
    op.add_column('ozon_orders', sa.Column('optional_info', postgresql.JSON(), nullable=True, comment='可选信息'))
    op.add_column('ozon_orders', sa.Column('related_postings', postgresql.JSON(), nullable=True, comment='相关订单'))
    op.add_column('ozon_orders', sa.Column('product_exemplars', postgresql.JSON(), nullable=True, comment='产品样本'))
    op.add_column('ozon_orders', sa.Column('legal_info', postgresql.JSON(), nullable=True, comment='法律信息'))
    op.add_column('ozon_orders', sa.Column('translit', postgresql.JSON(), nullable=True, comment='音译信息'))

    # 添加索引以优化查询
    op.create_index('ix_ozon_orders_warehouse_id', 'ozon_orders', ['warehouse_id'])
    op.create_index('ix_ozon_orders_tpl_provider_id', 'ozon_orders', ['tpl_provider_id'])
    op.create_index('ix_ozon_orders_cancel_reason_id', 'ozon_orders', ['cancel_reason_id'])
    op.create_index('ix_ozon_orders_sync_mode', 'ozon_orders', ['sync_mode'])
    op.create_index('ix_ozon_orders_is_legal', 'ozon_orders', ['is_legal'])
    op.create_index('ix_ozon_orders_payment_type', 'ozon_orders', ['payment_type'])


def downgrade():
    # 删除索引
    op.drop_index('ix_ozon_orders_payment_type', 'ozon_orders')
    op.drop_index('ix_ozon_orders_is_legal', 'ozon_orders')
    op.drop_index('ix_ozon_orders_sync_mode', 'ozon_orders')
    op.drop_index('ix_ozon_orders_cancel_reason_id', 'ozon_orders')
    op.drop_index('ix_ozon_orders_tpl_provider_id', 'ozon_orders')
    op.drop_index('ix_ozon_orders_warehouse_id', 'ozon_orders')

    # 删除JSON字段
    op.drop_column('ozon_orders', 'translit')
    op.drop_column('ozon_orders', 'legal_info')
    op.drop_column('ozon_orders', 'product_exemplars')
    op.drop_column('ozon_orders', 'related_postings')
    op.drop_column('ozon_orders', 'optional_info')
    op.drop_column('ozon_orders', 'delivery_method_detail')
    op.drop_column('ozon_orders', 'cancellation_detail')
    op.drop_column('ozon_orders', 'barcodes')

    # 删除同步控制字段
    op.drop_column('ozon_orders', 'sync_version')
    op.drop_column('ozon_orders', 'sync_mode')

    # 删除其他字段
    op.drop_column('ozon_orders', 'delivery_date_end')
    op.drop_column('ozon_orders', 'delivery_date_begin')
    op.drop_column('ozon_orders', 'payment_type')
    op.drop_column('ozon_orders', 'is_legal')
    op.drop_column('ozon_orders', 'addressee')
    op.drop_column('ozon_orders', 'requirements')
    op.drop_column('ozon_orders', 'previous_substatus')

    # 删除取消详情字段
    op.drop_column('ozon_orders', 'cancellation_initiator')
    op.drop_column('ozon_orders', 'affect_cancellation_rating')
    op.drop_column('ozon_orders', 'cancelled_after_ship')
    op.drop_column('ozon_orders', 'cancellation_type')
    op.drop_column('ozon_orders', 'cancel_reason_id')

    # 删除条形码字段
    op.drop_column('ozon_orders', 'lower_barcode')
    op.drop_column('ozon_orders', 'upper_barcode')

    # 删除配送详情字段
    op.drop_column('ozon_orders', 'provider_status')
    op.drop_column('ozon_orders', 'tpl_integration_type')
    op.drop_column('ozon_orders', 'tpl_provider_name')
    op.drop_column('ozon_orders', 'tpl_provider_id')
    op.drop_column('ozon_orders', 'warehouse_name')
    op.drop_column('ozon_orders', 'warehouse_id')