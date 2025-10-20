"""add_index_orders_shop_platform_updated

性能优化：为订单查询添加复合索引

该索引优化订单列表查询性能，支持以下查询模式：
- 按店铺 + 平台过滤
- 按最后更新时间倒序排序
- 支持时间范围筛选

预期性能提升：
- 订单查询速度 5-10x
- 减少全表扫描
- 降低数据库 CPU 占用

Revision ID: ed0f0b69f3ee
Revises: add_label_pdf_path
Create Date: 2025-10-20 18:47:44.766317

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ed0f0b69f3ee'
down_revision = 'add_label_pdf_path'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    添加订单查询复合索引

    索引覆盖场景：
    - WHERE shop_id = ? AND platform = ?
    - WHERE shop_id = ? AND platform = ? AND platform_updated_ts >= ?
    - ORDER BY platform_updated_ts DESC

    索引设计：
    - (shop_id, platform): 过滤条件，放在前面以提高选择性
    - platform_updated_ts DESC: 排序字段，使用降序以匹配查询
    """
    # 使用 op.create_index 创建索引
    # 注意：如果需要 CONCURRENTLY（生产环境），请在部署时手动执行
    op.create_index(
        'idx_orders_shop_platform_updated',
        'orders',
        ['shop_id', 'platform', sa.text('platform_updated_ts DESC')],
        unique=False,
        # postgresql_concurrently=True  # 生产环境可启用
    )


def downgrade() -> None:
    """
    回滚：删除订单查询复合索引

    注意：
    - 删除索引不影响数据完整性
    - 查询性能将回退到优化前水平
    """
    # 删除复合索引
    op.drop_index(
        'idx_orders_shop_platform_updated',
        table_name='orders',
        # postgresql_concurrently=True  # 生产环境可启用
    )