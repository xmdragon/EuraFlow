"""user_module_refactor_add_manager_levels_and_sessions

用户模块重构：
1. 新增 manager_levels 表（管理员级别）
2. 新增 user_login_sessions 表（登录会话）
3. 修改 users 表，新增 manager_level_id 和 current_session_token 字段
4. 数据迁移：operator/viewer -> manager

Revision ID: user_refactor_001
Revises: b075ca2e5eb9
Create Date: 2025-12-09

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'user_refactor_001'
down_revision = 'b075ca2e5eb9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""

    # 1. 创建 manager_levels 表
    op.create_table(
        'manager_levels',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('name', sa.String(50), unique=True, nullable=False, comment='级别名称（唯一标识）'),
        sa.Column('alias', sa.String(50), nullable=True, comment='级别别名（显示用）'),
        sa.Column('max_sub_accounts', sa.Integer(), nullable=False, default=5, comment='子账号数量限额'),
        sa.Column('max_shops', sa.Integer(), nullable=False, default=10, comment='店铺数量限额'),
        sa.Column('extra_config', sa.JSON(), nullable=False, server_default='{}', comment='扩展配置'),
        sa.Column('is_default', sa.Boolean(), nullable=False, default=False, comment='是否为默认级别'),
        sa.Column('sort_order', sa.Integer(), nullable=False, default=0, comment='排序顺序'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # 2. 创建 user_login_sessions 表
    op.create_table(
        'user_login_sessions',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('user_id', sa.BigInteger(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, comment='用户ID'),
        sa.Column('session_token', sa.String(64), unique=True, nullable=False, comment='会话令牌'),
        sa.Column('device_info', sa.String(500), nullable=True, comment='设备信息'),
        sa.Column('ip_address', sa.String(50), nullable=True, comment='IP地址'),
        sa.Column('user_agent', sa.String(500), nullable=True, comment='User-Agent'),
        sa.Column('is_active', sa.Boolean(), nullable=False, default=True, comment='是否活跃'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('last_activity_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_user_login_sessions_user_id', 'user_login_sessions', ['user_id'])
    op.create_index('ix_user_login_sessions_session_token', 'user_login_sessions', ['session_token'])
    op.create_index('ix_user_login_sessions_is_active', 'user_login_sessions', ['is_active'])

    # 3. 修改 users 表，新增字段
    op.add_column('users', sa.Column('manager_level_id', sa.BigInteger(), nullable=True, comment='管理员级别ID'))
    op.add_column('users', sa.Column('current_session_token', sa.String(64), nullable=True, comment='当前活跃会话令牌'))

    # 添加外键约束
    op.create_foreign_key(
        'fk_users_manager_level_id',
        'users', 'manager_levels',
        ['manager_level_id'], ['id'],
        ondelete='SET NULL'
    )

    # 4. 插入默认管理员级别
    op.execute("""
        INSERT INTO manager_levels (name, alias, max_sub_accounts, max_shops, is_default, sort_order, extra_config)
        VALUES ('standard', '标准管理员', 10, 20, true, 1, '{}')
    """)

    # 5. 数据迁移：operator/viewer -> manager，绑定默认级别
    op.execute("""
        UPDATE users
        SET role = 'manager',
            manager_level_id = (SELECT id FROM manager_levels WHERE is_default = true LIMIT 1)
        WHERE role IN ('operator', 'viewer')
    """)


def downgrade() -> None:
    """Downgrade database schema"""

    # 1. 回滚数据：manager -> operator（保持兼容）
    op.execute("""
        UPDATE users SET role = 'operator' WHERE role = 'manager'
    """)

    # 2. 删除外键约束
    op.drop_constraint('fk_users_manager_level_id', 'users', type_='foreignkey')

    # 3. 删除 users 表新增的字段
    op.drop_column('users', 'current_session_token')
    op.drop_column('users', 'manager_level_id')

    # 4. 删除 user_login_sessions 表
    op.drop_index('ix_user_login_sessions_is_active', 'user_login_sessions')
    op.drop_index('ix_user_login_sessions_session_token', 'user_login_sessions')
    op.drop_index('ix_user_login_sessions_user_id', 'user_login_sessions')
    op.drop_table('user_login_sessions')

    # 5. 删除 manager_levels 表
    op.drop_table('manager_levels')
