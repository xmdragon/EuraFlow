"""跨境巴士全局配置模型"""

from datetime import datetime
from typing import Optional, Dict, Any

from sqlalchemy import Boolean, Integer, String, Text, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ef_core.database import Base


class Kuajing84GlobalConfig(Base):
    """跨境巴士全局配置表（单例模式，只有一条记录）"""

    __tablename__ = "kuajing84_global_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, comment="主键（固定为1）")
    username: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="跨境巴士用户名")
    password: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="跨境巴士密码（加密存储）")
    base_url: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        server_default="https://www.kuajing84.com",
        comment="跨境巴士网站地址"
    )
    cookie: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True, comment="登录Cookie（加密存储）")
    cookie_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Cookie过期时间"
    )
    customer_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="客户ID（从控制台页面获取）")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", comment="是否启用")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间"
    )
