"""add_translation_support_to_chat_messages

Revision ID: 63f940b2e851
Revises: ec18764825d6
Create Date: 2025-10-24 18:35:52.126497

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '63f940b2e851'
down_revision = 'ec18764825d6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 1. 添加 data_cn 字段到 ozon_chat_messages 表
    op.add_column('ozon_chat_messages', sa.Column('data_cn', sa.Text(), nullable=True, comment='中文翻译'))

    # 2. 创建 aliyun_translation_configs 表
    op.create_table(
        'aliyun_translation_configs',
        sa.Column('id', sa.Integer(), nullable=False, comment='主键（固定为1）'),
        sa.Column('access_key_id', sa.String(length=100), nullable=True, comment='阿里云AccessKey ID'),
        sa.Column('access_key_secret_encrypted', sa.Text(), nullable=True, comment='加密的AccessKey Secret (TODO: 实现加密)'),
        sa.Column('region_id', sa.String(length=50), server_default='cn-hangzhou', nullable=False, comment='阿里云区域ID'),
        sa.Column('enabled', sa.Boolean(), server_default='false', nullable=False, comment='是否启用'),
        sa.Column('last_test_at', sa.DateTime(timezone=True), nullable=True, comment='最后测试连接时间'),
        sa.Column('last_test_success', sa.Boolean(), nullable=True, comment='最后测试是否成功'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除 aliyun_translation_configs 表
    op.drop_table('aliyun_translation_configs')

    # 移除 data_cn 字段
    op.drop_column('ozon_chat_messages', 'data_cn')