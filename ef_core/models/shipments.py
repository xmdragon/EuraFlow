"""
发运和包裹数据模型
严格按照 PRD § 3.3 定义
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional, List

from sqlalchemy import (
    BigInteger, Text, Boolean, DateTime, 
    CheckConstraint, Index, ForeignKey, UniqueConstraint, func
)
from sqlalchemy.dialects.postgresql import NUMERIC, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Shipment(Base):
    """发运表"""
    __tablename__ = "shipments"
    
    # 主键
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    
    # 关联订单
    order_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联订单ID"
    )
    
    # 承运商信息
    carrier_code: Mapped[str] = mapped_column(
        Text,
        CheckConstraint("carrier_code IN ('CDEK','BOXBERRY','POCHTA')"),
        nullable=False,
        comment="承运商代码"
    )
    
    # 运单号
    tracking_no: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="运单号"
    )
    
    # 回传状态
    pushed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="是否已回传到平台"
    )
    
    pushed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        comment="回传时间"
    )
    
    # 回传回执（JSON 格式存储响应）
    push_receipt: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        comment="平台回传回执"
    )
    
    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="创建时间"
    )
    
    # 约束
    __table_args__ = (
        # 运单号全局唯一
        UniqueConstraint('tracking_no', name='uq_shipments_tracking'),
        # 查询索引
        Index('ix_shipments_order', 'order_id'),
        Index('ix_shipments_carrier', 'carrier_code'),
        Index('ix_shipments_pushed', 'pushed', 'created_at'),
    )
    
    # 关系
    order: Mapped["Order"] = relationship("Order", back_populates="shipments")
    packages: Mapped[List["Package"]] = relationship("Package", back_populates="shipment", cascade="all, delete-orphan")


class Package(Base):
    """包裹信息表"""
    __tablename__ = "packages"
    
    # 主键
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    
    # 关联发运
    shipment_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("shipments.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联发运ID"
    )
    
    # 重量（公斤）
    weight_kg: Mapped[Optional[Decimal]] = mapped_column(
        NUMERIC(10, 3),
        CheckConstraint("weight_kg >= 0"),
        comment="重量（公斤）"
    )
    
    # 尺寸（厘米）
    dim_l_cm: Mapped[Optional[Decimal]] = mapped_column(
        NUMERIC(10, 1),
        CheckConstraint("dim_l_cm > 0"),
        comment="长度（厘米）"
    )
    
    dim_w_cm: Mapped[Optional[Decimal]] = mapped_column(
        NUMERIC(10, 1),
        CheckConstraint("dim_w_cm > 0"),
        comment="宽度（厘米）"
    )
    
    dim_h_cm: Mapped[Optional[Decimal]] = mapped_column(
        NUMERIC(10, 1),
        CheckConstraint("dim_h_cm > 0"),
        comment="高度（厘米）"
    )
    
    # 约束
    __table_args__ = (
        Index('ix_packages_shipment', 'shipment_id'),
    )
    
    # 关系
    shipment: Mapped["Shipment"] = relationship("Shipment", back_populates="packages")


# 导入 func 用于默认值
from sqlalchemy import func