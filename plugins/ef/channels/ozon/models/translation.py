"""阿里云翻译配置模型"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Integer, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ef_core.database import Base


class AliyunTranslationConfig(Base):
    """阿里云翻译配置表（单例模式，只有一条记录）"""

    __tablename__ = "aliyun_translation_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, comment="主键（固定为1）")
    access_key_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, comment="阿里云AccessKey ID"
    )
    access_key_secret_encrypted: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="加密的AccessKey Secret (TODO: 实现加密)"
    )
    region_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        server_default="cn-hangzhou",
        comment="阿里云区域ID"
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", comment="是否启用"
    )
    last_test_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="最后测试连接时间"
    )
    last_test_success: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True, comment="最后测试是否成功"
    )
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
