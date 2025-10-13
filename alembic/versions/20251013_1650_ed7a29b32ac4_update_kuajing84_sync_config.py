"""update_kuajing84_sync_config

Revision ID: ed7a29b32ac4
Revises: 6ae71f9a3655
Create Date: 2025-10-13 16:50:51.231520

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ed7a29b32ac4'
down_revision = '6ae71f9a3655'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 更新跨境巴士同步服务配置
    # 1. 改为单线程模式（每次只处理1个订单）
    # 2. 延迟改为5秒
    # 3. 调度间隔改为15秒（持续运行模式）
    # 4. 更新描述
    op.execute("""
        UPDATE sync_services
        SET
            schedule_config = '15',
            config_json = '{"delay_seconds": 5}',
            service_description = '自动从跨境巴士查询并更新"已打包"订单的物料成本和国内物流单号（单线程模式：每次处理1个订单，间隔5秒，每15秒执行一次）'
        WHERE service_key = 'kuajing84_material_cost';
    """)


def downgrade() -> None:
    """Downgrade database schema"""
    # 恢复原配置
    op.execute("""
        UPDATE sync_services
        SET
            schedule_config = '300',
            config_json = '{"batch_size": 10, "delay_seconds": 3}',
            service_description = '自动从跨境巴士查询并更新"已打包"订单的物料成本和国内物流单号（每3秒处理一条，批量10条/次）'
        WHERE service_key = 'kuajing84_material_cost';
    """)