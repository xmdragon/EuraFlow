"""refactor kuajing84 to global config

Revision ID: a1b2c3d4e5f6
Revises: ff5864c02457
Create Date: 2025-10-11 16:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'ff5864c02457'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 创建全局配置表
    op.create_table(
        'kuajing84_global_config',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('username', sa.String(100), nullable=True),
        sa.Column('password', sa.Text(), nullable=True, comment='加密存储'),
        sa.Column('base_url', sa.String(200), server_default='https://www.kuajing84.com'),
        sa.Column('cookie', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('cookie_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('enabled', sa.Boolean(), server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), onupdate=sa.text('CURRENT_TIMESTAMP')),
    )

    # 2. 移除 ozon_shops 表中的 kuajing84_config 字段
    op.drop_column('ozon_shops', 'kuajing84_config')


def downgrade() -> None:
    # 1. 恢复 ozon_shops 表中的 kuajing84_config 字段
    op.add_column(
        'ozon_shops',
        sa.Column(
            'kuajing84_config',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment='跨境巴士配置（用户名、密码、Cookie等）'
        )
    )

    # 2. 删除全局配置表
    op.drop_table('kuajing84_global_config')
