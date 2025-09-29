"""
用户数据模型
"""
from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    BigInteger, String, Boolean, DateTime, JSON,
    ForeignKey, Index, UniqueConstraint, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ef_core.models.base import Base


class User(Base):
    """用户模型"""
    __tablename__ = "users"
    
    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger, 
        primary_key=True,
        comment="用户ID"
    )
    
    # 认证信息
    email: Mapped[str] = mapped_column(
        String(255), 
        unique=True, 
        nullable=False,
        comment="邮箱地址"
    )
    username: Mapped[Optional[str]] = mapped_column(
        String(50), 
        unique=True, 
        nullable=True,
        comment="用户名"
    )
    password_hash: Mapped[str] = mapped_column(
        String(255), 
        nullable=False,
        comment="密码哈希"
    )
    
    # 状态和权限
    is_active: Mapped[bool] = mapped_column(
        Boolean, 
        default=True, 
        nullable=False,
        comment="是否激活"
    )
    role: Mapped[str] = mapped_column(
        String(50), 
        nullable=False,
        default="viewer",
        comment="角色：admin/operator/viewer"
    )
    permissions: Mapped[dict] = mapped_column(
        JSON, 
        default=list,
        nullable=False,
        comment="权限列表"
    )
    
    # 多账号体系
    parent_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        comment="父账号ID"
    )

    # 店铺关联
    primary_shop_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("shops.id", ondelete="SET NULL"),
        nullable=True,
        comment="主店铺ID"
    )
    
    # 时间戳
    last_login_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最后登录时间"
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
    primary_shop = relationship("Shop", back_populates="primary_users", foreign_keys=[primary_shop_id])
    owned_shops = relationship("Shop", back_populates="owner", foreign_keys="Shop.owner_user_id")
    parent_user = relationship("User", remote_side=[id], foreign_keys=[parent_user_id], backref="sub_accounts")
    
    # 索引
    __table_args__ = (
        Index("ix_users_email", "email"),
        Index("ix_users_role", "role"),
        Index("ix_users_is_active", "is_active"),
    )
    
    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email}, role={self.role})>"
    
    def has_permission(self, permission: str) -> bool:
        """检查用户是否有指定权限"""
        if self.role == "admin":
            return True
        if "*" in self.permissions:
            return True
        return permission in self.permissions
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "email": self.email,
            "username": self.username,
            "role": self.role,
            "permissions": self.permissions,
            "is_active": self.is_active,
            "parent_user_id": self.parent_user_id,
            "primary_shop_id": self.primary_shop_id,
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }