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
# 注意：外键已迁移为指向 ozon_shops.id（详见迁移脚本 20251023_1810_ec18764825d6）
user_shops = Table(
    'user_shops',
    Base.metadata,
    Column('user_id', BigInteger, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True, comment='用户ID'),
    Column('shop_id', BigInteger, ForeignKey('ozon_shops.id', ondelete='CASCADE'), primary_key=True, comment='店铺ID (指向ozon_shops)'),
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
        default="sub_account",
        comment="角色：admin/manager/sub_account"
    )
    permissions: Mapped[dict] = mapped_column(
        JSON,
        default=list,
        nullable=False,
        comment="权限列表"
    )

    # 管理员级别（仅 manager 角色使用）
    manager_level_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("manager_levels.id", ondelete="SET NULL"),
        nullable=True,
        comment="管理员级别ID"
    )

    # 账号状态（仅 manager/sub_account 使用，admin 不受限制）
    # active: 正常, suspended: 停用（可登录但不能写操作）, disabled: 禁用（不能登录）
    account_status: Mapped[str] = mapped_column(
        String(20),
        default="active",
        nullable=False,
        comment="账号状态：active/suspended/disabled"
    )

    # 账号过期时间（仅 manager/sub_account 使用）
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="账号过期时间，NULL表示永不过期"
    )

    # 多账号体系
    parent_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        comment="父账号ID"
    )

    # 单设备登录 - 当前活跃会话令牌
    current_session_token: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        comment="当前活跃会话令牌"
    )

    # 店铺关联
    # 注意：外键已迁移为指向 ozon_shops.id（详见迁移脚本 20251023_1810_ec18764825d6）
    primary_shop_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("ozon_shops.id", ondelete="SET NULL"),
        nullable=True,
        comment="主店铺ID (指向ozon_shops)"
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
    # 注意：已迁移为使用 OzonShop 模型（详见迁移脚本 20251023_1810_ec18764825d6）
    primary_shop = relationship("OzonShop", foreign_keys=[primary_shop_id])
    parent_user = relationship("User", remote_side=[id], foreign_keys=[parent_user_id], backref="sub_accounts")
    api_keys = relationship("APIKey", back_populates="user", cascade="all, delete-orphan")
    # 用户关联的店铺（多对多）
    shops = relationship("OzonShop", secondary=user_shops, backref="associated_users")
    # 管理员级别
    manager_level = relationship("ManagerLevel", back_populates="users")
    # 登录会话
    login_sessions = relationship("UserLoginSession", back_populates="user", cascade="all, delete-orphan")
    
    # 索引
    __table_args__ = (
        Index("ix_users_role", "role"),
        Index("ix_users_is_active", "is_active"),
    )
    
    def __repr__(self) -> str:
        # Use __dict__.get() to avoid lazy loading
        id_val = self.__dict__.get('id', '?')
        username_val = self.__dict__.get('username', '?')
        role_val = self.__dict__.get('role', '?')
        return f"<User(id={id_val}, username={username_val}, role={role_val})>"
    
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
            "username": self.username,
            "role": self.role,
            "permissions": self.permissions,
            "is_active": self.is_active,
            "account_status": self.account_status,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "parent_user_id": self.parent_user_id,
            "primary_shop_id": self.primary_shop_id,
            "manager_level_id": self.manager_level_id,
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }

    def get_effective_account_status(self) -> str:
        """获取有效的账号状态（子账号继承管理员状态）"""
        if self.role == "sub_account" and self.parent_user:
            return self.parent_user.account_status
        return self.account_status

    def get_effective_expires_at(self):
        """获取有效的过期时间（子账号继承管理员过期时间）"""
        if self.role == "sub_account" and self.parent_user:
            return self.parent_user.expires_at
        return self.expires_at

    def is_expired(self) -> bool:
        """检查账号是否已过期"""
        from datetime import datetime, timezone
        expires_at = self.get_effective_expires_at()
        if expires_at is None:
            return False
        return datetime.now(timezone.utc) > expires_at

    def can_login(self) -> tuple[bool, str]:
        """检查是否可以登录，返回 (可以登录, 错误消息)"""
        # admin 不受限制
        if self.role == "admin":
            return True, ""

        # 检查账号状态
        status = self.get_effective_account_status()
        if status == "disabled":
            return False, "账号已禁用"

        # 检查是否过期
        if self.is_expired():
            return False, "账号已过期"

        return True, ""

    def can_write(self) -> tuple[bool, str]:
        """检查是否可以执行写操作，返回 (可以写, 错误消息)"""
        # admin 不受限制
        if self.role == "admin":
            return True, ""

        # 检查账号状态
        status = self.get_effective_account_status()
        if status == "disabled":
            return False, "账号已禁用"
        if status == "suspended":
            return False, "账号已到期"

        # 检查是否过期
        if self.is_expired():
            return False, "账号已过期"

        return True, ""


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
    display_shop_name_format: Mapped[str] = mapped_column(
        String(10),
        default="both",
        nullable=False,
        comment="店铺名称显示格式：ru(俄文)/cn(中文)/both(俄文【中文】)"
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
        # Use __dict__.get() to avoid lazy loading
        user_id_val = self.__dict__.get('user_id', '?')
        currency_val = self.__dict__.get('display_currency', '?')
        return f"<UserSettings(user_id={user_id_val}, currency={currency_val})>"

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
                "shop_name_format": self.display_shop_name_format,
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
            display_shop_name_format=display.get("shop_name_format", "both"),
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
        if "shop_name_format" in display:
            self.display_shop_name_format = display["shop_name_format"]

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