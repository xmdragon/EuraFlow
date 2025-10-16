"""add_ozon_warehouses_table

Revision ID: add_ozon_warehouses
Revises: add_profit_fields
Create Date: 2025-10-16 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_ozon_warehouses'
down_revision = 'add_profit_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    创建 ozon_warehouses 表

    存储从 OZON API 同步的仓库信息（FBS/rFBS）。
    支持通过店铺管理页面的"同步仓库"按钮触发同步。
    """

    op.create_table(
        'ozon_warehouses',
        sa.Column('id', sa.BigInteger(), nullable=False, comment='仓库记录ID'),
        sa.Column('shop_id', sa.BigInteger(), nullable=False, comment='关联的Ozon店铺ID'),
        sa.Column('warehouse_id', sa.BigInteger(), nullable=False, comment='OZON 仓库ID'),
        sa.Column('name', sa.String(length=200), nullable=False, comment='仓库名称'),
        sa.Column('is_rfbs', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否为rFBS仓库'),
        sa.Column('status', sa.String(length=20), nullable=False, comment='仓库状态：new/created/disabled/blocked/disabled_due_to_limit/error'),
        sa.Column('has_entrusted_acceptance', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否启用受信任接受'),
        sa.Column('postings_limit', sa.Integer(), nullable=False, server_default=sa.text('-1'), comment='订单限额（-1表示无限制）'),
        sa.Column('min_postings_limit', sa.Integer(), nullable=True, comment='单次供货最小订单数'),
        sa.Column('has_postings_limit', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否有订单数限制'),
        sa.Column('min_working_days', sa.Integer(), nullable=True, comment='最少工作天数'),
        sa.Column('working_days', postgresql.JSON(astext_type=sa.Text()), nullable=True, comment='工作日列表（1-7表示周一至周日）'),
        sa.Column('can_print_act_in_advance', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否可提前打印收发证书'),
        sa.Column('is_karantin', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否因隔离停运'),
        sa.Column('is_kgt', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否接受大宗商品'),
        sa.Column('is_timetable_editable', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否可修改时间表'),
        sa.Column('first_mile_type', postgresql.JSON(astext_type=sa.Text()), nullable=True, comment='第一英里类型配置'),
        sa.Column('raw_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='OZON API 原始响应数据'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间（UTC）'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间（UTC）'),
        sa.ForeignKeyConstraint(['shop_id'], ['ozon_shops.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('shop_id', 'warehouse_id', name='uq_ozon_warehouse_shop_warehouse')
    )

    # 创建索引
    op.create_index('idx_ozon_warehouses_shop_id', 'ozon_warehouses', ['shop_id'])


def downgrade() -> None:
    """
    回滚迁移：删除 ozon_warehouses 表
    """
    op.drop_index('idx_ozon_warehouses_shop_id', table_name='ozon_warehouses')
    op.drop_table('ozon_warehouses')
