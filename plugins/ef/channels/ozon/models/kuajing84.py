"""跨境巴士同步相关模型"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, String, Text, Integer, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


class Kuajing84SyncLog(Base):
    """跨境巴士同步日志表"""

    __tablename__ = "kuajing84_sync_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="主键ID")
    ozon_order_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("ozon_orders.id", ondelete="CASCADE"),
        nullable=False,
        comment="OZON订单ID"
    )
    shop_id: Mapped[int] = mapped_column(Integer, nullable=False, comment="店铺ID")
    order_number: Mapped[str] = mapped_column(String(100), nullable=False, comment="订单号")
    logistics_order: Mapped[str] = mapped_column(String(100), nullable=False, comment="国内物流单号")
    kuajing84_oid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="跨境巴士订单OID")
    sync_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="pending",
        comment="同步状态: pending/success/failed"
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="错误信息")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", comment="尝试次数")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default="now()",
        comment="创建时间"
    )
    synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="同步成功时间"
    )

    # 关系
    ozon_order = relationship("OzonOrder", back_populates="kuajing84_sync_logs")

    __table_args__ = (
        Index("ix_kuajing84_sync_logs_order_id", "ozon_order_id"),
        Index("ix_kuajing84_sync_logs_status", "shop_id", "sync_status"),
        Index("ix_kuajing84_sync_logs_order_number", "order_number"),
    )

    def __repr__(self) -> str:
        return (
            f"<Kuajing84SyncLog(id={self.id}, order_number={self.order_number}, "
            f"status={self.sync_status})>"
        )
