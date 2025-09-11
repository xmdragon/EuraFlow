"""
商品价格数据模型
严格按照 PRD § 3.5 定义
"""
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger, Text, DateTime,
    CheckConstraint, UniqueConstraint, Index
)
from sqlalchemy.dialects.postgresql import NUMERIC
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import func

from .base import Base


class Listing(Base):
    """商品价格表"""
    __tablename__ = "listings"
    
    # 主键
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    
    # 店铺和商品信息
    shop_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="店铺ID")
    sku: Mapped[str] = mapped_column(Text, nullable=False, comment="商品SKU")
    
    # 价格信息（必须使用 Decimal）
    price_rub: Mapped[Decimal] = mapped_column(
        NUMERIC(18, 4),
        CheckConstraint("price_rub >= 0"),
        nullable=False,
        comment="当前价格（卢布）"
    )
    
    price_old_rub: Mapped[Decimal] = mapped_column(
        NUMERIC(18, 4),
        CheckConstraint("price_old_rub >= price_rub"),
        nullable=True,
        comment="划线价（卢布）"
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
        UniqueConstraint('shop_id', 'sku', name='uq_listings_shop_sku'),
        # 查询索引
        Index('ix_listings_shop', 'shop_id'),
        Index('ix_listings_sku', 'sku'),
        Index('ix_listings_price', 'price_rub'),
        Index('ix_listings_updated', 'updated_at'),
    )