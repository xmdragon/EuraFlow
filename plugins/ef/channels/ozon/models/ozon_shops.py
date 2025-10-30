"""
Ozon店铺数据模型
"""
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy import (
    BigInteger, String, Text, DateTime, JSON, Boolean,
    ForeignKey, UniqueConstraint, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.models.base import Base


class OzonShop(Base):
    """Ozon店铺模型"""
    __tablename__ = "ozon_shops"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "shop_name", name="uq_ozon_shop_owner_name"),
    )
    
    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger, 
        primary_key=True,
        comment="Ozon店铺ID"
    )
    
    # 基本信息
    shop_name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="店铺名称（俄文）"
    )

    shop_name_cn: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
        comment="店铺中文名称"
    )

    platform: Mapped[str] = mapped_column(
        String(50),
        default="ozon",
        nullable=False,
        comment="平台名称"
    )
    
    status: Mapped[str] = mapped_column(
        String(20),
        default="active",
        nullable=False,
        comment="店铺状态"
    )
    
    # 所有者
    owner_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        comment="店铺所有者ID"
    )
    
    # API凭证（加密存储）
    client_id: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="Ozon Client ID"
    )
    
    api_key_enc: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="加密的API Key"
    )
    
    # 配置信息
    config: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
        comment="店铺配置（Webhook、同步设置等）"
    )
    
    # 统计信息
    stats: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="店铺统计信息"
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
    
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最后同步时间"
    )
    
    # 关系
    owner = relationship("User", backref="ozon_shops", foreign_keys=[owner_user_id])
    
    def __repr__(self) -> str:
        # 使用 __dict__.get() 避免触发懒加载
        id_val = self.__dict__.get('id', '?')
        name_val = self.__dict__.get('shop_name', '?')
        status_val = self.__dict__.get('status', '?')
        return f"<OzonShop(id={id_val}, shop_name={name_val}, status={status_val})>"
    
    def to_dict(self, include_credentials: bool = False) -> dict:
        """转换为字典"""
        result = {
            "id": self.id,
            "shop_name": self.shop_name,
            "shop_name_cn": self.shop_name_cn,
            "display_name": self.shop_name_cn or self.shop_name,  # 优先显示中文名称
            "platform": self.platform,
            "status": self.status,
            "owner_user_id": self.owner_user_id,
            "config": self.config or {},
            "stats": self.stats,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
        }
        
        if include_credentials:
            result["api_credentials"] = {
                "client_id": self.client_id,
                "api_key": "******"  # 不显示真实的API key
            }
        
        return result