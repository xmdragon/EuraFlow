"""
订单相关数据模型
严格按照 PRD § 3.1 和 3.2 定义
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional, List

from sqlalchemy import (
    BigInteger, Text, Boolean, Integer, 
    DateTime, CheckConstraint, Index,
    ForeignKey, UniqueConstraint, func
)
from sqlalchemy.dialects.postgresql import NUMERIC
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Order(Base):
    """订单表 - 严格按照 PRD 定义"""
    __tablename__ = "orders"
    
    # 主键
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    
    # 平台信息
    platform: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="平台标识"
    )
    shop_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="店铺ID")
    
    # 外部订单信息
    external_id: Mapped[str] = mapped_column(Text, nullable=False, comment="外部平台订单ID")
    external_no: Mapped[str] = mapped_column(Text, nullable=False, comment="外部平台订单编号")
    
    # 订单状态
    status: Mapped[str] = mapped_column(Text, nullable=False, comment="本地订单状态")
    external_status: Mapped[str] = mapped_column(Text, nullable=False, comment="外部平台原始状态")
    
    # 支付信息
    is_cod: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否货到付款")
    payment_method: Mapped[str] = mapped_column(
        Text,
        CheckConstraint("payment_method IN ('online','cod')"),
        nullable=False,
        comment="支付方式"
    )
    
    # 买家信息 - PII 数据
    buyer_name: Mapped[str] = mapped_column(Text, nullable=False, comment="买家姓名")
    buyer_phone_raw: Mapped[Optional[str]] = mapped_column(Text, comment="买家电话原始格式")
    buyer_phone_e164: Mapped[Optional[str]] = mapped_column(Text, comment="买家电话 E.164 格式")
    buyer_email: Mapped[Optional[str]] = mapped_column(Text, comment="买家邮箱")
    
    # 收货地址
    address_country: Mapped[str] = mapped_column(Text, nullable=False, default="RU", comment="国家")
    address_region: Mapped[str] = mapped_column(Text, nullable=False, comment="地区/州")
    address_city: Mapped[str] = mapped_column(Text, nullable=False, comment="城市")
    address_street: Mapped[str] = mapped_column(Text, nullable=False, comment="街道地址")
    address_postcode: Mapped[str] = mapped_column(
        Text, 
        CheckConstraint(r"address_postcode ~ '^\d{6}$'"),
        nullable=False,
        comment="6位邮编"
    )
    
    # 平台时间戳（UTC）
    platform_created_ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        nullable=False,
        comment="平台订单创建时间"
    )
    platform_updated_ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False, 
        comment="平台订单更新时间"
    )
    
    # 金额和汇率（必须使用 Decimal）
    fx_rate: Mapped[Decimal] = mapped_column(
        NUMERIC(18, 6),
        nullable=False,
        comment="CNY→RUB 汇率快照"
    )
    currency: Mapped[str] = mapped_column(Text, nullable=False, default="RUB", comment="币种")
    
    # 系统时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="记录创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="记录更新时间"
    )
    
    # 幂等键
    idempotency_key: Mapped[str] = mapped_column(Text, nullable=False, comment="幂等键")
    
    # 约束
    __table_args__ = (
        # 业务唯一键 
        UniqueConstraint('platform', 'shop_id', 'external_id', name='uq_orders_platform_shop_external'),
        # 幂等键全局唯一
        UniqueConstraint('idempotency_key', name='uq_orders_idempotency_key'),
        # 查询索引
        Index('ix_orders_shop_updated', 'shop_id', 'platform_updated_ts'),
        Index('ix_orders_external_no', 'external_no'),
        Index('ix_orders_status', 'status'),
        Index('ix_orders_created_at', 'created_at'),
        # 电话 E.164 格式检查
        CheckConstraint(
            "buyer_phone_e164 IS NULL OR buyer_phone_e164 ~ '^\\+[1-9]\\d{6,14}$'",
            name="ck_orders_phone_e164_format"
        ),
        # 地址国家检查
        CheckConstraint(
            "address_country = 'RU'",
            name="ck_orders_address_country"
        ),
    )
    
    # 关系
    items: Mapped[List["OrderItem"]] = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    shipments: Mapped[List["Shipment"]] = relationship("Shipment", back_populates="order")


class OrderItem(Base):
    """订单行项目表 - 按照 PRD § 3.2"""
    __tablename__ = "order_items"
    
    # 主键
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    
    # 外键
    order_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联订单ID"
    )
    
    # 商品信息
    sku: Mapped[str] = mapped_column(Text, nullable=False, comment="商品SKU")
    offer_id: Mapped[Optional[str]] = mapped_column(Text, comment="Ozon offer_id")
    
    # 数量和价格
    qty: Mapped[int] = mapped_column(
        Integer,
        CheckConstraint("qty > 0"),
        nullable=False,
        comment="数量"
    )
    price_rub: Mapped[Decimal] = mapped_column(
        NUMERIC(18, 4),
        CheckConstraint("price_rub >= 0"),
        nullable=False,
        comment="单价（卢布）"
    )
    
    # 约束
    __table_args__ = (
        Index('ix_order_items_order', 'order_id'),
        Index('ix_order_items_sku', 'sku'),
    )
    
    # 关系
    order: Mapped["Order"] = relationship("Order", back_populates="items")