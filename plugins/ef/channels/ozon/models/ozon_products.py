"""
Ozon商品数据模型
"""

from datetime import datetime
from typing import Optional, Dict, Any
from decimal import Decimal
from sqlalchemy import (
    BigInteger,
    String,
    Text,
    DateTime,
    JSON,
    Boolean,
    ForeignKey,
    UniqueConstraint,
    func,
    Numeric,
    Integer,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ef_core.models.base import Base


class OzonProduct(Base):
    """Ozon商品模型"""

    __tablename__ = "ozon_products"
    __table_args__ = (UniqueConstraint("shop_id", "sku", name="uq_ozon_product_shop_sku"),)

    # 主键
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="商品ID")

    # 店铺关联
    shop_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ozon_shops.id", ondelete="CASCADE"), nullable=False, comment="店铺ID"
    )

    # 商品标识
    sku: Mapped[str] = mapped_column(String(100), nullable=False, comment="商品SKU")

    offer_id: Mapped[str] = mapped_column(String(100), nullable=False, comment="Ozon Offer ID")

    ozon_product_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, comment="Ozon Product ID")

    ozon_sku: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, comment="Ozon SKU")

    # 商品信息
    title: Mapped[str] = mapped_column(String(500), nullable=False, comment="商品标题")

    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="商品描述")

    barcode: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="条形码")

    category_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="类目ID")

    brand: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, comment="品牌")

    # 状态
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False, comment="商品状态")

    visibility: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, comment="是否可见")

    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="是否归档")

    # OZON原生状态字段
    ozon_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="OZON归档状态")
    ozon_has_fbo_stocks: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="是否有FBO库存")
    ozon_has_fbs_stocks: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="是否有FBS库存")
    ozon_is_discounted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="是否打折")
    ozon_visibility_status: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="OZON可见性状态")

    # 价格（使用Decimal类型）
    price: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True, comment="当前价格")

    old_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True, comment="原价")

    premium_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True, comment="会员价")

    cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True, comment="成本价")

    min_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True, comment="最低价")

    # 库存
    stock: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="总库存")

    reserved: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="预留库存")

    available: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="可售库存")

    # 尺寸重量
    weight: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="重量(g)")

    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="宽度(mm)")

    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="高度(mm)")

    depth: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="深度(mm)")

    # 图片
    images: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True, comment="商品图片")

    # 属性
    attributes: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True, comment="商品属性")

    # 同步信息
    sync_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, comment="同步状态")

    sync_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="同步错误信息")

    last_sync_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="最后同步时间"
    )

    # OZON平台的创建时间
    ozon_created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="商品在OZON平台的创建时间"
    )

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, comment="创建时间"
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, comment="更新时间"
    )

    # 关系
    shop = relationship("OzonShop", backref="products")

    def __repr__(self) -> str:
        return f"<OzonProduct(id={self.id}, sku={self.sku}, title={self.title})>"

    def to_dict(self) -> dict:
        """转换为字典"""
        # 导入分类映射
        from ..utils.categories import get_category_name

        return {
            "id": self.id,
            "shop_id": self.shop_id,
            "sku": self.sku,
            "offer_id": self.offer_id,
            "ozon_product_id": self.ozon_product_id,
            "ozon_sku": self.ozon_sku,
            "title": self.title,
            "description": self.description,
            "barcode": self.barcode,
            "category_id": self.category_id,
            "category_name": get_category_name(self.category_id) if self.category_id else None,
            "brand": self.brand,
            "status": self.status,
            "visibility": self.visibility,
            "is_archived": self.is_archived,
            "ozon_archived": self.ozon_archived,
            "ozon_has_fbo_stocks": self.ozon_has_fbo_stocks,
            "ozon_has_fbs_stocks": self.ozon_has_fbs_stocks,
            "ozon_is_discounted": self.ozon_is_discounted,
            "ozon_visibility_status": self.ozon_visibility_status,
            "price": str(self.price) if self.price else None,
            "old_price": str(self.old_price) if self.old_price else None,
            "premium_price": str(self.premium_price) if self.premium_price else None,
            "cost": str(self.cost) if self.cost else None,
            "min_price": str(self.min_price) if self.min_price else None,
            "stock": self.stock,
            "reserved": self.reserved,
            "available": self.available,
            "weight": self.weight,
            "width": self.width,
            "height": self.height,
            "depth": self.depth,
            "images": self.images,
            "attributes": self.attributes,
            "sync_status": self.sync_status,
            "sync_error": self.sync_error,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
