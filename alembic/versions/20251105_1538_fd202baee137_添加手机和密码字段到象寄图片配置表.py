"""添加手机和密码字段到象寄图片配置表

Revision ID: fd202baee137
Revises: f23ee5835fef
Create Date: 2025-11-05 15:38:02.927816

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'fd202baee137'
down_revision = 'f23ee5835fef'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 phone 字段
    op.add_column('xiangjifanyi_configs', sa.Column('phone', sa.String(length=20), nullable=True, comment='手机号'))
    # 添加 password 字段
    op.add_column('xiangjifanyi_configs', sa.Column('password', sa.Text(), nullable=True, comment='密码 (TODO: 实现加密)'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除 password 字段
    op.drop_column('xiangjifanyi_configs', 'password')
    # 删除 phone 字段
    op.drop_column('xiangjifanyi_configs', 'phone')