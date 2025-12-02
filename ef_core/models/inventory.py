"""
库存管理数据模型
严格按照 PRD § 3.4 定义
"""
from datetime import datetime
from typing import Optional
from decimal import Decimal

from sqlalchemy import (
    BigInteger, Text, Integer, DateTime, String, Numeric,
    CheckConstraint, UniqueConstraint, Index
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import func

from .base import Base


class Inventory(Base):
    """库存表"""
    __tablename__ = "inventories"
    
    # 主键
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    
    # 店铺和商品信息
    shop_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="店铺ID")
    sku: Mapped[str] = mapped_column(Text, nullable=False, comment="商品SKU")
    
    # 库存数量
    qty_available: Mapped[int] = mapped_column(
        Integer,
        CheckConstraint("qty_available >= 0"),
        nullable=False,
        comment="可售库存数量"
    )
    
    # 安全阈值
    threshold: Mapped[int] = mapped_column(
        Integer,
        CheckConstraint("threshold >= 0"),
        nullable=False,
        default=0,
        comment="安全库存阈值"
    )

    # 采购单价（每件商品的采购价格）
    unit_price: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 4),
        nullable=True,
        comment="采购单价（每件商品采购价格）"
    )

    # 备注信息
    notes: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="备注"
    )

    # 时间戳
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="最后更新时间"
    )
    
    # 约束
    __table_args__ = (
        # 店铺+SKU 唯一
        UniqueConstraint('shop_id', 'sku', name='uq_inventories_shop_sku'),
        # 查询索引
        Index('ix_inventories_shop', 'shop_id'),
        Index('ix_inventories_sku', 'sku'),
        Index('ix_inventories_threshold', 'shop_id', 'threshold', 'qty_available'),
        Index('ix_inventories_updated', 'updated_at'),
    )