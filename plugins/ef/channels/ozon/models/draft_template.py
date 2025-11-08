"""
OZON 商品草稿与模板数据模型
"""
from datetime import datetime, timezone

from sqlalchemy import (
    Column, Integer, BigInteger, String, DateTime, ForeignKey, Index, CheckConstraint, ARRAY
)
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class OzonProductTemplate(Base):
    """OZON 商品草稿与模板表"""
    __tablename__ = "ozon_product_templates"

    # 主键与用户隔离
    id = Column(BigInteger, primary_key=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        comment="创建用户ID"
    )

    # 业务分类
    template_type = Column(
        String(20),
        nullable=False,
        comment="draft | template"
    )
    template_name = Column(
        String(200),
        comment="模板名称（草稿可为空）"
    )

    # 关联信息（用于筛选和展示）
    shop_id = Column(Integer, comment="店铺ID（可选，用于筛选）")
    category_id = Column(Integer, comment="类目ID（可选，用于展示）")

    # 完整表单数据（JSONB）
    form_data = Column(
        JSONB,
        nullable=False,
        comment="完整表单数据（包括基础信息、特征值、图片、变体等）"
    )

    # 标签（仅用于模板）
    tags = Column(
        ARRAY(String(50)),
        comment="模板标签（最多10个）"
    )

    # 使用统计（仅用于模板）
    used_count = Column(
        Integer,
        default=0,
        nullable=False,
        comment="模板使用次数"
    )
    last_used_at = Column(
        DateTime(timezone=True),
        comment="最后使用时间（UTC）"
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
        Index("idx_templates_user_type", "user_id", "template_type"),
        Index(
            "idx_templates_shop",
            "shop_id",
            postgresql_where=(Column("shop_id").isnot(None))
        ),
        Index(
            "idx_templates_category",
            "category_id",
            postgresql_where=(Column("category_id").isnot(None))
        ),
        Index("idx_templates_updated_at", "updated_at"),

        # 唯一约束：每个用户只能有一个草稿
        Index(
            "idx_templates_user_draft",
            "user_id",
            unique=True,
            postgresql_where=(Column("template_type") == "draft")
        ),

        # 检查约束
        CheckConstraint(
            "template_type IN ('draft', 'template')",
            name="ck_template_type"
        ),
    )
