"""add_global_settings_and_category_commissions_tables

Revision ID: 66847d15939c
Revises: dced932dbccc
Create Date: 2025-10-30 15:58:23.053733

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from datetime import datetime


# revision identifiers, used by Alembic.
revision = '66847d15939c'
down_revision = 'dced932dbccc'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    1. 创建 ozon_global_settings 表
    2. 创建 ozon_category_commissions 表
    3. 初始化默认全局设置
    4. 清理 ozon_shops.config 中的废弃字段
    """

    # 1. 创建全局设置表
    op.create_table(
        'ozon_global_settings',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='设置ID'),
        sa.Column('setting_key', sa.String(100), nullable=False, unique=True, comment='设置键（如：api_rate_limit）'),
        sa.Column('setting_value', postgresql.JSONB(), nullable=False, comment='设置值（JSONB格式）'),
        sa.Column('description', sa.String(500), nullable=True, comment='设置描述'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), onupdate=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
        comment='Ozon全局设置表'
    )
    op.create_index('idx_ozon_global_settings_key', 'ozon_global_settings', ['setting_key'], unique=True)

    # 2. 创建类目佣金表
    op.create_table(
        'ozon_category_commissions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='佣金记录ID'),
        sa.Column('category_module', sa.String(200), nullable=False, comment='类目模块（一级类目，如：美容、电子产品）'),
        sa.Column('category_name', sa.String(200), nullable=False, comment='商品类目（二级类目，如：专业医疗设备）'),
        sa.Column('rfbs_tier1', sa.DECIMAL(5, 2), nullable=False, comment='rFBS方案佣金 - 最多1500卢布（含）'),
        sa.Column('rfbs_tier2', sa.DECIMAL(5, 2), nullable=False, comment='rFBS方案佣金 - 最多5000卢布（含）'),
        sa.Column('rfbs_tier3', sa.DECIMAL(5, 2), nullable=False, comment='rFBS方案佣金 - 超过5000卢布'),
        sa.Column('fbp_tier1', sa.DECIMAL(5, 2), nullable=False, comment='FBP方案佣金 - 最多1500卢布（含）'),
        sa.Column('fbp_tier2', sa.DECIMAL(5, 2), nullable=False, comment='FBP方案佣金 - 最多5000卢布（含）'),
        sa.Column('fbp_tier3', sa.DECIMAL(5, 2), nullable=False, comment='FBP方案佣金 - 超过5000卢布'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), onupdate=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
        comment='Ozon类目佣金表'
    )
    op.create_index('idx_ozon_category_commissions_module', 'ozon_category_commissions', ['category_module'])
    op.create_index('idx_ozon_category_commissions_name', 'ozon_category_commissions', ['category_name'])

    # 3. 初始化默认全局设置
    op.execute("""
        INSERT INTO ozon_global_settings (setting_key, setting_value, description)
        VALUES (
            'api_rate_limit',
            '{"value": 50, "unit": "req/s"}'::jsonb,
            'API限流：每秒发送API请求上限'
        )
    """)

    # 4. 清理 ozon_shops.config 中的废弃字段
    # 由于 config 是 JSON 类型（不是 JSONB），需要先转换为 JSONB，删除字段后再转回 JSON
    op.execute("""
        UPDATE ozon_shops
        SET config = (
            config::jsonb - 'sync_interval_minutes' - 'auto_sync_enabled' - 'rate_limits'
        )::json
        WHERE config::text LIKE '%sync_interval_minutes%'
           OR config::text LIKE '%auto_sync_enabled%'
           OR config::text LIKE '%rate_limits%'
    """)


def downgrade() -> None:
    """
    回滚迁移：
    1. 删除索引
    2. 删除表
    注意：无法恢复被删除的 ozon_shops.config 字段
    """

    # 删除类目佣金表索引和表
    op.drop_index('idx_ozon_category_commissions_name', table_name='ozon_category_commissions')
    op.drop_index('idx_ozon_category_commissions_module', table_name='ozon_category_commissions')
    op.drop_table('ozon_category_commissions')

    # 删除全局设置表索引和表
    op.drop_index('idx_ozon_global_settings_key', table_name='ozon_global_settings')
    op.drop_table('ozon_global_settings')

    # 注意：被删除的 ozon_shops.config 字段无法恢复