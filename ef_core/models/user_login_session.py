"""
用户登录会话模型 - 用于单设备登录限制
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, String, Boolean, DateTime, Index, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ef_core.models.base import Base


class UserLoginSession(Base):
    """用户登录会话模型

    用于实现单设备登录限制：
    - 每次登录生成唯一会话令牌
    - 新设备登录时使旧会话失效
    - 记录设备信息用于审计
    """
    __tablename__ = "user_login_sessions"

    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="会话ID"
    )

    # 用户关联
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        comment="用户ID"
    )

    # 会话令牌
    session_token: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        nullable=False,
        comment="会话令牌（64位十六进制）"
    )

    # 设备信息
    device_info: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="设备信息"
    )
    ip_address: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="IP地址"
    )
    user_agent: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="User-Agent"
    )

    # 状态
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否活跃"
    )

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="创建时间"
    )
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="最后活动时间"
    )

    # 关系
    user = relationship("User", back_populates="login_sessions")

    # 索引
    __table_args__ = (
        Index("ix_user_login_sessions_user_id", "user_id"),
        Index("ix_user_login_sessions_session_token", "session_token"),
        Index("ix_user_login_sessions_is_active", "is_active"),
    )

    def __repr__(self) -> str:
        return f"<UserLoginSession(id={self.id}, user_id={self.user_id}, is_active={self.is_active})>"

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "session_token": self.session_token[:8] + "..." if self.session_token else None,  # 只显示前8位
            "device_info": self.device_info,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_activity_at": self.last_activity_at.isoformat() if self.last_activity_at else None,
        }
