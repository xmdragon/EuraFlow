"""
OZON 仓库数据模型
"""
from datetime import datetime
from typing import Optional, Dict, Any, List
from sqlalchemy import (
    BigInteger, String, Boolean, Integer, DateTime, JSON,
    ForeignKey, UniqueConstraint, Index, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.models.base import Base


class OzonWarehouse(Base):
    """OZON 仓库模型"""
    __tablename__ = "ozon_warehouses"
    __table_args__ = (
        UniqueConstraint("shop_id", "warehouse_id", name="uq_ozon_warehouse_shop_warehouse"),
        Index("idx_ozon_warehouses_shop_id", "shop_id"),
    )

    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="仓库记录ID"
    )

    # 关联店铺
    shop_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("ozon_shops.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联的Ozon店铺ID"
    )

    # OZON 仓库基本信息
    warehouse_id: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        comment="OZON 仓库ID"
    )

    name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="仓库名称"
    )

    is_rfbs: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否为rFBS仓库"
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="仓库状态：new/created/disabled/blocked/disabled_due_to_limit/error"
    )

    # 仓库能力与限制
    has_entrusted_acceptance: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否启用受信任接受"
    )

    postings_limit: Mapped[int] = mapped_column(
        Integer,
        default=-1,
        nullable=False,
        comment="订单限额（-1表示无限制）"
    )

    min_postings_limit: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="单次供货最小订单数"
    )

    has_postings_limit: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否有订单数限制"
    )

    # 工作时间
    min_working_days: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="最少工作天数"
    )

    working_days: Mapped[Optional[List[str]]] = mapped_column(
        JSON,
        nullable=True,
        comment="工作日列表（1-7表示周一至周日）"
    )

    # 仓库特性
    can_print_act_in_advance: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否可提前打印收发证书"
    )

    is_karantin: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否因隔离停运"
    )

    is_kgt: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否接受大宗商品"
    )

    is_timetable_editable: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否可修改时间表"
    )

    # 第一英里配置
    first_mile_type: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="第一英里类型配置"
    )

    # 原始数据
    raw_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=True,
        comment="OZON API 原始响应数据"
    )

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="创建时间（UTC）"
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        comment="更新时间（UTC）"
    )

    # 关系
    shop = relationship("OzonShop", backref="warehouses", foreign_keys=[shop_id])

    def __repr__(self) -> str:
        # Use __dict__.get() to avoid lazy loading
        id_val = self.__dict__.get('id', '?')
        warehouse_id_val = self.__dict__.get('warehouse_id', '?')
        name_val = self.__dict__.get('name', '?')
        status_val = self.__dict__.get('status', '?')
        return f"<OzonWarehouse(id={id_val}, warehouse_id={warehouse_id_val}, name={name_val}, status={status_val})>"

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "shop_id": self.shop_id,
            "warehouse_id": self.warehouse_id,
            "name": self.name,
            "is_rfbs": self.is_rfbs,
            "status": self.status,
            "has_entrusted_acceptance": self.has_entrusted_acceptance,
            "postings_limit": self.postings_limit,
            "min_postings_limit": self.min_postings_limit,
            "has_postings_limit": self.has_postings_limit,
            "min_working_days": self.min_working_days,
            "working_days": self.working_days,
            "can_print_act_in_advance": self.can_print_act_in_advance,
            "is_karantin": self.is_karantin,
            "is_kgt": self.is_kgt,
            "is_timetable_editable": self.is_timetable_editable,
            "first_mile_type": self.first_mile_type,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
