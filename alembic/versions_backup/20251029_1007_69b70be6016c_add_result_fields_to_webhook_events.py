"""add_result_fields_to_webhook_events

Revision ID: 69b70be6016c
Revises: 491abd05714d
Create Date: 2025-10-29 10:07:00.596110

变更说明：
给 ozon_webhook_events 表添加处理结果字段，用于日志管理功能：
1. result_message: 处理结果摘要（便于快速了解处理结果）
2. processing_duration_ms: 处理耗时（毫秒）（用于性能监控）
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '69b70be6016c'
down_revision = '491abd05714d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 给 ozon_webhook_events 表添加处理结果字段
    op.add_column('ozon_webhook_events', sa.Column(
        'result_message',
        sa.String(500),
        nullable=True,
        comment='处理结果摘要（成功、失败原因等）'
    ))
    op.add_column('ozon_webhook_events', sa.Column(
        'processing_duration_ms',
        sa.Integer(),
        nullable=True,
        comment='处理耗时（毫秒）'
    ))


def downgrade() -> None:
    """Downgrade database schema"""
    # 移除添加的字段
    op.drop_column('ozon_webhook_events', 'processing_duration_ms')
    op.drop_column('ozon_webhook_events', 'result_message')