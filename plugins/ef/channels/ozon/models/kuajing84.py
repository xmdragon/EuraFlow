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
    shop_id: Mapped[int] = mapped_column(Integer, nullable=False, comment="店铺ID")
    order_number: Mapped[str] = mapped_column(String(100), nullable=False, comment="订单号(posting_number)")
    logistics_order: Mapped[str] = mapped_column(String(100), nullable=False, comment="国内物流单号")
    kuajing84_oid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="跨境巴士订单OID")
    sync_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="submit_tracking",
        comment="同步类型: submit_tracking/discard_order"
    )
    posting_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("ozon_postings.id", ondelete="CASCADE"),
        nullable=True,
        comment="货件ID（关联ozon_postings表）"
    )
    sync_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="pending",
        comment="同步状态: pending/in_progress/success/failed"
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="错误信息")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", comment="尝试次数")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default="now()",
        comment="创建时间"
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="开始同步时间"
    )
    synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="同步成功时间"
    )

    __table_args__ = (
        Index("ix_kuajing84_sync_logs_status", "shop_id", "sync_status"),
        Index("ix_kuajing84_sync_logs_order_number", "order_number"),
        Index("ix_kuajing84_sync_logs_posting_id", "posting_id"),
    )

    def __repr__(self) -> str:
        # Use __dict__.get() to avoid lazy loading
        id_val = self.__dict__.get('id', '?')
        order_number_val = self.__dict__.get('order_number', '?')
        status_val = self.__dict__.get('sync_status', '?')
        return (
            f"<Kuajing84SyncLog(id={id_val}, order_number={order_number_val}, "
            f"status={status_val})>"
        )
