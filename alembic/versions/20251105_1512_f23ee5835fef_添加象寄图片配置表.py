"""添加象寄图片配置表

Revision ID: f23ee5835fef
Revises: 6b574meopj8k
Create Date: 2025-11-05 15:12:30.679696

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f23ee5835fef'
down_revision = '6b574meopj8k'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 创建 xiangjifanyi_configs 表
    op.create_table(
        'xiangjifanyi_configs',
        sa.Column('id', sa.Integer(), nullable=False, comment='主键（固定为1）'),
        sa.Column('api_url', sa.String(length=255), nullable=True, comment='API地址'),
        sa.Column('user_key', sa.Text(), nullable=True, comment='私人密钥 (TODO: 实现加密)'),
        sa.Column('video_trans_key', sa.Text(), nullable=True, comment='视频翻译密钥 (TODO: 实现加密)'),
        sa.Column('fetch_key', sa.Text(), nullable=True, comment='商品解析密钥 (TODO: 实现加密)'),
        sa.Column('img_trans_key', sa.Text(), nullable=True, comment='图片翻译密钥 (TODO: 实现加密)'),
        sa.Column('img_matting_key', sa.Text(), nullable=True, comment='智能抠图密钥 (TODO: 实现加密)'),
        sa.Column('text_trans_key', sa.Text(), nullable=True, comment='文本翻译密钥 (TODO: 实现加密)'),
        sa.Column('aigc_key', sa.Text(), nullable=True, comment='智能生成密钥 (TODO: 实现加密)'),
        sa.Column('enabled', sa.Boolean(), server_default='false', nullable=False, comment='是否启用'),
        sa.Column('last_test_at', sa.DateTime(timezone=True), nullable=True, comment='最后测试连接时间'),
        sa.Column('last_test_success', sa.Boolean(), nullable=True, comment='最后测试是否成功'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除 xiangjifanyi_configs 表
    op.drop_table('xiangjifanyi_configs')