"""add permission system

Revision ID: add_permission_system
Revises: 10ce9056f39b
Create Date: 2025-12-12 16:28:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_permission_system'
down_revision: Union[str, None] = '10ce9056f39b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """创建权限管理系统表"""

    # 1. 创建角色表
    op.create_table(
        'roles',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False, comment='角色ID'),
        sa.Column('name', sa.String(length=50), nullable=False, comment='角色标识符'),
        sa.Column('display_name', sa.String(length=100), nullable=False, comment='显示名称'),
        sa.Column('description', sa.Text(), nullable=True, comment='角色描述'),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否为系统内置角色'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true'), comment='是否启用'),
        sa.Column('priority', sa.Integer(), nullable=False, server_default=sa.text('0'), comment='优先级'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
        comment='角色表'
    )
    op.create_index('ix_roles_name', 'roles', ['name'], unique=False)
    op.create_index('ix_roles_is_active', 'roles', ['is_active'], unique=False)

    # 2. 创建 API 权限表
    op.create_table(
        'api_permissions',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False, comment='权限ID'),
        sa.Column('code', sa.String(length=100), nullable=False, comment='权限代码'),
        sa.Column('name', sa.String(length=200), nullable=False, comment='权限名称'),
        sa.Column('description', sa.Text(), nullable=True, comment='权限描述'),
        sa.Column('module', sa.String(length=50), nullable=False, comment='模块'),
        sa.Column('category', sa.String(length=50), nullable=True, comment='分类'),
        sa.Column('http_method', sa.String(length=10), nullable=False, comment='HTTP方法'),
        sa.Column('path_pattern', sa.String(length=500), nullable=False, comment='路径模式'),
        sa.Column('is_public', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否为公开API'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true'), comment='是否启用'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default=sa.text('0'), comment='排序顺序'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'),
        comment='API权限表'
    )
    op.create_index('ix_api_permissions_code', 'api_permissions', ['code'], unique=False)
    op.create_index('ix_api_permissions_module', 'api_permissions', ['module'], unique=False)
    op.create_index('ix_api_permissions_method_path', 'api_permissions', ['http_method', 'path_pattern'], unique=False)

    # 3. 创建角色权限关联表
    op.create_table(
        'role_permissions',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False, comment='关联ID'),
        sa.Column('role_id', sa.BigInteger(), nullable=False, comment='角色ID'),
        sa.Column('permission_id', sa.BigInteger(), nullable=False, comment='权限ID'),
        sa.Column('granted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False, comment='授权时间'),
        sa.Column('granted_by', sa.BigInteger(), nullable=True, comment='授权人ID'),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['permission_id'], ['api_permissions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['granted_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('role_id', 'permission_id', name='uq_role_permission'),
        comment='角色权限关联表'
    )
    op.create_index('ix_role_permissions_role_id', 'role_permissions', ['role_id'], unique=False)
    op.create_index('ix_role_permissions_permission_id', 'role_permissions', ['permission_id'], unique=False)

    # 4. 初始化系统角色
    op.execute("""
        INSERT INTO roles (name, display_name, description, is_system, is_active, priority) VALUES
        ('admin', '超级管理员', '系统最高权限，可访问所有功能', true, true, 100),
        ('main_account', '主账号', '店铺主账号，可管理店铺和子账号', true, true, 50),
        ('sub_account', '子账号', '受限账号，由主账号创建和管理', true, true, 10),
        ('shipper', '发货员', '专职发货人员，仅能操作发货相关功能', true, true, 20),
        ('extension', '浏览器扩展', '浏览器扩展专用账号，仅能访问选品相关API', true, true, 5)
    """)


def downgrade() -> None:
    """删除权限管理系统表"""
    op.drop_table('role_permissions')
    op.drop_table('api_permissions')
    op.drop_table('roles')
