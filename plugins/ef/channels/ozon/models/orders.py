"""
Ozon 订单相关数据模型
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Column, String, Integer, BigInteger, Numeric,
    Boolean, DateTime, JSON, ForeignKey, Index, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class OzonOrder(Base):
    """Ozon 订单表"""
    __tablename__ = "ozon_orders"
    
    # 主键
    id = Column(BigInteger, primary_key=True)
    
    # 店铺隔离
    shop_id = Column(Integer, nullable=False, index=True)
    
    # 订单号映射
    order_id = Column(String(100), nullable=False, comment="本地订单号")
    ozon_order_id = Column(String(100), nullable=False, comment="Ozon订单号")
    ozon_order_number = Column(String(100), comment="Ozon订单编号")
    
    # 订单状态
    status = Column(String(50), nullable=False)  # pending/confirmed/processing/shipped/delivered/cancelled
    ozon_status = Column(String(50))  # 原始Ozon状态
    payment_status = Column(String(50))  # pending/paid/refunded
    
    # 订单类型
    order_type = Column(String(50), default="FBS")  # FBS/FBO/CrossDock
    is_express = Column(Boolean, default=False)
    is_premium = Column(Boolean, default=False)
    
    # 金额信息（Decimal避免精度问题）
    total_price = Column(Numeric(18, 4), nullable=False)
    products_price = Column(Numeric(18, 4))
    delivery_price = Column(Numeric(18, 4))
    commission_amount = Column(Numeric(18, 4))
    
    # 客户信息
    customer_id = Column(String(100))
    customer_phone = Column(String(50))
    customer_email = Column(String(200))
    
    # 地址信息（JSON存储）
    delivery_address = Column(JSONB)
    # 格式: {"city": "", "region": "", "postal_code": "", "address": "", "lat": 0.0, "lon": 0.0}
    
    # 配送信息
    delivery_method = Column(String(100))
    delivery_date = Column(DateTime(timezone=True))
    delivery_time_slot = Column(String(50))
    
    # 原始数据
    raw_payload = Column(JSONB, comment="Ozon原始订单数据")
    
    # 时间信息
    ordered_at = Column(DateTime(timezone=True), nullable=False)
    confirmed_at = Column(DateTime(timezone=True))
    shipped_at = Column(DateTime(timezone=True))
    delivered_at = Column(DateTime(timezone=True))
    cancelled_at = Column(DateTime(timezone=True))
    
    # 同步信息
    last_sync_at = Column(DateTime(timezone=True))
    sync_status = Column(String(50), default="pending")
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    # 关系
    postings = relationship("OzonPosting", back_populates="order", cascade="all, delete-orphan")
    items = relationship("OzonOrderItem", back_populates="order", cascade="all, delete-orphan")
    refunds = relationship("OzonRefund", back_populates="order", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint("shop_id", "ozon_order_id", name="uq_ozon_orders_shop_order"),
        Index("idx_ozon_orders_status", "shop_id", "status"),
        Index("idx_ozon_orders_date", "shop_id", "ordered_at"),
        Index("idx_ozon_orders_sync", "sync_status", "last_sync_at")
    )

    def to_dict(self):
        """转换为字典，包含关联的商品明细和posting信息"""
        # 调用父类方法获取基础字段
        result = super().to_dict()

        # 添加关联的商品明细
        if self.items:
            result['items'] = [
                {
                    'id': item.id,
                    'sku': item.sku,
                    'offer_id': item.offer_id,
                    'ozon_sku': item.ozon_sku,
                    'name': item.name,
                    'quantity': item.quantity,
                    'price': str(item.price),
                    'discount': str(item.discount),
                    'total_amount': str(item.total_amount),
                    'status': item.status
                }
                for item in self.items
            ]
        else:
            result['items'] = []

        # 添加第一个posting的关键信息到订单级别（便于前端显示）
        if self.postings and len(self.postings) > 0:
            first_posting = self.postings[0]
            result['posting_number'] = first_posting.posting_number
            result['posting_status'] = first_posting.status
            result['in_process_at'] = first_posting.in_process_at.isoformat() if first_posting.in_process_at else None
            result['warehouse_name'] = first_posting.warehouse_name

            # 添加完整的postings列表
            result['postings'] = [
                {
                    'id': posting.id,
                    'posting_number': posting.posting_number,
                    'status': posting.status,
                    'warehouse_name': posting.warehouse_name,
                    'delivery_method_name': posting.delivery_method_name,
                    'shipped_at': posting.shipped_at.isoformat() if posting.shipped_at else None,
                    'delivered_at': posting.delivered_at.isoformat() if posting.delivered_at else None,
                }
                for posting in self.postings
            ]
        else:
            result['posting_number'] = None
            result['posting_status'] = None
            result['in_process_at'] = None
            result['warehouse_name'] = None
            result['postings'] = []

        return result


class OzonPosting(Base):
    """Ozon 发货单（Posting维度）"""
    __tablename__ = "ozon_postings"
    
    id = Column(BigInteger, primary_key=True)
    order_id = Column(BigInteger, ForeignKey("ozon_orders.id"), nullable=False)
    shop_id = Column(Integer, nullable=False)
    
    # 发货单信息
    posting_number = Column(String(100), nullable=False, unique=True)
    ozon_posting_number = Column(String(100))
    
    # 状态
    status = Column(String(50), nullable=False)  # awaiting_packaging/awaiting_deliver/delivering/delivered
    substatus = Column(String(100))
    
    # 发货信息
    shipment_date = Column(DateTime(timezone=True))
    delivery_method_id = Column(Integer)
    delivery_method_name = Column(String(200))
    
    # 仓库
    warehouse_id = Column(Integer)
    warehouse_name = Column(String(200))
    
    # 包裹信息
    packages_count = Column(Integer, default=1)
    total_weight = Column(Numeric(10, 3))
    
    # 取消信息
    is_cancelled = Column(Boolean, default=False)
    cancel_reason_id = Column(Integer)
    cancel_reason = Column(String(500))
    
    # 原始数据
    raw_payload = Column(JSONB)
    
    # 时间
    in_process_at = Column(DateTime(timezone=True))
    shipped_at = Column(DateTime(timezone=True))
    delivered_at = Column(DateTime(timezone=True))
    cancelled_at = Column(DateTime(timezone=True))
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    # 关系
    order = relationship("OzonOrder", back_populates="postings")
    packages = relationship("OzonShipmentPackage", back_populates="posting", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("idx_ozon_postings_status", "shop_id", "status"),
        Index("idx_ozon_postings_date", "shop_id", "shipment_date"),
        Index("idx_ozon_postings_warehouse", "warehouse_id", "status")
    )


class OzonOrderItem(Base):
    """订单商品明细"""
    __tablename__ = "ozon_order_items"
    
    id = Column(BigInteger, primary_key=True)
    order_id = Column(BigInteger, ForeignKey("ozon_orders.id"), nullable=False)
    
    # SKU映射
    sku = Column(String(100), nullable=False)
    offer_id = Column(String(100))
    ozon_sku = Column(BigInteger)
    
    # 商品信息
    name = Column(String(500))
    
    # 数量和价格
    quantity = Column(Integer, nullable=False)
    price = Column(Numeric(18, 4), nullable=False)
    discount = Column(Numeric(18, 4), default=Decimal("0"))
    total_amount = Column(Numeric(18, 4), nullable=False)
    
    # 状态
    status = Column(String(50))  # pending/confirmed/shipped/delivered/cancelled/returned
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    # 关系
    order = relationship("OzonOrder", back_populates="items")
    
    __table_args__ = (
        Index("idx_ozon_order_items_sku", "sku"),
        Index("idx_ozon_order_items_order", "order_id", "status")
    )


class OzonShipmentPackage(Base):
    """发货包裹信息"""
    __tablename__ = "ozon_shipment_packages"
    
    id = Column(BigInteger, primary_key=True)
    posting_id = Column(BigInteger, ForeignKey("ozon_postings.id"), nullable=False)
    
    # 包裹信息
    package_number = Column(String(100), nullable=False)
    tracking_number = Column(String(200))
    
    # 物流商
    carrier_id = Column(Integer)
    carrier_name = Column(String(200))
    carrier_code = Column(String(50))  # CDEK/BOXBERRY/POCHTA
    
    # 包裹属性
    weight = Column(Numeric(10, 3))
    width = Column(Numeric(10, 2))
    height = Column(Numeric(10, 2))
    length = Column(Numeric(10, 2))
    
    # 标签
    label_url = Column(String(500))
    label_printed_at = Column(DateTime(timezone=True))
    
    # 状态追踪
    status = Column(String(50))
    status_updated_at = Column(DateTime(timezone=True))
    tracking_data = Column(JSONB)
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    # 关系
    posting = relationship("OzonPosting", back_populates="packages")
    
    __table_args__ = (
        UniqueConstraint("posting_id", "package_number", name="uq_ozon_packages"),
        Index("idx_ozon_packages_tracking", "tracking_number")
    )


class OzonRefund(Base):
    """退款/退货记录"""
    __tablename__ = "ozon_refunds"
    
    id = Column(BigInteger, primary_key=True)
    order_id = Column(BigInteger, ForeignKey("ozon_orders.id"), nullable=False)
    shop_id = Column(Integer, nullable=False)
    
    # 退款信息
    refund_id = Column(String(100), nullable=False, unique=True)
    refund_type = Column(String(50))  # refund/return/partial_refund
    
    # 关联
    posting_id = Column(BigInteger, ForeignKey("ozon_postings.id"))
    
    # 金额
    refund_amount = Column(Numeric(18, 4), nullable=False)
    commission_refund = Column(Numeric(18, 4))
    
    # 商品明细（JSON数组）
    refund_items = Column(JSONB)
    # 格式: [{"sku": "xxx", "quantity": 1, "amount": 100.00, "reason": "xxx"}]
    
    # 原因
    reason_id = Column(Integer)
    reason = Column(String(500))
    customer_comment = Column(String(1000))
    
    # 状态
    status = Column(String(50))  # pending/approved/processing/completed/rejected
    
    # 时间
    requested_at = Column(DateTime(timezone=True), nullable=False)
    approved_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    # 关系
    order = relationship("OzonOrder", back_populates="refunds")
    
    __table_args__ = (
        Index("idx_ozon_refunds_status", "shop_id", "status"),
        Index("idx_ozon_refunds_date", "shop_id", "requested_at")
    )