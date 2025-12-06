"""add_translation_engine_switching

Revision ID: a25ff1cbcef5
Revises: 0e11d310c8b3
Create Date: 2025-11-07 09:37:59.307942

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a25ff1cbcef5'
down_revision = '0e11d310c8b3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 1. 给 aliyun_translation_configs 添加 is_default 字段
    op.add_column(
        'aliyun_translation_configs',
        sa.Column(
            'is_default',
            sa.Boolean(),
            nullable=False,
            server_default='true',
            comment='是否为默认翻译引擎'
        )
    )

    # 2. 创建 chatgpt_translation_configs 表
    op.create_table(
        'chatgpt_translation_configs',
        sa.Column('id', sa.Integer(), nullable=False, comment='主键（固定为1）'),
        sa.Column('api_key_encrypted', sa.Text(), nullable=True, comment='加密的 OpenAI API Key (TODO: 实现加密)'),
        sa.Column('base_url', sa.String(length=255), nullable=True, comment='API Base URL（可选，默认为官方地址）'),
        sa.Column('model_name', sa.String(length=100), nullable=False, server_default='gpt-5-mini', comment='模型名称（默认 gpt-5-mini）'),
        sa.Column('temperature', sa.Numeric(precision=3, scale=2), nullable=False, server_default='0.2', comment='Temperature（翻译建议偏低，0.0-1.0）'),
        sa.Column('system_prompt', sa.Text(), nullable=False, server_default=sa.text("'你是一名专业的中俄互译翻译器。\n- 所有输出只包含译文，不要任何解释、前后缀或引号。\n- 保持原文的语气和礼貌程度。\n- 优先使用地道、口语化但自然的表达，适合电商、社交、即时通讯场景。\n- 如果输入中文，就翻译成俄文；如果输入俄文，就翻译成中文。'"), comment='System Prompt（翻译规则）'),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='false', comment='是否启用'),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default='false', comment='是否为默认翻译引擎'),
        sa.Column('last_test_at', sa.DateTime(timezone=True), nullable=True, comment='最后测试连接时间'),
        sa.Column('last_test_success', sa.Boolean(), nullable=True, comment='最后测试是否成功'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()'), comment='更新时间'),
        sa.PrimaryKeyConstraint('id')
    )

    # 3. 创建索引以优化查询
    op.create_index(
        'idx_aliyun_translation_is_default',
        'aliyun_translation_configs',
        ['is_default', 'enabled']
    )

    op.create_index(
        'idx_chatgpt_translation_is_default',
        'chatgpt_translation_configs',
        ['is_default', 'enabled']
    )


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除索引
    op.drop_index('idx_chatgpt_translation_is_default', table_name='chatgpt_translation_configs')
    op.drop_index('idx_aliyun_translation_is_default', table_name='aliyun_translation_configs')

    # 删除 chatgpt_translation_configs 表
    op.drop_table('chatgpt_translation_configs')

    # 删除 aliyun_translation_configs 的 is_default 字段
    op.drop_column('aliyun_translation_configs', 'is_default')