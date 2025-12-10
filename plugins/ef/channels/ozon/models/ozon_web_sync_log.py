"""
OZON Web 同步日志模型

记录后端通过浏览器 Cookie 访问 OZON 页面执行同步任务的状态
用于前后端共享执行状态，避免重复执行
"""
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy import (
    BigInteger, String, Text, DateTime, Boolean,
    ForeignKey, func
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.models.base import Base


class OzonWebSyncLog(Base):
    """OZON Web 同步日志"""
    __tablename__ = "ozon_web_sync_logs"

    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="日志ID"
    )

    # 任务类型
    task_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="任务类型: promo_cleaner, invoice_sync, balance_sync"
    )

    # 执行来源
    source: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="backend",
        comment="执行来源: backend, extension"
    )

    # 关联用户（Cookie 所有者）
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户ID"
    )

    # 执行状态
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="running",
        comment="状态: running, success, failed, skipped"
    )

    # 执行时间
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="开始时间"
    )

    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="完成时间"
    )

    # 执行结果摘要
    shops_processed: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        comment="处理的店铺数量"
    )

    shops_success: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        comment="成功的店铺数量"
    )

    shops_failed: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        comment="失败的店铺数量"
    )

    # 错误信息
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="错误信息"
    )

    # 详细结果（JSON）
    details: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=True,
        comment="详细结果"
    )

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="创建时间"
    )

    def __repr__(self) -> str:
        return f"<OzonWebSyncLog(id={self.id}, task_type={self.task_type}, status={self.status})>"

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "task_type": self.task_type,
            "source": self.source,
            "user_id": self.user_id,
            "status": self.status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "shops_processed": self.shops_processed,
            "shops_success": self.shops_success,
            "shops_failed": self.shops_failed,
            "error_message": self.error_message,
            "details": self.details,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
