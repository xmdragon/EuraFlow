"""
Ozon订单数据模型
"""
from datetime import datetime
from typing import Optional, Dict, Any
from decimal import Decimal
from sqlalchemy import (
    BigInteger, String, Text, DateTime, JSON, Boolean,
    ForeignKey, UniqueConstraint, func, Numeric, Integer
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ef_core.models.base import Base


class OzonOrder(Base):
    """Ozon订单模型"""
    __tablename__ = "ozon_orders"
    __table_args__ = (
        UniqueConstraint("shop_id", "posting_number", name="uq_ozon_order_shop_posting"),
    )
    
    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger, 
        primary_key=True,
        comment="订单ID"
    )
    
    # 店铺关联
    shop_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("ozon_shops.id", ondelete="CASCADE"),
        nullable=False,
        comment="店铺ID"
    )
    
    # 订单标识
    order_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="订单ID"
    )
    
    order_number: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="订单号"
    )
    
    posting_number: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="发货单号"
    )
    
    # 订单状态
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="订单状态"
    )
    
    substatus: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="子状态"
    )
    
    # 订单类型
    delivery_type: Mapped[str] = mapped_column(
        String(200),
        default="FBS",
        nullable=False,
        comment="配送类型 FBS/FBO/CrossDock"
    )
    
    is_express: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否快递"
    )
    
    is_premium: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否优质订单"
    )
    
    # 金额
    total_price: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
        comment="订单总额"
    )
    
    products_price: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 4),
        nullable=True,
        comment="商品总额"
    )
    
    delivery_price: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 4),
        nullable=True,
        comment="运费"
    )
    
    commission_amount: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 4),
        nullable=True,
        comment="佣金"
    )
    
    # 客户信息
    customer_id: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="客户ID"
    )
    
    customer_phone: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="客户电话"
    )
    
    customer_email: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
        comment="客户邮箱"
    )
    
    # 配送信息
    delivery_address: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="配送地址"
    )
    
    delivery_method: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="配送方式"
    )
    
    tracking_number: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="运单号"
    )
    
    # 商品信息
    items: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="订单商品"
    )
    
    # 时间信息
    in_process_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="处理时间"
    )
    
    shipment_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="发货截止时间"
    )
    
    delivering_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="配送时间"
    )
    
    delivered_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="送达时间"
    )
    
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="取消时间"
    )
    
    # 其他信息
    cancel_reason: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="取消原因"
    )
    
    analytics_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="分析数据"
    )
    
    financial_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="财务数据"
    )
    
    # 同步信息
    sync_status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        nullable=False,
        comment="同步状态"
    )
    
    sync_error: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="同步错误信息"
    )
    
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最后同步时间"
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
    shop = relationship("OzonShop", backref="orders")
    
    def __repr__(self) -> str:
        return f"<OzonOrder(id={self.id}, order_number={self.order_number}, status={self.status})>"
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "shop_id": self.shop_id,
            "order_id": self.order_id,
            "order_number": self.order_number,
            "posting_number": self.posting_number,
            "status": self.status,
            "substatus": self.substatus,
            "delivery_type": self.delivery_type,
            "is_express": self.is_express,
            "is_premium": self.is_premium,
            "total_price": str(self.total_price) if self.total_price else None,
            "products_price": str(self.products_price) if self.products_price else None,
            "delivery_price": str(self.delivery_price) if self.delivery_price else None,
            "commission_amount": str(self.commission_amount) if self.commission_amount else None,
            "customer_id": self.customer_id,
            "customer_phone": self.customer_phone,
            "customer_email": self.customer_email,
            "delivery_address": self.delivery_address,
            "delivery_method": self.delivery_method,
            "tracking_number": self.tracking_number,
            "items": self.items,
            "in_process_at": self.in_process_at.isoformat() if self.in_process_at else None,
            "shipment_date": self.shipment_date.isoformat() if self.shipment_date else None,
            "delivering_date": self.delivering_date.isoformat() if self.delivering_date else None,
            "delivered_at": self.delivered_at.isoformat() if self.delivered_at else None,
            "cancelled_at": self.cancelled_at.isoformat() if self.cancelled_at else None,
            "cancel_reason": self.cancel_reason,
            "analytics_data": self.analytics_data,
            "financial_data": self.financial_data,
            "sync_status": self.sync_status,
            "sync_error": self.sync_error,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }