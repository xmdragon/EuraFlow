"""
Ozon类目佣金数据模型
"""
from datetime import datetime
from typing import Optional
from decimal import Decimal
from sqlalchemy import String, DateTime, func, Index, DECIMAL
from sqlalchemy.orm import Mapped, mapped_column

from ef_core.models.base import Base


class OzonCategoryCommission(Base):
    """Ozon类目佣金模型"""
    __tablename__ = "ozon_category_commissions"
    __table_args__ = (
        Index("idx_ozon_category_commissions_module", "category_module"),
        Index("idx_ozon_category_commissions_name", "category_name"),
    )

    # 主键
    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
        comment="佣金记录ID"
    )

    # 类目信息
    category_module: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="类目模块（一级类目，如：美容、电子产品）"
    )

    category_name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="商品类目（二级类目，如：专业医疗设备）"
    )

    # rFBS方案佣金（三个价格区间）
    rfbs_tier1: Mapped[Decimal] = mapped_column(
        DECIMAL(5, 2),
        nullable=False,
        comment="rFBS方案佣金 - 最多1500卢布（含）"
    )

    rfbs_tier2: Mapped[Decimal] = mapped_column(
        DECIMAL(5, 2),
        nullable=False,
        comment="rFBS方案佣金 - 最多5000卢布（含）"
    )

    rfbs_tier3: Mapped[Decimal] = mapped_column(
        DECIMAL(5, 2),
        nullable=False,
        comment="rFBS方案佣金 - 超过5000卢布"
    )

    # FBP方案佣金（三个价格区间）
    fbp_tier1: Mapped[Decimal] = mapped_column(
        DECIMAL(5, 2),
        nullable=False,
        comment="FBP方案佣金 - 最多1500卢布（含）"
    )

    fbp_tier2: Mapped[Decimal] = mapped_column(
        DECIMAL(5, 2),
        nullable=False,
        comment="FBP方案佣金 - 最多5000卢布（含）"
    )

    fbp_tier3: Mapped[Decimal] = mapped_column(
        DECIMAL(5, 2),
        nullable=False,
        comment="FBP方案佣金 - 超过5000卢布"
    )

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="创建时间"
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        comment="更新时间"
    )

    def __repr__(self) -> str:
        module_val = self.__dict__.get('category_module', '?')
        name_val = self.__dict__.get('category_name', '?')
        return f"<OzonCategoryCommission(module={module_val}, name={name_val})>"

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "category_module": self.category_module,
            "category_name": self.category_name,
            "rfbs_tier1": float(self.rfbs_tier1),
            "rfbs_tier2": float(self.rfbs_tier2),
            "rfbs_tier3": float(self.rfbs_tier3),
            "fbp_tier1": float(self.fbp_tier1),
            "fbp_tier2": float(self.fbp_tier2),
            "fbp_tier3": float(self.fbp_tier3),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
