"""ChatGPT翻译配置模型"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Integer, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ef_core.database import Base


# 默认的 System Prompt（基于 PRD 文档）
DEFAULT_SYSTEM_PROMPT = """你是一名专业的中俄互译翻译器。
- 所有输出只包含译文，不要任何解释、前后缀或引号。
- 保持原文的语气和礼貌程度。
- 优先使用地道、口语化但自然的表达，适合电商、社交、即时通讯场景。
- 如果输入中文，就翻译成俄文；如果输入俄文，就翻译成中文。"""


class ChatGPTTranslationConfig(Base):
    """ChatGPT翻译配置表（单例模式，只有一条记录）"""

    __tablename__ = "chatgpt_translation_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, comment="主键（固定为1）")
    api_key_encrypted: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="加密的 OpenAI API Key (TODO: 实现加密)"
    )
    base_url: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="API Base URL（可选，默认为官方地址）"
    )
    model_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        server_default="gpt-5-mini",
        comment="模型名称（默认 gpt-5-mini）"
    )
    system_prompt: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=func.text(f"'{DEFAULT_SYSTEM_PROMPT}'"),
        comment="System Prompt（翻译规则）"
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", comment="是否启用"
    )
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", comment="是否为默认翻译引擎"
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
