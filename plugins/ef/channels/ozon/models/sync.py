"""
同步和运维相关数据模型
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Column, String, Integer, BigInteger, 
    Boolean, DateTime, JSON, Index, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class OzonSyncCheckpoint(Base):
    """同步检查点（断点续传）"""
    __tablename__ = "ozon_sync_checkpoints"
    
    id = Column(BigInteger, primary_key=True)
    
    # 店铺和实体类型
    shop_id = Column(Integer, nullable=False)
    entity_type = Column(String(50), nullable=False)  # products/orders/postings/inventory
    
    # 检查点信息
    last_cursor = Column(String(500))  # 游标或last_id
    last_sync_at = Column(DateTime(timezone=True))
    last_modified_at = Column(DateTime(timezone=True))  # 最后修改时间（用于增量同步）
    
    # 同步状态
    status = Column(String(50), default="idle")  # idle/running/failed
    error_message = Column(String(1000))
    retry_count = Column(Integer, default=0)
    
    # 统计
    total_processed = Column(BigInteger, default=0)
    total_success = Column(BigInteger, default=0)
    total_failed = Column(BigInteger, default=0)
    
    # 配置
    config = Column(JSONB)  # 同步配置（批次大小、筛选条件等）
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    __table_args__ = (
        UniqueConstraint("shop_id", "entity_type", name="uq_ozon_checkpoint"),
        Index("idx_ozon_checkpoint_status", "status", "last_sync_at")
    )


class OzonSyncLog(Base):
    """同步日志"""
    __tablename__ = "ozon_sync_logs"
    
    id = Column(BigInteger, primary_key=True)
    
    # 基本信息
    shop_id = Column(Integer, nullable=False)
    entity_type = Column(String(50), nullable=False)
    sync_type = Column(String(50))  # full/incremental/webhook
    
    # 同步批次
    batch_id = Column(String(100))
    batch_size = Column(Integer)
    
    # 结果
    status = Column(String(50), nullable=False)  # started/success/failed/partial
    processed_count = Column(Integer, default=0)
    success_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    skipped_count = Column(Integer, default=0)
    
    # 详细信息
    error_message = Column(String(2000))
    error_details = Column(JSONB)  # 错误详情（包含失败的ID列表等）
    
    # 性能指标
    duration_ms = Column(Integer)  # 执行时长（毫秒）
    api_calls = Column(Integer)  # API调用次数
    rate_limit_hits = Column(Integer, default=0)  # 触发限流次数
    
    # 时间
    started_at = Column(DateTime(timezone=True), nullable=False)
    completed_at = Column(DateTime(timezone=True))
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    __table_args__ = (
        Index("idx_ozon_sync_log_shop", "shop_id", "entity_type", "started_at"),
        Index("idx_ozon_sync_log_status", "status", "started_at"),
        Index("idx_ozon_sync_log_batch", "batch_id")
    )


class OzonWebhookEvent(Base):
    """Webhook 事件记录"""
    __tablename__ = "ozon_webhook_events"
    
    id = Column(BigInteger, primary_key=True)
    
    # 事件信息
    event_id = Column(String(200), nullable=False, unique=True)
    event_type = Column(String(100), nullable=False)  # order.created/posting.status_changed等
    
    # 店铺
    shop_id = Column(Integer, nullable=False)
    
    # 载荷
    payload = Column(JSONB, nullable=False)
    headers = Column(JSONB)
    
    # 签名验证
    signature = Column(String(500))
    is_verified = Column(Boolean, default=False)
    
    # 处理状态
    status = Column(String(50), default="pending")  # pending/processing/processed/failed/ignored
    processed_at = Column(DateTime(timezone=True))
    retry_count = Column(Integer, default=0)
    
    # 幂等性
    idempotency_key = Column(String(200))
    
    # 错误信息
    error_message = Column(String(1000))
    
    # 关联实体
    entity_type = Column(String(50))  # order/posting/product等
    entity_id = Column(String(100))  # 关联的实体ID
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    __table_args__ = (
        Index("idx_ozon_webhook_status", "status", "created_at"),
        Index("idx_ozon_webhook_shop", "shop_id", "event_type", "created_at"),
        Index("idx_ozon_webhook_idempotency", "idempotency_key"),
        Index("idx_ozon_webhook_entity", "entity_type", "entity_id")
    )


class OzonApiMetrics(Base):
    """API 调用指标"""
    __tablename__ = "ozon_api_metrics"
    
    id = Column(BigInteger, primary_key=True)
    
    # 基本信息
    shop_id = Column(Integer, nullable=False)
    endpoint = Column(String(200), nullable=False)
    method = Column(String(10), nullable=False)
    
    # 请求信息
    request_id = Column(String(100))
    correlation_id = Column(String(100))
    
    # 响应
    status_code = Column(Integer)
    response_time_ms = Column(Integer)
    
    # 错误
    is_error = Column(Boolean, default=False)
    error_code = Column(String(100))
    error_message = Column(String(500))
    
    # 限流
    is_rate_limited = Column(Boolean, default=False)
    retry_after = Column(Integer)
    
    # 时间
    requested_at = Column(DateTime(timezone=True), nullable=False)
    
    __table_args__ = (
        Index("idx_ozon_metrics_shop", "shop_id", "requested_at"),
        Index("idx_ozon_metrics_endpoint", "endpoint", "status_code"),
        Index("idx_ozon_metrics_errors", "is_error", "error_code", "requested_at")
    )


class OzonOutboxEvent(Base):
    """Outbox 模式事件表（保证分布式事务）"""
    __tablename__ = "ozon_outbox_events"
    
    id = Column(BigInteger, primary_key=True)
    
    # 事件信息
    event_id = Column(String(100), nullable=False, unique=True)
    event_type = Column(String(100), nullable=False)
    
    # 聚合根
    aggregate_type = Column(String(50), nullable=False)  # order/product/posting
    aggregate_id = Column(String(100), nullable=False)
    
    # 事件数据
    event_data = Column(JSONB, nullable=False)
    
    # 发送状态
    status = Column(String(50), default="pending")  # pending/sent/failed
    sent_at = Column(DateTime(timezone=True))
    retry_count = Column(Integer, default=0)
    next_retry_at = Column(DateTime(timezone=True))
    
    # 错误信息
    error_message = Column(String(1000))
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    __table_args__ = (
        Index("idx_ozon_outbox_status", "status", "next_retry_at"),
        Index("idx_ozon_outbox_aggregate", "aggregate_type", "aggregate_id")
    )