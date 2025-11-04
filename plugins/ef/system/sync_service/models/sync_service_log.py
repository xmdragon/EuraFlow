"""
同步服务执行日志模型
"""
from sqlalchemy import Column, BigInteger, Integer, String, DateTime, Text, Index
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


class SyncServiceLog(Base):
    """同步服务执行日志表"""
    __tablename__ = "sync_service_logs"

    id = Column(BigInteger, primary_key=True)

    # 服务标识
    service_key = Column(String(100), nullable=False, comment="服务标识")
    run_id = Column(String(100), nullable=False, comment="运行批次ID")

    # 执行信息
    started_at = Column(DateTime(timezone=True), nullable=False, comment="开始时间")
    finished_at = Column(DateTime(timezone=True), comment="完成时间")
    status = Column(String(20), nullable=False, comment="运行状态: success/failed")

    # 统计信息
    records_processed = Column(Integer, default=0, comment="处理记录数")
    records_updated = Column(Integer, default=0, comment="更新记录数")
    execution_time_ms = Column(Integer, comment="执行耗时（毫秒）")

    # 错误信息
    error_message = Column(Text, comment="错误详情")
    error_stack = Column(Text, comment="错误堆栈")

    # 额外数据
    extra_data = Column(JSONB, comment="附加元数据")

    __table_args__ = (
        Index("idx_sync_logs_service", "service_key", "started_at"),
        Index("idx_sync_logs_status", "status", "started_at"),
        Index("idx_sync_logs_run_id", "run_id"),
        {'extend_existing': True}  # 允许在同一进程中多次导入模型（Celery worker需要）
    )
