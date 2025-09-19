"""update_ozon_product_status_to_five_types

Revision ID: 948ce22fbbbf
Revises: b043d17754d5
Create Date: 2025-09-19 16:03:16.115404

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '948ce22fbbbf'
down_revision = 'b043d17754d5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 1. 添加新字段
    op.add_column('ozon_products', sa.Column('ozon_status', sa.String(50), nullable=True, comment='OZON原生状态'))
    op.add_column('ozon_products', sa.Column('status_reason', sa.Text(), nullable=True, comment='状态原因说明'))
    op.add_column('ozon_products', sa.Column('ozon_visibility_details', sa.JSON(), nullable=True, comment='OZON可见性详情'))

    # 2. 更新现有数据的status字段，将旧状态映射到新的5种状态
    # 先设置ozon_status默认值
    op.execute("""
        UPDATE ozon_products
        SET ozon_status = CASE
            WHEN status = 'archived' THEN 'archived'
            WHEN status = 'active' THEN 'on_sale'
            WHEN status = 'inactive' AND (ozon_archived = true OR is_archived = true) THEN 'archived'
            WHEN status = 'inactive' AND visibility = false THEN 'inactive'
            WHEN status = 'inactive' THEN 'ready_to_sell'
            ELSE 'inactive'
        END
        WHERE ozon_status IS NULL
    """)

    # 3. 修改status字段的值，使用新的5种状态
    op.execute("""
        UPDATE ozon_products
        SET status = CASE
            WHEN status = 'archived' THEN 'archived'
            WHEN status = 'active' THEN 'on_sale'
            WHEN status = 'inactive' AND (ozon_archived = true OR is_archived = true) THEN 'archived'
            WHEN status = 'inactive' AND visibility = false THEN 'inactive'
            WHEN status = 'inactive' THEN 'ready_to_sell'
            WHEN status = 'draft' THEN 'ready_to_sell'
            WHEN status = 'deleted' THEN 'archived'
            ELSE 'inactive'
        END
    """)

    # 4. 为新字段创建索引
    op.create_index('ix_ozon_products_ozon_status', 'ozon_products', ['ozon_status'])

    # 5. 添加status字段的CHECK约束，限制为6种状态（包含archived）
    op.execute("""
        ALTER TABLE ozon_products
        ADD CONSTRAINT check_ozon_product_status
        CHECK (status IN ('on_sale', 'ready_to_sell', 'error', 'pending_modification', 'inactive', 'archived'))
    """)

    # 添加注释说明状态含义
    op.execute("""
        COMMENT ON COLUMN ozon_products.status IS '商品状态: on_sale=销售中, ready_to_sell=准备销售, error=错误, pending_modification=待修改, inactive=下架, archived=已归档';
    """)


def downgrade() -> None:
    """Downgrade database schema"""
    # 1. 移除CHECK约束
    op.execute("ALTER TABLE ozon_products DROP CONSTRAINT IF EXISTS check_ozon_product_status")

    # 2. 将新状态映射回旧状态
    op.execute("""
        UPDATE ozon_products
        SET status = CASE
            WHEN status = 'on_sale' THEN 'active'
            WHEN status = 'ready_to_sell' THEN 'inactive'
            WHEN status = 'error' THEN 'inactive'
            WHEN status = 'pending_modification' THEN 'inactive'
            WHEN status = 'inactive' THEN 'inactive'
            WHEN status = 'archived' THEN 'archived'
            ELSE status
        END
    """)

    # 3. 删除索引
    op.drop_index('ix_ozon_products_ozon_status', table_name='ozon_products')

    # 4. 删除新增的列
    op.drop_column('ozon_products', 'ozon_visibility_details')
    op.drop_column('ozon_products', 'status_reason')
    op.drop_column('ozon_products', 'ozon_status')