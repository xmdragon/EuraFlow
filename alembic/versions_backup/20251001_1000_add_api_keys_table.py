"""add_api_keys_table

Revision ID: add_api_keys_001
Revises: fcd1c4e45967
Create Date: 2025-10-01 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_api_keys_001'
down_revision = 'fcd1c4e45967'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema - 创建api_keys表"""

    # 创建api_keys表
    op.create_table(
        'api_keys',
        sa.Column('id', sa.BigInteger(), nullable=False, comment='API Key ID'),
        sa.Column('user_id', sa.BigInteger(), nullable=False, comment='所属用户ID'),
        sa.Column('key_hash', sa.String(length=255), nullable=False, comment='API Key哈希值（bcrypt）'),
        sa.Column('name', sa.String(length=100), nullable=False, comment='Key名称（如：Tampermonkey脚本）'),
        sa.Column('permissions', postgresql.JSON(astext_type=sa.Text()), nullable=False, comment="权限列表，如['product_selection:write']"),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true', comment='是否激活'),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True, comment='最后使用时间'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True, comment='过期时间（可选）'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('key_hash', name='uq_api_keys_key_hash')
    )

    # 创建索引
    op.create_index('ix_api_keys_user_id', 'api_keys', ['user_id'])
    op.create_index('ix_api_keys_key_hash', 'api_keys', ['key_hash'])
    op.create_index('ix_api_keys_is_active', 'api_keys', ['is_active'])


def downgrade() -> None:
    """Downgrade database schema - 删除api_keys表"""

    # 删除索引
    op.drop_index('ix_api_keys_is_active', table_name='api_keys')
    op.drop_index('ix_api_keys_key_hash', table_name='api_keys')
    op.drop_index('ix_api_keys_user_id', table_name='api_keys')

    # 删除表
    op.drop_table('api_keys')
