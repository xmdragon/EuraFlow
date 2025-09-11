"""
退货退款数据模型
严格按照 PRD § 3.6 定义（只读）
"""
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger, Text, DateTime,
    CheckConstraint
)
from sqlalchemy.dialects.postgresql import NUMERIC
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Return(Base):
    """退货表（只读）"""
    __tablename__ = "returns"
    
    # 主键
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    
    # 平台信息
    platform: Mapped[str] = mapped_column(Text, nullable=False, default="ozon", comment="平台标识")
    shop_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="店铺ID")
    
    # 退货信息
    external_id: Mapped[str] = mapped_column(Text, nullable=False, comment="平台退货ID")
    order_external_id: Mapped[str] = mapped_column(Text, nullable=False, comment="关联订单外部ID")
    
    # 退货原因和状态
    reason_code: Mapped[str] = mapped_column(Text, comment="退货原因代码")
    status: Mapped[str] = mapped_column(Text, comment="退货状态")
    
    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="退货创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="退货更新时间"
    )


class Refund(Base):
    """退款表（只读）"""
    __tablename__ = "refunds"
    
    # 主键
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    
    # 平台信息
    platform: Mapped[str] = mapped_column(Text, nullable=False, default="ozon", comment="平台标识")
    shop_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="店铺ID")
    
    # 退款信息
    order_external_id: Mapped[str] = mapped_column(Text, nullable=False, comment="关联订单外部ID")
    
    # 退款金额（必须使用 Decimal）
    amount_rub: Mapped[Decimal] = mapped_column(
        NUMERIC(18, 4),
        CheckConstraint("amount_rub >= 0"),
        nullable=False,
        comment="退款金额（卢布）"
    )
    
    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="退款创建时间"
    )