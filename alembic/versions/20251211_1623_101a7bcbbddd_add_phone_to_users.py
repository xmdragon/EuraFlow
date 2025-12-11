"""add_phone_to_users

Revision ID: 101a7bcbbddd
Revises: add_user_sync_settings
Create Date: 2025-12-11 16:23:28.709432

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '101a7bcbbddd'
down_revision = 'add_user_sync_settings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """添加手机号字段到 users 表"""
    # 添加 phone 字段（可选，唯一索引）
    op.add_column('users', sa.Column('phone', sa.String(20), nullable=True, comment='手机号码'))

    # 创建唯一索引（允许 NULL 值，只对非空值做唯一约束）
    op.create_index('ix_users_phone', 'users', ['phone'], unique=True, postgresql_where=sa.text('phone IS NOT NULL'))


def downgrade() -> None:
    """移除手机号字段"""
    op.drop_index('ix_users_phone', table_name='users')
    op.drop_column('users', 'phone')
