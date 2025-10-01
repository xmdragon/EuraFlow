"""
API Key数据模型
用于Tampermonkey脚本等外部工具的身份认证
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger, String, Boolean, DateTime, JSON,
    ForeignKey, Index, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ef_core.models.base import Base


class APIKey(Base):
    """API密钥模型"""
    __tablename__ = "api_keys"

    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="API Key ID"
    )

    # 用户关联
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        comment="所属用户ID"
    )

    # Key信息
    key_hash: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        comment="API Key哈希值（bcrypt）"
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="Key名称（如：Tampermonkey脚本）"
    )

    # 权限和状态
    permissions: Mapped[dict] = mapped_column(
        JSON,
        default=list,
        nullable=False,
        comment="权限列表，如['product_selection:write']"
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否激活"
    )

    # 使用信息
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最后使用时间"
    )

    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="过期时间（可选）"
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
    user = relationship("User", back_populates="api_keys")

    # 索引
    __table_args__ = (
        Index("ix_api_keys_user_id", "user_id"),
        Index("ix_api_keys_key_hash", "key_hash"),
        Index("ix_api_keys_is_active", "is_active"),
    )

    def __repr__(self) -> str:
        return f"<APIKey(id={self.id}, name={self.name}, user_id={self.user_id})>"

    def to_dict(self, include_key_hash: bool = False) -> dict:
        """转换为字典（不包含敏感信息）"""
        data = {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "permissions": self.permissions,
            "is_active": self.is_active,
            "last_used_at": self.last_used_at.isoformat() if self.last_used_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }

        # 仅在明确要求时包含key_hash（用于验证）
        if include_key_hash:
            data["key_hash"] = self.key_hash

        return data
