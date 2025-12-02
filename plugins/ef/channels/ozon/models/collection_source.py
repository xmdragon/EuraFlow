"""
OZON 自动采集地址数据模型
用于管理需要定期自动采集的类目或店铺 URL
"""
from datetime import datetime, timezone

from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Boolean, DateTime,
    ForeignKey, Index, UniqueConstraint, CheckConstraint
)

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class OzonCollectionSource(Base):
    """OZON 自动采集地址表"""
    __tablename__ = "ozon_collection_sources"

    # 主键
    id = Column(BigInteger, primary_key=True, autoincrement=True)

    # 用户隔离
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        comment="用户ID"
    )

    # 采集源信息
    source_type = Column(
        String(20),
        nullable=False,
        comment="类型：category（类目页）| seller（店铺页）"
    )
    source_url = Column(
        Text,
        nullable=False,
        comment="完整 URL"
    )
    source_path = Column(
        String(500),
        nullable=False,
        comment="URL 路径部分（用于批次名，如 /category/elektronika-15500/）"
    )
    display_name = Column(
        String(200),
        nullable=True,
        comment="显示名称（用户自定义）"
    )

    # 采集配置
    is_enabled = Column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否启用"
    )
    priority = Column(
        Integer,
        default=0,
        nullable=False,
        comment="优先级（数值越高优先级越高）"
    )
    target_count = Column(
        Integer,
        default=100,
        nullable=False,
        comment="每次采集目标数量"
    )

    # 采集状态
    status = Column(
        String(20),
        default='pending',
        nullable=False,
        comment="状态：pending | collecting | completed | failed"
    )
    last_collected_at = Column(
        DateTime(timezone=True),
        nullable=True,
        comment="上次采集完成时间（UTC）"
    )
    last_product_count = Column(
        Integer,
        default=0,
        nullable=False,
        comment="上次采集的商品数量"
    )
    total_collected_count = Column(
        Integer,
        default=0,
        nullable=False,
        comment="累计采集商品数量"
    )

    # 错误信息
    last_error = Column(
        Text,
        nullable=True,
        comment="最后一次错误信息"
    )
    error_count = Column(
        Integer,
        default=0,
        nullable=False,
        comment="连续错误次数"
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
        # 唯一约束：同一用户不能添加相同路径的地址
        UniqueConstraint('user_id', 'source_path', name='uq_collection_source_user_path'),

        # 索引
        Index('idx_collection_source_user_enabled', 'user_id', 'is_enabled'),
        Index('idx_collection_source_last_collected', 'last_collected_at'),
        Index('idx_collection_source_status', 'user_id', 'status'),

        # 检查约束
        CheckConstraint(
            "source_type IN ('category', 'seller')",
            name="chk_collection_source_type"
        ),
        CheckConstraint(
            "status IN ('pending', 'collecting', 'completed', 'failed')",
            name="chk_collection_source_status"
        ),
        CheckConstraint(
            "target_count > 0",
            name="chk_collection_source_target_count"
        ),
    )

    def __repr__(self):
        return f"<OzonCollectionSource(id={self.id}, type={self.source_type}, path={self.source_path})>"
