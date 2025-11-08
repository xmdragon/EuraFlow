"""拆分图片翻译密钥为多个供应商字段

Revision ID: a5d2a3cbe7b5
Revises: fd202baee137
Create Date: 2025-11-05 15:53:11.770489

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a5d2a3cbe7b5'
down_revision = 'fd202baee137'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 删除旧的 img_trans_key 字段
    op.drop_column('xiangjifanyi_configs', 'img_trans_key')

    # 添加新的图片翻译供应商字段
    op.add_column('xiangjifanyi_configs', sa.Column('img_trans_key_ali', sa.Text(), nullable=True, comment='图片翻译-阿里标识码 (TODO: 实现加密)'))
    op.add_column('xiangjifanyi_configs', sa.Column('img_trans_key_google', sa.Text(), nullable=True, comment='图片翻译-谷歌标识码 (TODO: 实现加密)'))
    op.add_column('xiangjifanyi_configs', sa.Column('img_trans_key_papago', sa.Text(), nullable=True, comment='图片翻译-Papago标识码 (TODO: 实现加密)'))
    op.add_column('xiangjifanyi_configs', sa.Column('img_trans_key_deepl', sa.Text(), nullable=True, comment='图片翻译-DeepL标识码 (TODO: 实现加密)'))
    op.add_column('xiangjifanyi_configs', sa.Column('img_trans_key_chatgpt', sa.Text(), nullable=True, comment='图片翻译-ChatGPT标识码 (TODO: 实现加密)'))
    op.add_column('xiangjifanyi_configs', sa.Column('img_trans_key_baidu', sa.Text(), nullable=True, comment='图片翻译-百度标识码 (TODO: 实现加密)'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除新字段
    op.drop_column('xiangjifanyi_configs', 'img_trans_key_baidu')
    op.drop_column('xiangjifanyi_configs', 'img_trans_key_chatgpt')
    op.drop_column('xiangjifanyi_configs', 'img_trans_key_deepl')
    op.drop_column('xiangjifanyi_configs', 'img_trans_key_papago')
    op.drop_column('xiangjifanyi_configs', 'img_trans_key_google')
    op.drop_column('xiangjifanyi_configs', 'img_trans_key_ali')

    # 恢复旧字段
    op.add_column('xiangjifanyi_configs', sa.Column('img_trans_key', sa.Text(), nullable=True, comment='图片翻译密钥 (TODO: 实现加密)'))