"""add_product_selection_tables

Revision ID: 8649280daab1
Revises: e2f6b8c3d7a1
Create Date: 2025-09-26 14:39:19.311971

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '8649280daab1'
down_revision = 'e2f6b8c3d7a1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # Create product selection items table
    op.create_table('ozon_product_selection_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.String(length=50), nullable=False, comment='商品ID'),
        sa.Column('product_name_ru', sa.String(length=500), nullable=True, comment='俄文名称'),
        sa.Column('product_name_cn', sa.String(length=500), nullable=True, comment='中文名称'),
        sa.Column('ozon_link', sa.Text(), nullable=True, comment='商品链接'),
        sa.Column('image_url', sa.Text(), nullable=True, comment='图片链接'),
        sa.Column('category_link', sa.Text(), nullable=True, comment='类目链接'),
        sa.Column('brand', sa.String(length=200), nullable=True, comment='品牌'),
        sa.Column('brand_normalized', sa.String(length=200), nullable=True, comment='标准化品牌名'),
        sa.Column('current_price', sa.Numeric(precision=18, scale=2), nullable=True, comment='当前价格(卢布)'),
        sa.Column('original_price', sa.Numeric(precision=18, scale=2), nullable=True, comment='原价(卢布)'),
        sa.Column('rfbs_commission_low', sa.Numeric(precision=5, scale=2), nullable=True, comment='rFBS(<=1500₽)佣金率'),
        sa.Column('rfbs_commission_mid', sa.Numeric(precision=5, scale=2), nullable=True, comment='rFBS(1501-5000₽)佣金率'),
        sa.Column('rfbs_commission_high', sa.Numeric(precision=5, scale=2), nullable=True, comment='rFBS(>5000₽)佣金率'),
        sa.Column('fbp_commission_low', sa.Numeric(precision=5, scale=2), nullable=True, comment='FBP(<=1500₽)佣金率'),
        sa.Column('fbp_commission_mid', sa.Numeric(precision=5, scale=2), nullable=True, comment='FBP(1501-5000₽)佣金率'),
        sa.Column('fbp_commission_high', sa.Numeric(precision=5, scale=2), nullable=True, comment='FBP(>5000₽)佣金率'),
        sa.Column('monthly_sales_volume', sa.Integer(), nullable=True, comment='月销量(件)'),
        sa.Column('monthly_sales_revenue', sa.Numeric(precision=18, scale=2), nullable=True, comment='月销售额(卢布)'),
        sa.Column('daily_sales_volume', sa.Numeric(precision=10, scale=2), nullable=True, comment='平均日销量(件)'),
        sa.Column('daily_sales_revenue', sa.Numeric(precision=18, scale=2), nullable=True, comment='平均日销售额(卢布)'),
        sa.Column('sales_dynamic_percent', sa.Numeric(precision=10, scale=2), nullable=True, comment='销售动态(%)'),
        sa.Column('conversion_rate', sa.Numeric(precision=5, scale=2), nullable=True, comment='成交率(%)'),
        sa.Column('package_weight', sa.Integer(), nullable=True, comment='包装重量(克)'),
        sa.Column('package_volume', sa.Numeric(precision=10, scale=2), nullable=True, comment='包装体积(升)'),
        sa.Column('package_length', sa.Integer(), nullable=True, comment='包装长度(mm)'),
        sa.Column('package_width', sa.Integer(), nullable=True, comment='包装宽度(mm)'),
        sa.Column('package_height', sa.Integer(), nullable=True, comment='包装高度(mm)'),
        sa.Column('rating', sa.Numeric(precision=3, scale=2), nullable=True, comment='商品评分'),
        sa.Column('review_count', sa.Integer(), nullable=True, comment='评价数量'),
        sa.Column('seller_type', sa.String(length=50), nullable=True, comment='卖家类型(FBS/FBO)'),
        sa.Column('delivery_days', sa.Integer(), nullable=True, comment='配送时间(天)'),
        sa.Column('availability_percent', sa.Numeric(precision=5, scale=2), nullable=True, comment='商品可用性(%)'),
        sa.Column('ad_cost_share', sa.Numeric(precision=5, scale=2), nullable=True, comment='广告费用份额(%)'),
        sa.Column('product_created_date', sa.DateTime(), nullable=True, comment='商品创建日期'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('product_id')
    )
    op.create_index('idx_brand_price', 'ozon_product_selection_items', ['brand_normalized', 'current_price'], unique=False)
    op.create_index('idx_commission', 'ozon_product_selection_items', ['rfbs_commission_low', 'rfbs_commission_mid', 'fbp_commission_low', 'fbp_commission_mid'], unique=False)
    op.create_index('idx_sales_weight', 'ozon_product_selection_items', ['monthly_sales_volume', 'package_weight'], unique=False)
    op.create_index(op.f('ix_ozon_product_selection_items_brand'), 'ozon_product_selection_items', ['brand'], unique=False)
    op.create_index(op.f('ix_ozon_product_selection_items_brand_normalized'), 'ozon_product_selection_items', ['brand_normalized'], unique=False)
    op.create_index(op.f('ix_ozon_product_selection_items_id'), 'ozon_product_selection_items', ['id'], unique=False)
    op.create_index(op.f('ix_ozon_product_selection_items_monthly_sales_volume'), 'ozon_product_selection_items', ['monthly_sales_volume'], unique=False)
    op.create_index(op.f('ix_ozon_product_selection_items_package_weight'), 'ozon_product_selection_items', ['package_weight'], unique=False)

    # Create import history table
    op.create_table('ozon_product_selection_import_history',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('file_name', sa.String(length=255), nullable=False, comment='文件名'),
        sa.Column('file_type', sa.String(length=10), nullable=False, comment='文件类型(xlsx/csv)'),
        sa.Column('file_size', sa.Integer(), nullable=True, comment='文件大小(字节)'),
        sa.Column('imported_by', sa.Integer(), nullable=False, comment='导入用户ID'),
        sa.Column('import_time', sa.DateTime(), nullable=False, comment='导入时间'),
        sa.Column('import_strategy', sa.String(length=20), nullable=True, comment='导入策略(skip/update/append)'),
        sa.Column('total_rows', sa.Integer(), nullable=True, comment='总行数'),
        sa.Column('success_rows', sa.Integer(), nullable=True, comment='成功行数'),
        sa.Column('failed_rows', sa.Integer(), nullable=True, comment='失败行数'),
        sa.Column('updated_rows', sa.Integer(), nullable=True, comment='更新行数'),
        sa.Column('skipped_rows', sa.Integer(), nullable=True, comment='跳过行数'),
        sa.Column('import_log', sa.JSON(), nullable=True, comment='导入日志详情'),
        sa.Column('error_details', sa.JSON(), nullable=True, comment='错误详情'),
        sa.Column('process_duration', sa.Integer(), nullable=True, comment='处理耗时(秒)'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ozon_product_selection_import_history_id'), 'ozon_product_selection_import_history', ['id'], unique=False)


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_index(op.f('ix_ozon_product_selection_import_history_id'), table_name='ozon_product_selection_import_history')
    op.drop_table('ozon_product_selection_import_history')
    op.drop_index(op.f('ix_ozon_product_selection_items_package_weight'), table_name='ozon_product_selection_items')
    op.drop_index(op.f('ix_ozon_product_selection_items_monthly_sales_volume'), table_name='ozon_product_selection_items')
    op.drop_index(op.f('ix_ozon_product_selection_items_id'), table_name='ozon_product_selection_items')
    op.drop_index(op.f('ix_ozon_product_selection_items_brand_normalized'), table_name='ozon_product_selection_items')
    op.drop_index(op.f('ix_ozon_product_selection_items_brand'), table_name='ozon_product_selection_items')
    op.drop_index('idx_sales_weight', table_name='ozon_product_selection_items')
    op.drop_index('idx_commission', table_name='ozon_product_selection_items')
    op.drop_index('idx_brand_price', table_name='ozon_product_selection_items')
    op.drop_table('ozon_product_selection_items')