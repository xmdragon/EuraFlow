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
    1. 创建 ozon listing 相关表（categories, attributes, dictionary_values, import_logs）
    2. 创建 ozon_global_settings 表
    3. 创建 ozon_category_commissions 表
    4. 初始化默认全局设置
    5. 清理 ozon_shops.config 中的废弃字段
    """

    # 1. 创建 OZON 类目缓存表
    op.create_table(
        'ozon_categories',
        sa.Column('category_id', sa.Integer(), nullable=False),
        sa.Column('parent_id', sa.Integer(), sa.ForeignKey('ozon_categories.category_id', ondelete='SET NULL'), nullable=True),
        sa.Column('name', sa.String(500), nullable=False),
        sa.Column('is_leaf', sa.Boolean(), nullable=True, default=False, comment='是否叶子类目(只有叶子类目可建品)'),
        sa.Column('is_disabled', sa.Boolean(), nullable=True, default=False),
        sa.Column('is_deprecated', sa.Boolean(), nullable=True, default=False, comment='是否已废弃(不再出现在OZON API中)'),
        sa.Column('level', sa.Integer(), nullable=True, default=0, comment='层级深度'),
        sa.Column('full_path', sa.String(2000), nullable=True, comment='完整路径(用/分隔)'),
        sa.Column('cached_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attributes_synced_at', sa.DateTime(timezone=True), nullable=True, comment='特征最后同步时间'),
        sa.PrimaryKeyConstraint('category_id')
    )
    op.create_index('idx_ozon_categories_parent', 'ozon_categories', ['parent_id'])
    op.create_index('idx_ozon_categories_leaf', 'ozon_categories', ['is_leaf'], postgresql_where=sa.text('is_leaf = true'))
    op.create_index('idx_ozon_categories_attrs_synced_at', 'ozon_categories', ['attributes_synced_at'])
    op.execute("CREATE INDEX idx_ozon_categories_name ON ozon_categories USING gin (name gin_trgm_ops)")

    # 2. 创建 OZON 类目属性缓存表
    op.create_table(
        'ozon_category_attributes',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('category_id', sa.Integer(), sa.ForeignKey('ozon_categories.category_id'), nullable=False),
        sa.Column('attribute_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(500), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('attribute_type', sa.String(50), nullable=False, comment='string/number/boolean/dictionary/multivalue'),
        sa.Column('is_required', sa.Boolean(), nullable=True, default=False, comment='是否必填'),
        sa.Column('is_collection', sa.Boolean(), nullable=True, default=False, comment='是否多值属性'),
        sa.Column('dictionary_id', sa.Integer(), nullable=True, comment='字典ID(如果是字典类型)'),
        sa.Column('min_value', sa.Numeric(18, 4), nullable=True),
        sa.Column('max_value', sa.Numeric(18, 4), nullable=True),
        sa.Column('cached_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('category_id', 'attribute_id', name='uq_ozon_category_attrs')
    )
    op.create_index('idx_ozon_category_attrs_category', 'ozon_category_attributes', ['category_id'])
    op.create_index('idx_ozon_category_attrs_required', 'ozon_category_attributes', ['category_id', 'is_required'],
                    postgresql_where=sa.text('is_required = true'))
    op.create_index('idx_ozon_category_attrs_dict', 'ozon_category_attributes', ['dictionary_id'],
                    postgresql_where=sa.text('dictionary_id IS NOT NULL'))

    # 3. 创建 OZON 属性字典值缓存表
    op.create_table(
        'ozon_attribute_dictionary_values',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('dictionary_id', sa.Integer(), nullable=False),
        sa.Column('value_id', sa.BigInteger(), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('info', sa.Text(), nullable=True),
        sa.Column('picture', sa.String(500), nullable=True),
        sa.Column('cached_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('dictionary_id', 'value_id', name='uq_ozon_dict_values')
    )
    op.create_index('idx_ozon_dict_values_dict', 'ozon_attribute_dictionary_values', ['dictionary_id'])
    op.execute("CREATE INDEX idx_ozon_dict_values_search ON ozon_attribute_dictionary_values USING gin (value gin_trgm_ops)")

    # 4. 创建 OZON 媒体导入日志表
    op.create_table(
        'ozon_media_import_logs',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('offer_id', sa.String(100), nullable=False),
        sa.Column('source_url', sa.Text(), nullable=False, comment='Cloudinary URL'),
        sa.Column('file_name', sa.String(500), nullable=True),
        sa.Column('position', sa.Integer(), nullable=True, default=0, comment='图片位置(0=主图)'),
        sa.Column('ozon_file_id', sa.String(100), nullable=True),
        sa.Column('ozon_url', sa.Text(), nullable=True),
        sa.Column('task_id', sa.String(100), nullable=True),
        sa.Column('state', sa.String(50), nullable=True, default='pending', comment='pending/uploading/uploaded/failed'),
        sa.Column('error_code', sa.String(100), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('retry_count', sa.Integer(), nullable=True, default=0),
        sa.Column('last_retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_ozon_media_logs_offer', 'ozon_media_import_logs', ['shop_id', 'offer_id'])
    op.create_index('idx_ozon_media_logs_state', 'ozon_media_import_logs', ['state', 'created_at'])
    op.create_index('idx_ozon_media_logs_task', 'ozon_media_import_logs', ['task_id'],
                    postgresql_where=sa.text('task_id IS NOT NULL'))

    # 5. 创建 OZON 商品导入日志表
    op.create_table(
        'ozon_product_import_logs',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('offer_id', sa.String(100), nullable=False),
        sa.Column('import_mode', sa.String(20), nullable=True, default='NEW_CARD', comment='NEW_CARD/FOLLOW_PDP'),
        sa.Column('request_payload', postgresql.JSONB(), nullable=False),
        sa.Column('task_id', sa.String(100), nullable=True),
        sa.Column('response_payload', postgresql.JSONB(), nullable=True),
        sa.Column('state', sa.String(50), nullable=True, default='submitted', comment='submitted/processing/created/price_sent/failed'),
        sa.Column('error_code', sa.String(100), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('errors', postgresql.JSONB(), nullable=True, comment='详细错误列表'),
        sa.Column('ozon_product_id', sa.BigInteger(), nullable=True),
        sa.Column('ozon_sku', sa.BigInteger(), nullable=True),
        sa.Column('retry_count', sa.Integer(), nullable=True, default=0),
        sa.Column('last_retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_ozon_product_logs_offer', 'ozon_product_import_logs', ['shop_id', 'offer_id'])
    op.create_index('idx_ozon_product_logs_state', 'ozon_product_import_logs', ['state', 'created_at'])
    op.create_index('idx_ozon_product_logs_task', 'ozon_product_import_logs', ['task_id'],
                    postgresql_where=sa.text('task_id IS NOT NULL'))

    # 6. 创建 OZON 价格更新日志表
    op.create_table(
        'ozon_price_update_logs',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('offer_id', sa.String(100), nullable=False),
        sa.Column('currency_code', sa.String(10), nullable=True, default='RUB'),
        sa.Column('price', sa.Numeric(18, 4), nullable=False),
        sa.Column('old_price', sa.Numeric(18, 4), nullable=True),
        sa.Column('min_price', sa.Numeric(18, 4), nullable=True),
        sa.Column('auto_action_enabled', sa.Boolean(), nullable=True, default=False),
        sa.Column('price_strategy_enabled', sa.Boolean(), nullable=True, default=False),
        sa.Column('state', sa.String(50), nullable=True, default='pending', comment='pending/accepted/failed'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_ozon_price_logs_offer', 'ozon_price_update_logs', ['shop_id', 'offer_id', 'created_at'])
    op.create_index('idx_ozon_price_logs_state', 'ozon_price_update_logs', ['state', 'created_at'])

    # 7. 创建 OZON 库存更新日志表
    op.create_table(
        'ozon_stock_update_logs',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('offer_id', sa.String(100), nullable=False),
        sa.Column('product_id', sa.BigInteger(), nullable=True),
        sa.Column('warehouse_id', sa.Integer(), nullable=False),
        sa.Column('stock', sa.Integer(), nullable=False),
        sa.Column('state', sa.String(50), nullable=True, default='pending', comment='pending/accepted/failed'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_ozon_stock_logs_offer', 'ozon_stock_update_logs', ['shop_id', 'offer_id', 'created_at'])
    op.create_index('idx_ozon_stock_logs_state', 'ozon_stock_update_logs', ['state', 'created_at'])
    op.create_index('idx_ozon_stock_logs_warehouse', 'ozon_stock_update_logs', ['warehouse_id', 'created_at'])

    # 8. 创建全局设置表
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

    # 9. 创建类目佣金表
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

    # 10. 初始化默认全局设置
    op.execute("""
        INSERT INTO ozon_global_settings (setting_key, setting_value, description)
        VALUES (
            'api_rate_limit',
            '{"value": 50, "unit": "req/s"}'::jsonb,
            'API限流：每秒发送API请求上限'
        )
    """)

    # 11. 清理 ozon_shops.config 中的废弃字段
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
    2. 删除表（按创建的反向顺序）
    注意：无法恢复被删除的 ozon_shops.config 字段
    """

    # 删除类目佣金表索引和表
    op.drop_index('idx_ozon_category_commissions_name', table_name='ozon_category_commissions')
    op.drop_index('idx_ozon_category_commissions_module', table_name='ozon_category_commissions')
    op.drop_table('ozon_category_commissions')

    # 删除全局设置表索引和表
    op.drop_index('idx_ozon_global_settings_key', table_name='ozon_global_settings')
    op.drop_table('ozon_global_settings')

    # 删除库存更新日志表
    op.drop_index('idx_ozon_stock_logs_warehouse', table_name='ozon_stock_update_logs')
    op.drop_index('idx_ozon_stock_logs_state', table_name='ozon_stock_update_logs')
    op.drop_index('idx_ozon_stock_logs_offer', table_name='ozon_stock_update_logs')
    op.drop_table('ozon_stock_update_logs')

    # 删除价格更新日志表
    op.drop_index('idx_ozon_price_logs_state', table_name='ozon_price_update_logs')
    op.drop_index('idx_ozon_price_logs_offer', table_name='ozon_price_update_logs')
    op.drop_table('ozon_price_update_logs')

    # 删除商品导入日志表
    op.drop_index('idx_ozon_product_logs_task', table_name='ozon_product_import_logs')
    op.drop_index('idx_ozon_product_logs_state', table_name='ozon_product_import_logs')
    op.drop_index('idx_ozon_product_logs_offer', table_name='ozon_product_import_logs')
    op.drop_table('ozon_product_import_logs')

    # 删除媒体导入日志表
    op.drop_index('idx_ozon_media_logs_task', table_name='ozon_media_import_logs')
    op.drop_index('idx_ozon_media_logs_state', table_name='ozon_media_import_logs')
    op.drop_index('idx_ozon_media_logs_offer', table_name='ozon_media_import_logs')
    op.drop_table('ozon_media_import_logs')

    # 删除属性字典值表
    op.execute("DROP INDEX IF EXISTS idx_ozon_dict_values_search")
    op.drop_index('idx_ozon_dict_values_dict', table_name='ozon_attribute_dictionary_values')
    op.drop_table('ozon_attribute_dictionary_values')

    # 删除类目属性表
    op.drop_index('idx_ozon_category_attrs_dict', table_name='ozon_category_attributes')
    op.drop_index('idx_ozon_category_attrs_required', table_name='ozon_category_attributes')
    op.drop_index('idx_ozon_category_attrs_category', table_name='ozon_category_attributes')
    op.drop_table('ozon_category_attributes')

    # 删除类目表
    op.execute("DROP INDEX IF EXISTS idx_ozon_categories_name")
    op.drop_index('idx_ozon_categories_attrs_synced_at', table_name='ozon_categories')
    op.drop_index('idx_ozon_categories_leaf', table_name='ozon_categories')
    op.drop_index('idx_ozon_categories_parent', table_name='ozon_categories')
    op.drop_table('ozon_categories')

    # 注意：被删除的 ozon_shops.config 字段无法恢复