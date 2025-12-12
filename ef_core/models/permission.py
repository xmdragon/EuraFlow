"""
权限管理数据模型

RBAC (Role-Based Access Control) 权限模型：
- Role: 角色（admin, main_account, sub_account, shipper, 自定义角色）
- APIPermission: API 权限定义
- RolePermission: 角色-权限关联
"""
from datetime import datetime
from typing import Optional, List, TYPE_CHECKING

from sqlalchemy import (
    BigInteger, String, Boolean, DateTime, Text, Integer,
    ForeignKey, Index, UniqueConstraint, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ef_core.models.base import Base

if TYPE_CHECKING:
    from ef_core.models.users import User


class Role(Base):
    """角色模型"""
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="角色ID"
    )
    name: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        comment="角色标识符（admin, main_account, custom_role）"
    )
    display_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="显示名称"
    )
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="角色描述"
    )
    is_system: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否为系统内置角色（不可删除）"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否启用"
    )
    priority: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="优先级（用于显示排序，数字越大越靠前）"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        comment="更新时间"
    )

    # 关系
    role_permissions: Mapped[List["RolePermission"]] = relationship(
        "RolePermission",
        back_populates="role",
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_roles_name", "name"),
        Index("ix_roles_is_active", "is_active"),
        {"comment": "角色表"}
    )

    def __repr__(self) -> str:
        return f"<Role(id={self.id}, name='{self.name}')>"


class APIPermission(Base):
    """API 权限模型"""
    __tablename__ = "api_permissions"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="权限ID"
    )
    code: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
        comment="权限代码（ozon.orders.list）"
    )
    name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="权限名称"
    )
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="权限描述"
    )
    module: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="模块（ozon, system, auth）"
    )
    category: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="分类（orders, products, shops）"
    )
    http_method: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        comment="HTTP方法（GET, POST, PUT, DELETE, *）"
    )
    path_pattern: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        comment="路径模式（/api/ef/v1/ozon/orders/*）"
    )
    is_public: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否为公开API（无需登录）"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否启用"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="排序顺序"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        comment="更新时间"
    )

    # 关系
    role_permissions: Mapped[List["RolePermission"]] = relationship(
        "RolePermission",
        back_populates="permission",
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_api_permissions_code", "code"),
        Index("ix_api_permissions_module", "module"),
        Index("ix_api_permissions_method_path", "http_method", "path_pattern"),
        {"comment": "API权限表"}
    )

    def __repr__(self) -> str:
        return f"<APIPermission(id={self.id}, code='{self.code}')>"


class RolePermission(Base):
    """角色权限关联表"""
    __tablename__ = "role_permissions"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="关联ID"
    )
    role_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("roles.id", ondelete="CASCADE"),
        nullable=False,
        comment="角色ID"
    )
    permission_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("api_permissions.id", ondelete="CASCADE"),
        nullable=False,
        comment="权限ID"
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="授权时间"
    )
    granted_by: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        comment="授权人ID"
    )

    # 关系
    role: Mapped["Role"] = relationship(
        "Role",
        back_populates="role_permissions"
    )
    permission: Mapped["APIPermission"] = relationship(
        "APIPermission",
        back_populates="role_permissions"
    )
    granted_by_user: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[granted_by]
    )

    __table_args__ = (
        UniqueConstraint("role_id", "permission_id", name="uq_role_permission"),
        Index("ix_role_permissions_role_id", "role_id"),
        Index("ix_role_permissions_permission_id", "permission_id"),
        {"comment": "角色权限关联表"}
    )

    def __repr__(self) -> str:
        return f"<RolePermission(role_id={self.role_id}, permission_id={self.permission_id})>"
