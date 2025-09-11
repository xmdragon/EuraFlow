"""
店铺数据模型
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger, String, Text, DateTime, JSON,
    ForeignKey, UniqueConstraint, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ef_core.models.base import Base


class Shop(Base):
    """店铺模型"""
    __tablename__ = "shops"
    
    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger, 
        primary_key=True,
        comment="店铺ID"
    )
    
    # 基本信息
    name: Mapped[str] = mapped_column(
        String(100), 
        unique=True, 
        nullable=False,
        comment="店铺名称"
    )
    
    # 所有者
    owner_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        comment="店铺所有者ID"
    )
    
    # API密钥（加密存储）
    api_key_enc: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="加密的API密钥"
    )
    
    # 配置信息
    settings: Mapped[dict] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
        comment="店铺配置"
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
    owner = relationship("User", back_populates="owned_shops", foreign_keys=[owner_user_id])
    primary_users = relationship("User", back_populates="primary_shop", foreign_keys="User.primary_shop_id")
    
    def __repr__(self) -> str:
        return f"<Shop(id={self.id}, name={self.name})>"
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "name": self.name,
            "owner_user_id": self.owner_user_id,
            "has_api_key": bool(self.api_key_enc),
            "settings": self.settings,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }