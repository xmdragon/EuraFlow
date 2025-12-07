"""
同步服务配置模型
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Index
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

    # Celery 集成字段
    celery_task_name = Column(String(200), comment="Celery任务名（如 ef.ozon.orders.pull）")
    plugin_name = Column(String(100), comment="所属插件标识")
    source = Column(String(20), default="code", comment="配置来源: code=代码注册 | manual=手动添加")
    is_deleted = Column(Boolean, default=False, comment="是否已从代码中移除（软删除）")

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
        Index("idx_sync_services_celery_task", "celery_task_name"),
        {'extend_existing': True}  # 允许在同一进程中多次导入模型（Celery worker需要）
    )
