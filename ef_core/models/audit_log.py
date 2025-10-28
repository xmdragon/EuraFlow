"""
全局审计日志模型
用于记录所有模块的数据修改操作
"""
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, BigInteger, DateTime, Text, Index
)
from sqlalchemy.dialects.postgresql import JSONB, INET

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class AuditLog(Base):
    """
    全局审计日志表

    用于记录用户的数据修改操作，包括：
    - 打印标签
    - 价格修改
    - 订单操作
    - 数据删除
    等

    设计原则：
    1. 全系统统一日志格式
    2. 支持字段级变更追踪
    3. 记录请求上下文（IP、User Agent、Trace ID）
    4. 支持定期归档
    """
    __tablename__ = "audit_logs"

    # 主键
    id = Column(BigInteger, primary_key=True)

    # 用户信息
    user_id = Column(Integer, nullable=False, index=True, comment="用户ID")
    username = Column(String(100), nullable=False, comment="用户名")

    # 操作信息
    module = Column(String(50), nullable=False, index=True, comment="模块名（ozon/finance/user/system）")
    action = Column(String(50), nullable=False, index=True, comment="操作类型（create/update/delete/print）")
    action_display = Column(String(100), nullable=True, comment="操作显示名称（打印标签/修改价格/删除商品）")

    # 数据定位
    table_name = Column(String(100), nullable=False, index=True, comment="表名")
    record_id = Column(String(100), nullable=False, index=True, comment="记录ID（posting_number或主键ID）")

    # 变更详情（JSON格式）
    # 示例: {"price": {"old": "100.00", "new": "120.00"}, "stock": {"old": 10, "new": 8}}
    changes = Column(JSONB, nullable=True, comment="变更详情（字段级）")

    # 请求信息
    ip_address = Column(INET, nullable=True, comment="客户端IP地址")
    user_agent = Column(String(500), nullable=True, comment="User Agent")
    request_id = Column(String(100), nullable=True, index=True, comment="请求ID（trace_id用于追踪）")

    # 备注
    notes = Column(Text, nullable=True, comment="备注信息")

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True, comment="创建时间")

    # 表级索引（复合索引）
    __table_args__ = (
        Index('idx_audit_logs_user_time', 'user_id', 'created_at'),
        Index('idx_audit_logs_module_time', 'module', 'created_at'),
        Index('idx_audit_logs_action_time', 'action', 'created_at'),
        Index('idx_audit_logs_record_lookup', 'table_name', 'record_id'),
    )

    def to_dict(self):
        """转换为字典"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'username': self.username,
            'module': self.module,
            'action': self.action,
            'action_display': self.action_display,
            'table_name': self.table_name,
            'record_id': self.record_id,
            'changes': self.changes,
            'ip_address': str(self.ip_address) if self.ip_address else None,
            'user_agent': self.user_agent,
            'request_id': self.request_id,
            'notes': self.notes,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class AuditLogArchive(Base):
    """
    审计日志归档表

    用于存储超过6个月的历史日志
    结构与 audit_logs 完全相同
    """
    __tablename__ = "audit_logs_archive"

    # 字段结构同 audit_logs
    id = Column(BigInteger, primary_key=True)
    user_id = Column(Integer, nullable=False)
    username = Column(String(100), nullable=False)
    module = Column(String(50), nullable=False)
    action = Column(String(50), nullable=False)
    action_display = Column(String(100), nullable=True)
    table_name = Column(String(100), nullable=False)
    record_id = Column(String(100), nullable=False)
    changes = Column(JSONB, nullable=True)
    ip_address = Column(INET, nullable=True)
    user_agent = Column(String(500), nullable=True)
    request_id = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)

    # 归档表索引（简化版，主要用于查询）
    __table_args__ = (
        Index('idx_audit_logs_archive_time', 'created_at'),
        Index('idx_audit_logs_archive_record', 'table_name', 'record_id'),
    )

    def to_dict(self):
        """转换为字典"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'username': self.username,
            'module': self.module,
            'action': self.action,
            'action_display': self.action_display,
            'table_name': self.table_name,
            'record_id': self.record_id,
            'changes': self.changes,
            'ip_address': str(self.ip_address) if self.ip_address else None,
            'user_agent': self.user_agent,
            'request_id': self.request_id,
            'notes': self.notes,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
