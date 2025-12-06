"""add ozon cancellation and return tables

Revision ID: 701c33360ec4
Revises: e5c90cbd9a50
Create Date: 2025-11-19 12:34:31.609440

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision = '701c33360ec4'
down_revision = 'e5c90cbd9a50'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 创建 ozon_cancellations 表
    op.create_table(
        'ozon_cancellations',
        # 主键
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),

        # 店铺隔离
        sa.Column('shop_id', sa.Integer(), nullable=False, comment='店铺ID'),

        # 关联关系
        sa.Column('posting_id', sa.BigInteger(), sa.ForeignKey('ozon_postings.id'), nullable=True, comment='关联的货件ID'),
        sa.Column('order_id', sa.BigInteger(), sa.ForeignKey('ozon_orders.id'), nullable=True, comment='关联的订单ID'),

        # OZON 字段
        sa.Column('cancellation_id', sa.BigInteger(), nullable=False, unique=True, comment='OZON取消申请ID'),
        sa.Column('posting_number', sa.String(100), nullable=False, comment='货件编号'),

        # 状态信息
        sa.Column('state', sa.String(50), nullable=False, comment='状态：ALL/ON_APPROVAL/APPROVED/REJECTED'),
        sa.Column('state_name', sa.String(200), nullable=True, comment='状态名称'),

        # 取消信息
        sa.Column('cancellation_initiator', sa.String(50), nullable=True, comment='发起人：CLIENT/SELLER/OZON/SYSTEM/DELIVERY'),
        sa.Column('cancellation_reason_id', sa.Integer(), nullable=True, comment='取消原因ID'),
        sa.Column('cancellation_reason_name', sa.String(500), nullable=True, comment='取消原因名称'),
        sa.Column('cancellation_reason_message', sa.Text(), nullable=True, comment='取消备注（发起人填写）'),

        # 审批信息
        sa.Column('approve_comment', sa.Text(), nullable=True, comment='确认/拒绝备注'),
        sa.Column('approve_date', sa.DateTime(timezone=True), nullable=True, comment='确认/拒绝日期'),
        sa.Column('auto_approve_date', sa.DateTime(timezone=True), nullable=True, comment='自动确认日期'),

        # 时间信息
        sa.Column('order_date', sa.DateTime(timezone=True), nullable=False, comment='订单创建日期'),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=False, comment='取消申请创建日期'),

        # 原始数据
        sa.Column('raw_payload', JSONB(), nullable=True, comment='OZON原始数据'),

        # 时间戳
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text("(NOW() AT TIME ZONE 'UTC')")),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text("(NOW() AT TIME ZONE 'UTC')")),
    )

    # 创建 ozon_cancellations 索引
    op.create_index('idx_ozon_cancellations_shop_id', 'ozon_cancellations', ['shop_id'])
    op.create_index('idx_ozon_cancellations_shop_state', 'ozon_cancellations', ['shop_id', 'state'])
    op.create_index('idx_ozon_cancellations_shop_date', 'ozon_cancellations', ['shop_id', 'cancelled_at'])
    op.create_index('idx_ozon_cancellations_posting', 'ozon_cancellations', ['posting_number'])
    op.create_index('idx_ozon_cancellations_cancelled_at', 'ozon_cancellations', ['cancelled_at'])
    op.create_index('idx_ozon_cancellations_state', 'ozon_cancellations', ['state'])
    op.create_index('idx_ozon_cancellations_initiator', 'ozon_cancellations', ['cancellation_initiator'])

    # 创建唯一约束
    op.create_unique_constraint('uq_ozon_cancellations_shop_id', 'ozon_cancellations', ['shop_id', 'cancellation_id'])

    # 创建 ozon_returns 表
    op.create_table(
        'ozon_returns',
        # 主键
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),

        # 店铺隔离
        sa.Column('shop_id', sa.Integer(), nullable=False, comment='店铺ID'),

        # 关联关系
        sa.Column('posting_id', sa.BigInteger(), sa.ForeignKey('ozon_postings.id'), nullable=True, comment='关联的货件ID'),
        sa.Column('order_id', sa.BigInteger(), sa.ForeignKey('ozon_orders.id'), nullable=True, comment='关联的订单ID'),

        # OZON 字段
        sa.Column('return_id', sa.BigInteger(), nullable=False, unique=True, comment='OZON退货申请ID'),
        sa.Column('return_number', sa.String(100), nullable=False, comment='退货申请编号'),
        sa.Column('posting_number', sa.String(100), nullable=False, comment='货件编号'),
        sa.Column('order_number', sa.String(100), nullable=True, comment='订单号'),

        # 客户信息
        sa.Column('client_name', sa.String(200), nullable=True, comment='买家姓名'),

        # 商品信息
        sa.Column('product_name', sa.String(500), nullable=True, comment='商品名称'),
        sa.Column('offer_id', sa.String(100), nullable=True, comment='商品货号'),
        sa.Column('sku', sa.BigInteger(), nullable=True, comment='SKU'),
        sa.Column('price', sa.Numeric(18, 4), nullable=True, comment='价格'),
        sa.Column('currency_code', sa.String(10), nullable=True, comment='货币代码'),

        # 状态信息
        sa.Column('group_state', sa.String(50), nullable=False, comment='状态组'),
        sa.Column('state', sa.String(50), nullable=False, comment='状态标识'),
        sa.Column('state_name', sa.String(200), nullable=True, comment='状态名称'),
        sa.Column('money_return_state_name', sa.String(200), nullable=True, comment='退款状态名称'),

        # 时间信息
        sa.Column('created_at_ozon', sa.DateTime(timezone=True), nullable=False, comment='OZON创建日期'),

        # 原始数据
        sa.Column('raw_payload', JSONB(), nullable=True, comment='OZON原始数据'),

        # 时间戳
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text("(NOW() AT TIME ZONE 'UTC')")),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text("(NOW() AT TIME ZONE 'UTC')")),
    )

    # 创建 ozon_returns 索引
    op.create_index('idx_ozon_returns_shop_id', 'ozon_returns', ['shop_id'])
    op.create_index('idx_ozon_returns_shop_state', 'ozon_returns', ['shop_id', 'group_state'])
    op.create_index('idx_ozon_returns_shop_date', 'ozon_returns', ['shop_id', 'created_at_ozon'])
    op.create_index('idx_ozon_returns_posting', 'ozon_returns', ['posting_number'])
    op.create_index('idx_ozon_returns_offer', 'ozon_returns', ['offer_id'])
    op.create_index('idx_ozon_returns_created_at_ozon', 'ozon_returns', ['created_at_ozon'])
    op.create_index('idx_ozon_returns_group_state', 'ozon_returns', ['group_state'])

    # 创建唯一约束
    op.create_unique_constraint('uq_ozon_returns_shop_id', 'ozon_returns', ['shop_id', 'return_id'])


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除 ozon_returns 约束和索引
    op.drop_constraint('uq_ozon_returns_shop_id', 'ozon_returns', type_='unique')
    op.drop_index('idx_ozon_returns_group_state', table_name='ozon_returns')
    op.drop_index('idx_ozon_returns_created_at_ozon', table_name='ozon_returns')
    op.drop_index('idx_ozon_returns_offer', table_name='ozon_returns')
    op.drop_index('idx_ozon_returns_posting', table_name='ozon_returns')
    op.drop_index('idx_ozon_returns_shop_date', table_name='ozon_returns')
    op.drop_index('idx_ozon_returns_shop_state', table_name='ozon_returns')
    op.drop_index('idx_ozon_returns_shop_id', table_name='ozon_returns')

    # 删除 ozon_returns 表
    op.drop_table('ozon_returns')

    # 删除 ozon_cancellations 约束和索引
    op.drop_constraint('uq_ozon_cancellations_shop_id', 'ozon_cancellations', type_='unique')
    op.drop_index('idx_ozon_cancellations_initiator', table_name='ozon_cancellations')
    op.drop_index('idx_ozon_cancellations_state', table_name='ozon_cancellations')
    op.drop_index('idx_ozon_cancellations_cancelled_at', table_name='ozon_cancellations')
    op.drop_index('idx_ozon_cancellations_posting', table_name='ozon_cancellations')
    op.drop_index('idx_ozon_cancellations_shop_date', table_name='ozon_cancellations')
    op.drop_index('idx_ozon_cancellations_shop_state', table_name='ozon_cancellations')
    op.drop_index('idx_ozon_cancellations_shop_id', table_name='ozon_cancellations')

    # 删除 ozon_cancellations 表
    op.drop_table('ozon_cancellations')