"""
OZON 商品上架相关数据模型
包含类目、属性、字典值和导入日志
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, Dict, Any, List
from sqlalchemy import (
    Column, String, Integer, BigInteger, Numeric, Boolean, DateTime,
    Text, ForeignKey, Index, UniqueConstraint, TIMESTAMP
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


# ============================
# 类目与属性缓存模型
# ============================

class OzonCategory(Base):
    """OZON类目缓存表"""
    __tablename__ = "ozon_categories"

    category_id = Column(Integer, primary_key=True)
    parent_id = Column(Integer, ForeignKey("ozon_categories.category_id", ondelete="SET NULL"))
    name = Column(String(500), nullable=False)
    is_leaf = Column(Boolean, default=False, comment="是否叶子类目(只有叶子类目可建品)")
    is_disabled = Column(Boolean, default=False)
    level = Column(Integer, default=0, comment="层级深度")
    full_path = Column(String(2000), comment="完整路径(用/分隔)")

    # 缓存信息
    cached_at = Column(DateTime(timezone=True), default=utcnow)
    last_updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # 关系
    parent = relationship("OzonCategory", remote_side=[category_id], backref="children")
    attributes = relationship("OzonCategoryAttribute", back_populates="category", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_ozon_categories_parent", "parent_id"),
        Index("idx_ozon_categories_leaf", "is_leaf", postgresql_where=(Column("is_leaf") == True)),
        # 全文搜索索引(使用Russian分词)
        Index("idx_ozon_categories_name", "name", postgresql_using="gin",
              postgresql_ops={"name": "gin_trgm_ops"}),
        {"extend_existing": True}
    )


class OzonCategoryAttribute(Base):
    """OZON类目属性缓存表"""
    __tablename__ = "ozon_category_attributes"

    id = Column(BigInteger, primary_key=True)
    category_id = Column(Integer, ForeignKey("ozon_categories.category_id"), nullable=False)
    attribute_id = Column(Integer, nullable=False)

    # 属性基本信息
    name = Column(String(500), nullable=False)
    description = Column(Text)
    attribute_type = Column(String(50), nullable=False, comment="string/number/boolean/dictionary/multivalue")

    # 约束信息
    is_required = Column(Boolean, default=False, comment="是否必填")
    is_collection = Column(Boolean, default=False, comment="是否多值属性")
    dictionary_id = Column(Integer, comment="字典ID(如果是字典类型)")

    # 范围约束(用于数值型)
    min_value = Column(Numeric(18, 4))
    max_value = Column(Numeric(18, 4))

    # 缓存信息
    cached_at = Column(DateTime(timezone=True), default=utcnow)

    # 关系
    category = relationship("OzonCategory", back_populates="attributes")
    dictionary_values = relationship("OzonAttributeDictionaryValue", foreign_keys="[OzonAttributeDictionaryValue.dictionary_id]",
                                     primaryjoin="OzonCategoryAttribute.dictionary_id == foreign(OzonAttributeDictionaryValue.dictionary_id)",
                                     viewonly=True)

    __table_args__ = (
        UniqueConstraint("category_id", "attribute_id", name="uq_ozon_category_attrs"),
        Index("idx_ozon_category_attrs_category", "category_id"),
        Index("idx_ozon_category_attrs_required", "category_id", "is_required",
              postgresql_where=(Column("is_required") == True)),
        Index("idx_ozon_category_attrs_dict", "dictionary_id",
              postgresql_where=(Column("dictionary_id").isnot(None))),
        {"extend_existing": True}
    )


class OzonAttributeDictionaryValue(Base):
    """OZON属性字典值缓存表"""
    __tablename__ = "ozon_attribute_dictionary_values"

    id = Column(BigInteger, primary_key=True)
    dictionary_id = Column(Integer, nullable=False)
    value_id = Column(BigInteger, nullable=False)

    # 值信息
    value = Column(Text, nullable=False)
    info = Column(Text)
    picture = Column(String(500))

    # 缓存信息
    cached_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        UniqueConstraint("dictionary_id", "value_id", name="uq_ozon_dict_values"),
        Index("idx_ozon_dict_values_dict", "dictionary_id"),
        # 全文搜索索引
        Index("idx_ozon_dict_values_search", "value", postgresql_using="gin",
              postgresql_ops={"value": "gin_trgm_ops"}),
        {"extend_existing": True}
    )


# ============================
# 商品上架日志模型
# ============================

class OzonMediaImportLog(Base):
    """OZON媒体导入日志表"""
    __tablename__ = "ozon_media_import_logs"

    id = Column(BigInteger, primary_key=True)
    shop_id = Column(Integer, nullable=False)
    offer_id = Column(String(100), nullable=False)

    # 图片信息
    source_url = Column(Text, nullable=False, comment="Cloudinary URL")
    file_name = Column(String(500))
    position = Column(Integer, default=0, comment="图片位置(0=主图)")

    # OZON响应
    ozon_file_id = Column(String(100))
    ozon_url = Column(Text)
    task_id = Column(String(100))

    # 状态
    state = Column(String(50), default="pending", comment="pending/uploading/uploaded/failed")
    error_code = Column(String(100))
    error_message = Column(Text)

    # 重试信息
    retry_count = Column(Integer, default=0)
    last_retry_at = Column(DateTime(timezone=True))

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("idx_ozon_media_logs_offer", "shop_id", "offer_id"),
        Index("idx_ozon_media_logs_state", "state", "created_at"),
        Index("idx_ozon_media_logs_task", "task_id",
              postgresql_where=(Column("task_id").isnot(None))),
        {"extend_existing": True}
    )


class OzonProductImportLog(Base):
    """OZON商品导入日志表"""
    __tablename__ = "ozon_product_import_logs"

    id = Column(BigInteger, primary_key=True)
    shop_id = Column(Integer, nullable=False)
    offer_id = Column(String(100), nullable=False)

    # 请求信息
    import_mode = Column(String(20), default="NEW_CARD", comment="NEW_CARD/FOLLOW_PDP")
    request_payload = Column(JSONB, nullable=False)

    # OZON响应
    task_id = Column(String(100))
    response_payload = Column(JSONB)

    # 状态
    state = Column(String(50), default="submitted", comment="submitted/processing/created/price_sent/failed")
    error_code = Column(String(100))
    error_message = Column(Text)
    errors = Column(JSONB, comment="详细错误列表")

    # 结果
    ozon_product_id = Column(BigInteger)
    ozon_sku = Column(BigInteger)

    # 重试信息
    retry_count = Column(Integer, default=0)
    last_retry_at = Column(DateTime(timezone=True))

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("idx_ozon_product_logs_offer", "shop_id", "offer_id"),
        Index("idx_ozon_product_logs_state", "state", "created_at"),
        Index("idx_ozon_product_logs_task", "task_id",
              postgresql_where=(Column("task_id").isnot(None))),
        {"extend_existing": True}
    )


class OzonPriceUpdateLog(Base):
    """OZON价格更新日志表"""
    __tablename__ = "ozon_price_update_logs"

    id = Column(BigInteger, primary_key=True)
    shop_id = Column(Integer, nullable=False)
    offer_id = Column(String(100), nullable=False)

    # 价格信息
    currency_code = Column(String(10), default="RUB")
    price = Column(Numeric(18, 4), nullable=False)
    old_price = Column(Numeric(18, 4))
    min_price = Column(Numeric(18, 4))

    # 定价策略
    auto_action_enabled = Column(Boolean, default=False)
    price_strategy_enabled = Column(Boolean, default=False)

    # 状态
    state = Column(String(50), default="pending", comment="pending/accepted/failed")
    error_message = Column(Text)

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("idx_ozon_price_logs_offer", "shop_id", "offer_id", "created_at"),
        Index("idx_ozon_price_logs_state", "state", "created_at"),
        {"extend_existing": True}
    )


class OzonStockUpdateLog(Base):
    """OZON库存更新日志表"""
    __tablename__ = "ozon_stock_update_logs"

    id = Column(BigInteger, primary_key=True)
    shop_id = Column(Integer, nullable=False)
    offer_id = Column(String(100), nullable=False)

    # 库存信息
    product_id = Column(BigInteger)
    warehouse_id = Column(Integer, nullable=False)
    stock = Column(Integer, nullable=False)

    # 状态
    state = Column(String(50), default="pending", comment="pending/accepted/failed")
    error_message = Column(Text)

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("idx_ozon_stock_logs_offer", "shop_id", "offer_id", "created_at"),
        Index("idx_ozon_stock_logs_state", "state", "created_at"),
        Index("idx_ozon_stock_logs_warehouse", "warehouse_id", "created_at"),
        {"extend_existing": True}
    )
