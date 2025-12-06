"""Create users and shops tables

Revision ID: create_users_and_shops
Revises: 156bb55c528c
Create Date: 2025-09-08 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'create_users_and_shops'
down_revision: Union[str, None] = '156bb55c528c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create users and shops tables with proper foreign key handling"""
    
    # 先创建users表（不带primary_shop_id外键）
    op.create_table('users',
        sa.Column('id', sa.BigInteger(), nullable=False, comment='用户ID'),
        sa.Column('email', sa.String(length=255), nullable=False, comment='邮箱地址'),
        sa.Column('username', sa.String(length=50), nullable=True, comment='用户名'),
        sa.Column('password_hash', sa.String(length=255), nullable=False, comment='密码哈希'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true', comment='是否激活'),
        sa.Column('role', sa.String(length=50), nullable=False, server_default='viewer', comment='角色：admin/operator/viewer'),
        sa.Column('permissions', sa.JSON(), nullable=False, server_default='[]', comment='权限列表'),
        sa.Column('primary_shop_id', sa.BigInteger(), nullable=True, comment='主店铺ID'),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True, comment='最后登录时间'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
        sa.UniqueConstraint('username')
    )
    
    # 创建shops表（带owner_user_id外键）
    op.create_table('shops',
        sa.Column('id', sa.BigInteger(), nullable=False, comment='店铺ID'),
        sa.Column('name', sa.String(length=100), nullable=False, comment='店铺名称'),
        sa.Column('owner_user_id', sa.BigInteger(), nullable=False, comment='店铺所有者ID'),
        sa.Column('api_key_enc', sa.Text(), nullable=True, comment='加密的API密钥'),
        sa.Column('settings', sa.JSON(), nullable=False, server_default='{}', comment='店铺配置'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
    )
    
    # 现在添加users表的primary_shop_id外键
    op.create_foreign_key('fk_users_primary_shop_id', 'users', 'shops', ['primary_shop_id'], ['id'], ondelete='SET NULL')
    
    # 创建索引
    op.create_index('ix_users_email', 'users', ['email'], unique=False)
    op.create_index('ix_users_is_active', 'users', ['is_active'], unique=False)
    op.create_index('ix_users_role', 'users', ['role'], unique=False)
    
    # 创建admin用户种子数据
    from sqlalchemy import text
    import os
    import bcrypt

    # 从环境变量获取admin密码，默认为admin123
    admin_password = os.getenv('EF__ADMIN_PASSWORD', 'admin123')
    admin_email = os.getenv('EF__ADMIN_EMAIL', 'admin@euraflow.com')

    # 直接使用 bcrypt 避免 passlib 初始化问题
    # 这样生成的哈希值与 passlib 格式相同，可以被正常验证
    password_bytes = admin_password.encode('utf-8')
    password_hash = bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode('utf-8')
    
    # 插入admin用户
    conn = op.get_bind()
    conn.execute(
        text(f"""
            INSERT INTO users (email, username, password_hash, is_active, role, permissions) 
            VALUES ('{admin_email}', 'admin', '{password_hash}', true, 'admin', '["*"]')
        """)
    )


def downgrade() -> None:
    """Drop users and shops tables"""
    
    # 删除索引
    op.drop_index('ix_users_role', table_name='users')
    op.drop_index('ix_users_is_active', table_name='users')
    op.drop_index('ix_users_email', table_name='users')
    
    # 删除外键约束
    op.drop_constraint('fk_users_primary_shop_id', 'users', type_='foreignkey')
    
    # 删除表（顺序很重要）
    op.drop_table('shops')
    op.drop_table('users')