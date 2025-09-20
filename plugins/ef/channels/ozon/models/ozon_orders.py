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
    total_price: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 4),
        nullable=True,
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
    
    # 配送详情字段
    warehouse_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        nullable=True,
        comment="仓库ID"
    )

    warehouse_name: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
        comment="仓库名称"
    )

    tpl_provider_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="物流商ID"
    )

    tpl_provider_name: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
        comment="物流商名称"
    )

    tpl_integration_type: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="物流集成类型"
    )

    provider_status: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="物流商状态"
    )

    # 条形码字段
    upper_barcode: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="上条形码"
    )

    lower_barcode: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="下条形码"
    )

    # 取消详情字段
    cancel_reason_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="取消原因ID"
    )

    cancellation_type: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="取消类型"
    )

    cancelled_after_ship: Mapped[Optional[bool]] = mapped_column(
        Boolean,
        nullable=True,
        default=False,
        comment="发货后取消"
    )

    affect_cancellation_rating: Mapped[Optional[bool]] = mapped_column(
        Boolean,
        nullable=True,
        default=False,
        comment="影响评分"
    )

    cancellation_initiator: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="取消发起方"
    )

    # 其他重要字段
    previous_substatus: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="前一个子状态"
    )

    requirements: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="特殊要求"
    )

    addressee: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="收件人信息"
    )

    is_legal: Mapped[Optional[bool]] = mapped_column(
        Boolean,
        nullable=True,
        default=False,
        comment="是否法人订单"
    )

    payment_type: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="支付类型组"
    )

    delivery_date_begin: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="配送开始时间"
    )

    delivery_date_end: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="配送结束时间"
    )

    # 同步控制字段
    sync_mode: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
        default="incremental",
        comment="同步模式：full或incremental"
    )

    sync_version: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        default=1,
        comment="同步版本号"
    )

    # JSON字段存储复杂数据
    barcodes: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="条形码对象"
    )

    cancellation_detail: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="取消详情对象"
    )

    delivery_method_detail: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="配送方式详情"
    )

    optional_info: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="可选信息"
    )

    related_postings: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="相关订单"
    )

    product_exemplars: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="产品样本"
    )

    legal_info: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="法律信息"
    )

    translit: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="音译信息"
    )

    # 其他信息
    cancel_reason: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="取消原因"
    )

    # 报表相关字段
    purchase_price: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 4),
        nullable=True,
        comment="进货价格"
    )

    domestic_tracking_number: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="国内运单号"
    )

    material_cost: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 4),
        nullable=True,
        comment="材料费用"
    )

    order_notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="订单备注"
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
            # 新增配送详情字段
            "warehouse_id": self.warehouse_id,
            "warehouse_name": self.warehouse_name,
            "tpl_provider_id": self.tpl_provider_id,
            "tpl_provider_name": self.tpl_provider_name,
            "tpl_integration_type": self.tpl_integration_type,
            "provider_status": self.provider_status,
            # 新增条形码字段
            "upper_barcode": self.upper_barcode,
            "lower_barcode": self.lower_barcode,
            # 新增取消详情字段
            "cancel_reason_id": self.cancel_reason_id,
            "cancellation_type": self.cancellation_type,
            "cancelled_after_ship": self.cancelled_after_ship,
            "affect_cancellation_rating": self.affect_cancellation_rating,
            "cancellation_initiator": self.cancellation_initiator,
            # 新增其他字段
            "previous_substatus": self.previous_substatus,
            "requirements": self.requirements,
            "addressee": self.addressee,
            "is_legal": self.is_legal,
            "payment_type": self.payment_type,
            "delivery_date_begin": self.delivery_date_begin.isoformat() if self.delivery_date_begin else None,
            "delivery_date_end": self.delivery_date_end.isoformat() if self.delivery_date_end else None,
            # 新增同步控制字段
            "sync_mode": self.sync_mode,
            "sync_version": self.sync_version,
            # 新增JSON字段
            "barcodes": self.barcodes,
            "cancellation_detail": self.cancellation_detail,
            "delivery_method_detail": self.delivery_method_detail,
            "optional_info": self.optional_info,
            "related_postings": self.related_postings,
            "product_exemplars": self.product_exemplars,
            "legal_info": self.legal_info,
            "translit": self.translit,
            "analytics_data": self.analytics_data,
            "financial_data": self.financial_data,
            # 报表相关字段
            "purchase_price": str(self.purchase_price) if self.purchase_price else None,
            "domestic_tracking_number": self.domestic_tracking_number,
            "material_cost": str(self.material_cost) if self.material_cost else None,
            "order_notes": self.order_notes,
            "sync_status": self.sync_status,
            "sync_error": self.sync_error,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }