"""
Ozon 商品相关数据模型
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, Dict, Any, List

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


class OzonProduct(Base):
    """Ozon 商品映射表"""
    __tablename__ = "ozon_products"
    
    # 主键
    id = Column(BigInteger, primary_key=True)
    
    # 店铺隔离
    shop_id = Column(Integer, nullable=False, index=True)

    # SKU 映射（三个ID体系）
    offer_id = Column(String(100), nullable=False, comment="卖家SKU（商品货号）")
    ozon_product_id = Column(BigInteger, comment="Ozon商品ID")
    ozon_sku = Column(BigInteger, comment="Ozon SKU")
    
    # 商品基本信息
    title = Column(String(500), nullable=False, comment="商品标题(俄文)")
    title_cn = Column(String(500), comment="中文名称(用于商品创建和管理)")
    description = Column(String(5000))
    barcode = Column(String(50), comment="主条形码")
    barcodes = Column(JSONB, comment="所有条形码数组")
    category_id = Column(Integer)
    brand = Column(String(200))
    
    # 状态
    status = Column(String(50), default="draft")  # draft/active/inactive/archived/failed
    visibility = Column(Boolean, default=True)
    is_archived = Column(Boolean, default=False)

    # OZON原生状态字段
    ozon_archived = Column(Boolean, default=False, comment="OZON归档状态")
    ozon_has_fbo_stocks = Column(Boolean, default=False, comment="是否有FBO库存")
    ozon_has_fbs_stocks = Column(Boolean, default=False, comment="是否有FBS库存")
    ozon_is_discounted = Column(Boolean, default=False, comment="是否打折")
    ozon_visibility_status = Column(String(100), comment="OZON可见性状态")
    
    # 价格信息（使用Decimal避免精度问题）
    price = Column(Numeric(18, 4), comment="售价")
    old_price = Column(Numeric(18, 4), comment="原价")
    premium_price = Column(Numeric(18, 4), comment="会员价")
    cost = Column(Numeric(18, 4), comment="成本")
    min_price = Column(Numeric(18, 4), comment="最低价")
    currency_code = Column(String(10), comment="货币代码(CNY/RUB/USD等)")
    
    # 库存信息
    stock = Column(Integer, default=0)
    reserved = Column(Integer, default=0)
    available = Column(Integer, default=0)
    
    # 商品属性
    weight = Column(Numeric(10, 3), comment="重量(kg)")
    width = Column(Numeric(10, 2), comment="宽度(cm)")
    height = Column(Numeric(10, 2), comment="高度(cm)")
    depth = Column(Numeric(10, 2), comment="深度(cm)")

    # OZON详细属性字段
    dimension_unit = Column(String(10), comment="尺寸单位(mm/cm/in)")
    weight_unit = Column(String(10), comment="重量单位")
    description_category_id = Column(BigInteger, comment="类目标识符")
    type_id = Column(BigInteger, comment="商品类型标识符")
    color_image = Column(String(200), comment="市场营销色彩")
    primary_image = Column(String(500), comment="主图链接")

    # OZON详细属性(JSONB存储)
    ozon_attributes = Column(JSONB, comment="商品特征数组")
    complex_attributes = Column(JSONB, comment="嵌套特征列表")
    model_info = Column(JSONB, comment="型号信息")
    pdf_list = Column(JSONB, comment="PDF文件列表")
    attributes_with_defaults = Column(JSONB, comment="具有默认值的特征ID列表")
    
    # 原始数据
    raw_payload = Column(JSONB, comment="Ozon原始数据")

    # 图片和可见性数据
    images = Column(JSONB, comment="商品图片数据")
    ozon_visibility_details = Column(JSONB, comment="OZON可见性详情")
    ozon_status = Column(String(50), comment="OZON原始状态")
    status_reason = Column(String(200), comment="状态原因说明")

    # 同步信息
    last_sync_at = Column(DateTime(timezone=True))
    sync_status = Column(String(50), default="pending")  # pending/syncing/success/failed
    sync_error = Column(String(1000))

    # 时间戳
    ozon_created_at = Column(DateTime(timezone=True), comment="OZON平台创建时间")
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    # 关系
    variants = relationship("OzonProductVariant", back_populates="product", cascade="all, delete-orphan")
    attributes = relationship("OzonProductAttribute", back_populates="product", cascade="all, delete-orphan")
    price_history = relationship("OzonPriceHistory", back_populates="product", cascade="all, delete-orphan")
    
    # 索引
    __table_args__ = (
        UniqueConstraint("shop_id", "offer_id", name="uq_ozon_products_shop_offer"),
        Index("idx_ozon_products_ozon_product_id", "ozon_product_id"),
        Index("idx_ozon_products_status", "status"),
        Index("idx_ozon_products_ozon_archived", "ozon_archived"),
        Index("idx_ozon_products_ozon_visibility", "ozon_visibility_status"),
        Index("idx_ozon_products_sync", "shop_id", "sync_status", "last_sync_at"),
        Index("idx_ozon_products_title_cn", "title_cn"),
        {"extend_existing": True}
    )


class OzonProductVariant(Base):
    """商品变体（颜色、尺码等）"""
    __tablename__ = "ozon_product_variants"
    
    id = Column(BigInteger, primary_key=True)
    product_id = Column(BigInteger, ForeignKey("ozon_products.id"), nullable=False)
    
    # 变体信息
    variant_id = Column(String(100), nullable=False)
    variant_type = Column(String(50))  # color/size/material等
    variant_value = Column(String(200))
    
    # SKU
    variant_sku = Column(String(100))
    variant_barcode = Column(String(50))
    
    # 价格和库存（变体级别）
    price = Column(Numeric(18, 4))
    stock = Column(Integer, default=0)
    
    # 图片
    images = Column(JSONB)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    # 关系
    product = relationship("OzonProduct", back_populates="variants")
    
    __table_args__ = (
        UniqueConstraint("product_id", "variant_id", name="uq_ozon_variants"),
        Index("idx_ozon_variants_sku", "variant_sku")
    )


class OzonProductAttribute(Base):
    """商品属性（类目特定属性）"""
    __tablename__ = "ozon_product_attributes"
    
    id = Column(BigInteger, primary_key=True)
    product_id = Column(BigInteger, ForeignKey("ozon_products.id"), nullable=False)
    
    # 属性信息
    attribute_id = Column(Integer, nullable=False)
    attribute_name = Column(String(200))
    attribute_type = Column(String(50))  # text/number/boolean/select等
    
    # 属性值（使用JSON存储不同类型的值）
    value = Column(JSONB)
    
    # 是否必填
    is_required = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    # 关系
    product = relationship("OzonProduct", back_populates="attributes")
    
    __table_args__ = (
        UniqueConstraint("product_id", "attribute_id", name="uq_ozon_attributes"),
    )


class OzonPriceHistory(Base):
    """价格历史记录"""
    __tablename__ = "ozon_price_history"
    
    id = Column(BigInteger, primary_key=True)
    product_id = Column(BigInteger, ForeignKey("ozon_products.id"), nullable=False)
    shop_id = Column(Integer, nullable=False)
    
    # 价格变更
    price_before = Column(Numeric(18, 4))
    price_after = Column(Numeric(18, 4), nullable=False)
    old_price_before = Column(Numeric(18, 4))
    old_price_after = Column(Numeric(18, 4))
    
    # 变更信息
    change_reason = Column(String(200))
    changed_by = Column(String(100))  # user_id or "system"
    source = Column(String(50))  # manual/rule/competitor/promotion
    
    # 生效时间
    effective_at = Column(DateTime(timezone=True), default=utcnow)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    # 关系
    product = relationship("OzonProduct", back_populates="price_history")
    
    __table_args__ = (
        Index("idx_ozon_price_history", "product_id", "effective_at"),
        Index("idx_ozon_price_history_shop", "shop_id", "created_at")
    )


class OzonInventorySnapshot(Base):
    """库存快照（用于对账）"""
    __tablename__ = "ozon_inventory_snapshots"
    
    id = Column(BigInteger, primary_key=True)
    shop_id = Column(Integer, nullable=False)
    warehouse_id = Column(Integer)
    
    # 快照时间
    snapshot_date = Column(DateTime(timezone=True), nullable=False)

    # 库存数据（JSON数组）
    inventory_data = Column(JSONB, nullable=False)
    # 格式: [{"sku": "xxx", "offer_id": "xxx", "stock": 100, "reserved": 10}, ...]

    # 统计
    total_skus = Column(Integer, default=0)
    total_stock = Column(Integer, default=0)
    total_value = Column(Numeric(18, 4))

    # 对账状态
    reconciliation_status = Column(String(50))  # pending/matched/mismatched
    discrepancies = Column(JSONB)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    __table_args__ = (
        Index("idx_ozon_inventory_snapshot", "shop_id", "snapshot_date"),
        Index("idx_ozon_inventory_warehouse", "warehouse_id", "snapshot_date")
    )


class OzonProductSyncError(Base):
    """Ozon 商品同步错误记录"""
    __tablename__ = "ozon_product_sync_errors"

    # 主键
    id = Column(BigInteger, primary_key=True)

    # 店铺隔离
    shop_id = Column(Integer, nullable=False, index=True, comment="店铺ID")

    # 商品关联
    product_id = Column(BigInteger, ForeignKey("ozon_products.id", ondelete="CASCADE"), nullable=True, index=True, comment="关联的商品ID")
    offer_id = Column(String(100), nullable=False, index=True, comment="商品 offer_id")

    # 任务信息
    task_id = Column(BigInteger, nullable=True, index=True, comment="OZON 任务ID")

    # 同步状态
    status = Column(String(50), nullable=True, comment="同步状态")

    # 错误详情（JSONB存储数组）
    errors = Column(JSONB, nullable=True, comment="错误详情数组")

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # 关系
    product = relationship("OzonProduct", backref="sync_errors")

    __table_args__ = (
        Index("idx_ozon_product_sync_errors_composite", "shop_id", "product_id", "created_at"),
        {"extend_existing": True}
    )