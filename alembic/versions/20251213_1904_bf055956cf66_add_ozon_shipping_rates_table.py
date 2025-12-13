"""add ozon_shipping_rates table

Revision ID: bf055956cf66
Revises: 0e3e0663a0ce
Create Date: 2025-12-13 19:04:24.226488

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'bf055956cf66'
down_revision = '0e3e0663a0ce'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    op.create_table(
        'ozon_shipping_rates',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('size_group', sa.String(50), nullable=False, comment='评分组: Extra Small/Budget/Small/Big/Premium Small/Premium Big'),
        sa.Column('service_level', sa.String(20), nullable=False, comment='服务等级: Express/Standard/Economy'),
        sa.Column('logistics_provider', sa.String(50), nullable=False, comment='第三方物流: RETS/ZTO/Ural/CEL 等'),
        sa.Column('delivery_method', sa.String(100), nullable=False, comment='配送方式名称'),
        sa.Column('ozon_rating', sa.Integer(), comment='Ozon评级 (1-15)'),
        sa.Column('transit_days', sa.String(20), comment='时效限制: 5-10, 10-15 等'),
        sa.Column('rate', sa.String(100), comment='费率: ¥2,9 + ¥0,045/1g'),
        sa.Column('battery_allowed', sa.Boolean(), default=False, comment='是否允许电池'),
        sa.Column('liquid_allowed', sa.Boolean(), default=False, comment='是否允许液体'),
        sa.Column('size_limit', sa.String(200), comment='尺寸限制'),
        sa.Column('weight_min_g', sa.Integer(), comment='最小重量(克)'),
        sa.Column('weight_max_g', sa.Integer(), comment='最大重量(克)'),
        sa.Column('value_limit_rub', sa.String(50), comment='货值限制(卢布)'),
        sa.Column('value_limit_cny', sa.String(50), comment='货值限制(人民币)'),
        sa.Column('value_limit_usd', sa.String(50), comment='货值限制(美元)'),
        sa.Column('value_limit_eur', sa.String(50), comment='货值限制(欧元)'),
        sa.Column('billing_type', sa.String(50), comment='计费类型'),
        sa.Column('volume_weight_calc', sa.String(100), comment='体积重量计算方式'),
        sa.Column('loss_compensation_rub', sa.Integer(), comment='丢失赔偿上限(卢布)'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), comment='创建时间'),
    )

    op.create_index('idx_shipping_rates_provider', 'ozon_shipping_rates', ['logistics_provider'])
    op.create_index('idx_shipping_rates_size_service', 'ozon_shipping_rates', ['size_group', 'service_level'])


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_index('idx_shipping_rates_size_service', table_name='ozon_shipping_rates')
    op.drop_index('idx_shipping_rates_provider', table_name='ozon_shipping_rates')
    op.drop_table('ozon_shipping_rates')