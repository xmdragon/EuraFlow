"""
OZON 取消和退货申请数据模型
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Column, String, Integer, BigInteger, Numeric, Text,
    Boolean, DateTime, JSON, ForeignKey, Index, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class OzonCancellation(Base):
    """OZON 取消申请表"""
    __tablename__ = "ozon_cancellations"

    # 主键
    id = Column(BigInteger, primary_key=True)

    # 店铺隔离
    shop_id = Column(Integer, nullable=False, index=True, comment="店铺ID")

    # 关联关系
    posting_id = Column(BigInteger, ForeignKey("ozon_postings.id"), comment="关联的货件ID")

    # OZON 字段
    cancellation_id = Column(BigInteger, nullable=False, unique=True, comment="OZON取消申请ID")
    posting_number = Column(String(100), nullable=False, index=True, comment="货件编号")

    # 状态信息
    state = Column(String(50), nullable=False, index=True, comment="状态：ALL/ON_APPROVAL/APPROVED/REJECTED")
    state_name = Column(String(200), comment="状态名称")

    # 取消信息
    cancellation_initiator = Column(String(50), index=True, comment="发起人：CLIENT/SELLER/OZON/SYSTEM/DELIVERY")
    cancellation_reason_id = Column(Integer, comment="取消原因ID")
    cancellation_reason_name = Column(String(500), comment="取消原因名称")
    cancellation_reason_message = Column(Text, comment="取消备注（发起人填写）")

    # 审批信息
    approve_comment = Column(Text, comment="确认/拒绝备注")
    approve_date = Column(DateTime(timezone=True), comment="确认/拒绝日期")
    auto_approve_date = Column(DateTime(timezone=True), comment="自动确认日期")

    # 时间信息
    order_date = Column(DateTime(timezone=True), nullable=False, comment="订单创建日期")
    cancelled_at = Column(DateTime(timezone=True), nullable=False, index=True, comment="取消申请创建日期")

    # 原始数据
    raw_payload = Column(JSONB, comment="OZON原始数据")

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # 关系
    posting = relationship("OzonPosting", foreign_keys=[posting_id])

    __table_args__ = (
        UniqueConstraint("shop_id", "cancellation_id", name="uq_ozon_cancellations_shop_id"),
        Index("idx_ozon_cancellations_shop_state", "shop_id", "state"),
        Index("idx_ozon_cancellations_shop_date", "shop_id", "cancelled_at"),
        Index("idx_ozon_cancellations_posting", "posting_number"),
    )


class OzonReturn(Base):
    """OZON 退货申请表"""
    __tablename__ = "ozon_returns"

    # 主键
    id = Column(BigInteger, primary_key=True)

    # 店铺隔离
    shop_id = Column(Integer, nullable=False, index=True, comment="店铺ID")

    # 关联关系
    posting_id = Column(BigInteger, ForeignKey("ozon_postings.id"), comment="关联的货件ID")

    # OZON 字段
    return_id = Column(BigInteger, nullable=False, unique=True, comment="OZON退货申请ID")
    return_number = Column(String(100), nullable=False, index=True, comment="退货申请编号")
    posting_number = Column(String(100), nullable=False, index=True, comment="货件编号")
    order_number = Column(String(100), comment="订单号")

    # 客户信息
    client_name = Column(String(200), comment="买家姓名")

    # 商品信息
    product_name = Column(String(500), comment="商品名称")
    offer_id = Column(String(100), index=True, comment="商品货号")
    sku = Column(BigInteger, comment="SKU")
    price = Column(Numeric(18, 4), comment="价格")
    currency_code = Column(String(10), comment="货币代码")

    # 状态信息
    group_state = Column(String(50), nullable=False, index=True, comment="状态组")
    state = Column(String(50), nullable=False, comment="状态标识")
    state_name = Column(String(200), comment="状态名称")
    money_return_state_name = Column(String(200), comment="退款状态名称")

    # 配送方式（从posting表join获取，或从详情API获取）
    delivery_method_name = Column(String(200), comment="配送方式名称")

    # 退货/拒绝原因（从详情API获取）
    return_reason_id = Column(Integer, comment="退货原因ID")
    return_reason_name = Column(String(500), comment="退货原因名称")
    rejection_reason_id = Column(Integer, comment="拒绝原因ID")
    rejection_reason_name = Column(String(500), comment="拒绝原因名称")
    rejection_reasons = Column(JSONB, comment="拒绝原因列表（详情数据）")

    # 额外信息（从详情API获取）
    return_method_description = Column(Text, comment="退货方式描述")
    available_actions = Column(JSONB, comment="可用操作列表")

    # 时间信息
    created_at_ozon = Column(DateTime(timezone=True), nullable=False, index=True, comment="OZON创建日期")

    # 原始数据
    raw_payload = Column(JSONB, comment="OZON原始数据")

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # 关系
    posting = relationship("OzonPosting", foreign_keys=[posting_id])

    __table_args__ = (
        UniqueConstraint("shop_id", "return_id", name="uq_ozon_returns_shop_id"),
        Index("idx_ozon_returns_shop_state", "shop_id", "group_state"),
        Index("idx_ozon_returns_shop_date", "shop_id", "created_at_ozon"),
        Index("idx_ozon_returns_posting", "posting_number"),
        Index("idx_ozon_returns_offer", "offer_id"),
    )
