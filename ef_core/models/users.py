"""
用户数据模型
"""
from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    BigInteger, String, Boolean, DateTime, JSON, Integer,
    ForeignKey, Index, UniqueConstraint, func, Table, Column
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ef_core.models.base import Base


# 用户-店铺关联表（多对多）
user_shops = Table(
    'user_shops',
    Base.metadata,
    Column('user_id', BigInteger, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True, comment='用户ID'),
    Column('shop_id', BigInteger, ForeignKey('shops.id', ondelete='CASCADE'), primary_key=True, comment='店铺ID'),
    Column('created_at', DateTime(timezone=True), server_default=func.now(), nullable=False, comment='关联创建时间')
)


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
    username: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        comment="用户名"
    )
    email: Mapped[Optional[str]] = mapped_column(
        String(255),
        unique=False,
        nullable=True,
        comment="邮箱地址（选填）"
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
    api_keys = relationship("APIKey", back_populates="user", cascade="all, delete-orphan")
    # 用户关联的店铺（多对多）
    shops = relationship("Shop", secondary=user_shops, backref="associated_users")
    
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


class UserSettings(Base):
    """用户设置模型"""
    __tablename__ = "user_settings"

    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="设置ID"
    )

    # 用户关联（一对一）
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        comment="用户ID"
    )

    # 通知设置
    notifications_email: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="邮件通知"
    )
    notifications_browser: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="浏览器通知"
    )
    notifications_order_updates: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="订单更新通知"
    )
    notifications_price_alerts: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="价格预警通知"
    )
    notifications_inventory_alerts: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="库存预警通知"
    )

    # 显示设置
    display_language: Mapped[str] = mapped_column(
        String(10),
        default="zh-CN",
        nullable=False,
        comment="界面语言"
    )
    display_timezone: Mapped[str] = mapped_column(
        String(50),
        default="Asia/Shanghai",
        nullable=False,
        comment="时区"
    )
    display_currency: Mapped[str] = mapped_column(
        String(3),
        default="RUB",
        nullable=False,
        comment="默认货币：RUB/CNY/USD/EUR"
    )
    display_date_format: Mapped[str] = mapped_column(
        String(20),
        default="YYYY-MM-DD",
        nullable=False,
        comment="日期格式"
    )

    # 同步设置
    sync_auto_sync: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="自动同步"
    )
    sync_interval: Mapped[int] = mapped_column(
        Integer,
        default=60,
        nullable=False,
        comment="同步间隔（分钟）"
    )
    sync_on_login: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="登录时同步"
    )

    # 安全设置
    security_two_factor_auth: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="双因素认证"
    )
    security_session_timeout: Mapped[int] = mapped_column(
        Integer,
        default=30,
        nullable=False,
        comment="会话超时（分钟）"
    )

    # 时间戳
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
    user = relationship("User", backref="settings")

    # 索引
    __table_args__ = (
        Index("ix_user_settings_user_id", "user_id"),
    )

    def __repr__(self) -> str:
        return f"<UserSettings(user_id={self.user_id}, currency={self.display_currency})>"

    def to_dict(self) -> dict:
        """转换为字典（按前端格式分组）"""
        return {
            "notifications": {
                "email": self.notifications_email,
                "browser": self.notifications_browser,
                "order_updates": self.notifications_order_updates,
                "price_alerts": self.notifications_price_alerts,
                "inventory_alerts": self.notifications_inventory_alerts,
            },
            "display": {
                "language": self.display_language,
                "timezone": self.display_timezone,
                "currency": self.display_currency,
                "date_format": self.display_date_format,
            },
            "sync": {
                "auto_sync": self.sync_auto_sync,
                "sync_interval": self.sync_interval,
                "sync_on_login": self.sync_on_login,
            },
            "security": {
                "two_factor_auth": self.security_two_factor_auth,
                "session_timeout": self.security_session_timeout,
            },
        }

    @classmethod
    def from_dict(cls, user_id: int, data: dict) -> "UserSettings":
        """从字典创建（接受前端格式）"""
        notifications = data.get("notifications", {})
        display = data.get("display", {})
        sync = data.get("sync", {})
        security = data.get("security", {})

        return cls(
            user_id=user_id,
            # 通知设置
            notifications_email=notifications.get("email", True),
            notifications_browser=notifications.get("browser", True),
            notifications_order_updates=notifications.get("order_updates", True),
            notifications_price_alerts=notifications.get("price_alerts", True),
            notifications_inventory_alerts=notifications.get("inventory_alerts", True),
            # 显示设置
            display_language=display.get("language", "zh-CN"),
            display_timezone=display.get("timezone", "Asia/Shanghai"),
            display_currency=display.get("currency", "RUB"),
            display_date_format=display.get("date_format", "YYYY-MM-DD"),
            # 同步设置
            sync_auto_sync=sync.get("auto_sync", True),
            sync_interval=sync.get("sync_interval", 60),
            sync_on_login=sync.get("sync_on_login", True),
            # 安全设置
            security_two_factor_auth=security.get("two_factor_auth", False),
            security_session_timeout=security.get("session_timeout", 30),
        )

    def update_from_dict(self, data: dict) -> None:
        """从字典更新（接受前端格式）"""
        notifications = data.get("notifications", {})
        display = data.get("display", {})
        sync = data.get("sync", {})
        security = data.get("security", {})

        # 更新通知设置
        if "email" in notifications:
            self.notifications_email = notifications["email"]
        if "browser" in notifications:
            self.notifications_browser = notifications["browser"]
        if "order_updates" in notifications:
            self.notifications_order_updates = notifications["order_updates"]
        if "price_alerts" in notifications:
            self.notifications_price_alerts = notifications["price_alerts"]
        if "inventory_alerts" in notifications:
            self.notifications_inventory_alerts = notifications["inventory_alerts"]

        # 更新显示设置
        if "language" in display:
            self.display_language = display["language"]
        if "timezone" in display:
            self.display_timezone = display["timezone"]
        if "currency" in display:
            self.display_currency = display["currency"]
        if "date_format" in display:
            self.display_date_format = display["date_format"]

        # 更新同步设置
        if "auto_sync" in sync:
            self.sync_auto_sync = sync["auto_sync"]
        if "sync_interval" in sync:
            self.sync_interval = sync["sync_interval"]
        if "sync_on_login" in sync:
            self.sync_on_login = sync["sync_on_login"]

        # 更新安全设置
        if "two_factor_auth" in security:
            self.security_two_factor_auth = security["two_factor_auth"]
        if "session_timeout" in security:
            self.security_session_timeout = security["session_timeout"]