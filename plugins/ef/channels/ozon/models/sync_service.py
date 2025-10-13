"""
同步服务配置和日志模型
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, BigInteger, String, Boolean, DateTime, Text, Index
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class SyncService(Base):
    """同步服务配置表"""
    __tablename__ = "sync_services"

    id = Column(Integer, primary_key=True)

    # 服务标识
    service_key = Column(String(100), nullable=False, unique=True, comment="服务唯一标识")
    service_name = Column(String(200), nullable=False, comment="服务显示名称")
    service_description = Column(Text, comment="服务功能说明")

    # 调度配置
    service_type = Column(String(20), nullable=False, default="interval", comment="调度类型: cron定时 | interval周期")
    schedule_config = Column(String(200), nullable=False, comment="调度配置：cron表达式或间隔秒数")
    is_enabled = Column(Boolean, nullable=False, default=True, comment="启用开关")

    # 运行状态
    last_run_at = Column(DateTime(timezone=True), comment="最后运行时间")
    last_run_status = Column(String(20), comment="最后运行状态: success/failed/running")
    last_run_message = Column(Text, comment="最后运行日志摘要")

    # 统计信息
    run_count = Column(Integer, nullable=False, default=0, comment="总运行次数")
    success_count = Column(Integer, nullable=False, default=0, comment="成功次数")
    error_count = Column(Integer, nullable=False, default=0, comment="失败次数")

    # 服务特定配置
    config_json = Column(JSONB, comment="服务特定配置（如批次大小、超时时间）")

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow, comment="创建时间")
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, comment="更新时间")

    __table_args__ = (
        Index("idx_sync_services_enabled", "is_enabled", "service_type"),
        Index("idx_sync_services_last_run", "last_run_at"),
    )


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
    metadata = Column(JSONB, comment="附加元数据")

    __table_args__ = (
        Index("idx_sync_logs_service", "service_key", "started_at"),
        Index("idx_sync_logs_status", "status", "started_at"),
        Index("idx_sync_logs_run_id", "run_id"),
    )
