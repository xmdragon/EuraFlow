"""remove_temperature_from_chatgpt_config

Revision ID: ea9472b2b81e
Revises: a25ff1cbcef5
Create Date: 2025-11-07 12:09:54.738953

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ea9472b2b81e'
down_revision = 'a25ff1cbcef5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 删除 chatgpt_translation_configs 表的 temperature 字段
    op.drop_column('chatgpt_translation_configs', 'temperature')


def downgrade() -> None:
    """Downgrade database schema"""
    # 恢复 temperature 字段
    op.add_column(
        'chatgpt_translation_configs',
        sa.Column('temperature', sa.Numeric(precision=3, scale=2), nullable=False, server_default='0.2', comment='Temperature（翻译建议偏低，0.0-1.0）')
    )