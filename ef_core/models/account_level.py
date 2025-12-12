"""
主账号级别模型
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, String, Integer, Boolean, DateTime, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ef_core.models.base import Base


class AccountLevel(Base):
    """主账号级别模型

    用于定义不同级别的主账号配额限制，包括：
    - 子账号数量限额
    - 店铺数量限额
    - 扩展配置（预留）
    """
    __tablename__ = "account_levels"

    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="级别ID"
    )

    # 基本信息
    name: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        comment="级别名称（唯一标识）"
    )
    alias: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="级别别名（显示用）"
    )

    # 配额限制
    max_sub_accounts: Mapped[int] = mapped_column(
        Integer,
        default=5,
        nullable=False,
        comment="子账号数量限额"
    )
    max_shops: Mapped[int] = mapped_column(
        Integer,
        default=10,
        nullable=False,
        comment="店铺数量限额"
    )

    # 默认过期周期（天数）：7=7天, 30=1个月, 90=3个月, 365=1年, 0=永不过期
    default_expiration_days: Mapped[int] = mapped_column(
        Integer,
        default=30,
        nullable=False,
        comment="默认过期周期（天数）：7/30/90/365/0"
    )

    # 扩展配置（预留）
    extra_config: Mapped[dict] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
        comment="扩展配置"
    )

    # 状态
    is_default: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否为默认级别"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="排序顺序"
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
    users = relationship("User", back_populates="account_level")

    def __repr__(self) -> str:
        return f"<AccountLevel(id={self.id}, name={self.name}, max_sub_accounts={self.max_sub_accounts}, max_shops={self.max_shops})>"

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "name": self.name,
            "alias": self.alias,
            "max_sub_accounts": self.max_sub_accounts,
            "max_shops": self.max_shops,
            "default_expiration_days": self.default_expiration_days,
            "extra_config": self.extra_config,
            "is_default": self.is_default,
            "sort_order": self.sort_order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    @property
    def display_name(self) -> str:
        """获取显示名称（优先使用别名）"""
        return self.alias or self.name
