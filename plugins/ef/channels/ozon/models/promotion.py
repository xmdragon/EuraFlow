"""
Ozon 促销活动相关数据模型
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Column, String, Integer, BigInteger, Numeric,
    Boolean, DateTime, Text, ForeignKey, Index, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class OzonPromotionAction(Base):
    """Ozon 促销活动表"""
    __tablename__ = "ozon_promotion_actions"

    # 主键
    id = Column(BigInteger, primary_key=True)

    # 店铺隔离
    shop_id = Column(Integer, nullable=False, index=True)

    # OZON活动信息
    action_id = Column(BigInteger, nullable=False, comment="OZON活动ID")
    title = Column(String(500), comment="活动名称")
    description = Column(Text, comment="活动描述")
    date_start = Column(DateTime(timezone=True), comment="开始时间 UTC")
    date_end = Column(DateTime(timezone=True), comment="结束时间 UTC")
    status = Column(String(50), comment="活动状态: active/inactive/expired")

    # 自动取消开关
    auto_cancel_enabled = Column(Boolean, default=False, comment="自动取消开关")

    # 原始数据
    raw_data = Column(JSONB, comment="OZON原始数据")

    # 同步信息
    last_sync_at = Column(DateTime(timezone=True), comment="最后同步时间")

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # 关系
    products = relationship(
        "OzonPromotionProduct",
        back_populates="action",
        cascade="all, delete-orphan",
        primaryjoin="and_(OzonPromotionAction.shop_id == OzonPromotionProduct.shop_id, "
                   "OzonPromotionAction.action_id == OzonPromotionProduct.action_id)",
        foreign_keys="[OzonPromotionProduct.shop_id, OzonPromotionProduct.action_id]"
    )

    # 索引和约束
    __table_args__ = (
        UniqueConstraint("shop_id", "action_id", name="uq_ozon_promotion_actions_shop_action"),
        Index("idx_ozon_promotion_actions_shop", "shop_id"),
        Index("idx_ozon_promotion_actions_shop_status", "shop_id", "status"),
        Index("idx_ozon_promotion_actions_auto_cancel", "shop_id", "auto_cancel_enabled"),
        {"extend_existing": True}
    )


class OzonPromotionProduct(Base):
    """商品活动关联表"""
    __tablename__ = "ozon_promotion_products"

    # 主键
    id = Column(BigInteger, primary_key=True)

    # 店铺和活动
    shop_id = Column(Integer, nullable=False)
    action_id = Column(BigInteger, nullable=False, comment="关联的活动ID")

    # 商品信息
    product_id = Column(
        BigInteger,
        ForeignKey("ozon_products.id", ondelete="CASCADE"),
        comment="本地商品ID"
    )
    ozon_product_id = Column(BigInteger, index=True, comment="OZON商品ID")

    # 状态和价格
    status = Column(
        String(50),
        default="candidate",
        nullable=False,
        comment="状态: candidate候选/active参与中/deactivated已取消"
    )
    promotion_price = Column(Numeric(18, 4), comment="促销价格")
    promotion_stock = Column(Integer, comment="促销库存")
    add_mode = Column(
        String(50),
        default="automatic",
        nullable=False,
        comment="加入方式: manual手动/automatic自动"
    )

    # 时间戳
    activated_at = Column(DateTime(timezone=True), comment="参与时间")
    deactivated_at = Column(DateTime(timezone=True), comment="取消时间")
    last_sync_at = Column(DateTime(timezone=True), comment="最后同步时间")
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # OZON原始数据
    raw_data = Column(JSONB, comment="OZON API返回的原始数据")

    # 关系
    action = relationship(
        "OzonPromotionAction",
        back_populates="products",
        primaryjoin="and_(OzonPromotionProduct.shop_id == OzonPromotionAction.shop_id, "
                   "OzonPromotionProduct.action_id == OzonPromotionAction.action_id)",
        foreign_keys=[shop_id, action_id]
    )
    product = relationship("OzonProduct", foreign_keys=[product_id])

    # 索引和约束
    __table_args__ = (
        UniqueConstraint("shop_id", "action_id", "product_id", name="uq_ozon_promotion_products_shop_action_product"),
        Index("idx_ozon_promotion_products_shop_action_status", "shop_id", "action_id", "status"),
        Index("idx_ozon_promotion_products_shop_action_mode", "shop_id", "action_id", "add_mode"),
        Index("idx_ozon_promotion_products_product", "product_id"),
        Index("idx_ozon_promotion_products_ozon_product", "ozon_product_id"),
        {"extend_existing": True}
    )
