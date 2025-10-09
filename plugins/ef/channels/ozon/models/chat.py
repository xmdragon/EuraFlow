"""
OZON聊天消息数据模型
处理买家和客服的聊天消息
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Column, String, Integer, BigInteger,
    Boolean, DateTime, Text, Index, UniqueConstraint, ForeignKey
)
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


class OzonChatMessage(Base):
    """OZON聊天消息"""
    __tablename__ = "ozon_chat_messages"

    id = Column(BigInteger, primary_key=True)

    # 店铺信息
    shop_id = Column(Integer, nullable=False, index=True)

    # 聊天和消息标识
    chat_id = Column(String(100), nullable=False, index=True)
    message_id = Column(String(100), nullable=False, unique=True)

    # 消息类型和发送者
    message_type = Column(String(50))  # text/image/file等
    sender_type = Column(String(50), nullable=False)  # user(买家)/support(客服)/seller(卖家)
    sender_id = Column(String(100))  # 发送者ID
    sender_name = Column(String(200))  # 发送者姓名

    # 消息内容
    content = Column(Text)  # 文本消息内容
    content_data = Column(JSONB)  # 富文本/附件等额外数据

    # 状态
    is_read = Column(Boolean, default=False)  # 是否已读
    is_deleted = Column(Boolean, default=False)  # 是否删除
    is_edited = Column(Boolean, default=False)  # 是否编辑过

    # 关联信息
    order_number = Column(String(100))  # 关联的订单号
    product_id = Column(BigInteger)  # 关联的商品ID

    # 元数据
    metadata = Column(JSONB)  # 其他元数据

    # 时间
    read_at = Column(DateTime)  # 已读时间
    edited_at = Column(DateTime)  # 编辑时间
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_ozon_chat_shop_chat", "shop_id", "chat_id", "created_at"),
        Index("idx_ozon_chat_unread", "shop_id", "is_read", "created_at"),
    )


class OzonChat(Base):
    """OZON聊天会话"""
    __tablename__ = "ozon_chats"

    id = Column(BigInteger, primary_key=True)

    # 店铺信息
    shop_id = Column(Integer, nullable=False, index=True)

    # 聊天标识
    chat_id = Column(String(100), nullable=False, unique=True)

    # 聊天类型和主题
    chat_type = Column(String(50))  # order/product/general
    subject = Column(String(500))  # 聊天主题

    # 参与者
    customer_id = Column(String(100))  # 买家ID
    customer_name = Column(String(200))  # 买家姓名

    # 状态
    status = Column(String(50), default="open")  # open/closed/archived
    is_closed = Column(Boolean, default=False)

    # 关联信息
    order_number = Column(String(100))  # 关联的订单号
    product_id = Column(BigInteger)  # 关联的商品ID

    # 统计
    message_count = Column(Integer, default=0)  # 消息总数
    unread_count = Column(Integer, default=0)  # 未读消息数

    # 最后消息
    last_message_at = Column(DateTime)  # 最后消息时间
    last_message_preview = Column(String(500))  # 最后消息预览

    # 元数据
    metadata = Column(JSONB)

    # 时间
    closed_at = Column(DateTime)  # 关闭时间
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_ozon_chat_shop_status", "shop_id", "status", "last_message_at"),
        Index("idx_ozon_chat_order", "order_number"),
    )
