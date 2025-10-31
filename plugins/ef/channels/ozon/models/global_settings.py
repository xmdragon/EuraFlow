"""
Ozon全局设置数据模型
"""
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy import String, DateTime, func, Index
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.models.base import Base


class OzonGlobalSetting(Base):
    """Ozon全局设置模型"""
    __tablename__ = "ozon_global_settings"
    __table_args__ = (
        Index("idx_ozon_global_settings_key", "setting_key", unique=True),
    )

    # 主键
    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
        comment="设置ID"
    )

    # 设置键
    setting_key: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
        comment="设置键（如：api_rate_limit）"
    )

    # 设置值（JSONB存储，支持复杂结构）
    setting_value: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        comment="设置值（JSONB格式）"
    )

    # 描述
    description: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="设置描述"
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

    def __repr__(self) -> str:
        key_val = self.__dict__.get('setting_key', '?')
        return f"<OzonGlobalSetting(key={key_val})>"

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "setting_key": self.setting_key,
            "setting_value": self.setting_value,
            "description": self.description,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
