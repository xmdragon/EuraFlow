"""
OZON 商品采集记录数据模型
用于管理跟卖上架和普通采集两种场景
"""
from datetime import datetime, timezone

from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Boolean, DateTime, ForeignKey, Index, CheckConstraint
)
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class OzonProductCollectionRecord(Base):
    """OZON 商品采集记录表"""
    __tablename__ = "ozon_product_collection_records"

    # 主键与用户隔离
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        comment="创建用户ID"
    )
    shop_id = Column(
        Integer,
        ForeignKey("ozon_shops.id", ondelete="SET NULL"),
        nullable=True,
        comment="店铺ID（可选）"
    )

    # 采集类型（核心区分字段）
    collection_type = Column(
        String(20),
        nullable=False,
        comment="采集类型：follow_pdp（跟卖上架）| collect_only（仅采集）| relist（下架重上）| manual（手动新建）"
    )

    # 采集来源
    source_url = Column(
        Text,
        nullable=False,
        comment="商品来源URL（OZON商品详情页）"
    )
    source_product_id = Column(
        String(100),
        nullable=True,
        comment="来源商品ID（OZON商品ID）"
    )

    # 商品数据（JSONB格式，包含标题、图片、规格、变体等）
    product_data = Column(
        JSONB,
        nullable=False,
        comment="完整商品数据（标题、图片、尺寸、重量、变体等）"
    )

    # 跟卖上架专属字段（仅 collection_type='follow_pdp' 时使用）
    listing_request_payload = Column(
        JSONB,
        nullable=True,
        comment="发送给 OZON API 的上架请求数据"
    )
    listing_task_count = Column(
        Integer,
        nullable=True,
        comment="Celery 任务数量（变体数）"
    )
    listing_status = Column(
        String(50),
        nullable=True,
        comment="上架状态：pending | processing | success | failed"
    )
    listing_product_id = Column(
        BigInteger,
        nullable=True,
        comment="上架成功后关联的正式商品ID（ozon_products.id）"
    )
    listing_error_message = Column(
        Text,
        nullable=True,
        comment="上架失败的错误信息"
    )
    listing_at = Column(
        DateTime(timezone=True),
        nullable=True,
        comment="上架时间（UTC）"
    )
    listing_source = Column(
        String(20),
        nullable=True,
        comment="上架方式：follow（跟卖上架）| manual（手动上架）| edit（编辑上架）"
    )

    # 状态管理
    is_read = Column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否已读"
    )
    is_deleted = Column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否软删除"
    )

    # 用户行为记录
    last_edited_at = Column(
        DateTime(timezone=True),
        nullable=True,
        comment="最后编辑时间（UTC）"
    )
    last_edited_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        comment="最后编辑用户ID"
    )

    # 元信息
    created_at = Column(
        DateTime(timezone=True),
        default=utcnow,
        nullable=False,
        comment="创建时间（UTC）"
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
        comment="更新时间（UTC）"
    )

    __table_args__ = (
        # 索引
        Index("idx_collection_user", "user_id", "created_at"),
        Index("idx_collection_type_status", "collection_type", "listing_status"),
        Index(
            "idx_collection_shop",
            "shop_id",
            postgresql_where=(Column("shop_id").isnot(None))
        ),
        Index(
            "idx_collection_not_deleted",
            "user_id",
            "collection_type",
            postgresql_where=(Column("is_deleted") == False)  # noqa: E712
        ),

        # 检查约束
        CheckConstraint(
            "collection_type IN ('follow_pdp', 'collect_only', 'relist', 'manual')",
            name="chk_collection_type"
        ),
    )
