"""象寄图片翻译配置模型"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Integer, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ef_core.database import Base


class XiangjifanyiConfig(Base):
    """象寄图片翻译配置表（单例模式，只有一条记录）"""

    __tablename__ = "xiangjifanyi_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, comment="主键（固定为1）")
    phone: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, comment="手机号"
    )
    password: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="密码 (TODO: 实现加密)"
    )
    api_url: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, comment="API地址"
    )
    user_key: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="私人密钥 (TODO: 实现加密)"
    )
    video_trans_key: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="视频翻译密钥 (TODO: 实现加密)"
    )
    fetch_key: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="商品解析密钥 (TODO: 实现加密)"
    )
    img_trans_key_ali: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="图片翻译-阿里标识码 (TODO: 实现加密)"
    )
    img_trans_key_google: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="图片翻译-谷歌标识码 (TODO: 实现加密)"
    )
    img_trans_key_papago: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="图片翻译-Papago标识码 (TODO: 实现加密)"
    )
    img_trans_key_deepl: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="图片翻译-DeepL标识码 (TODO: 实现加密)"
    )
    img_trans_key_chatgpt: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="图片翻译-ChatGPT标识码 (TODO: 实现加密)"
    )
    img_trans_key_baidu: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="图片翻译-百度标识码 (TODO: 实现加密)"
    )
    img_matting_key: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="智能抠图密钥 (TODO: 实现加密)"
    )
    text_trans_key: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="文本翻译密钥 (TODO: 实现加密)"
    )
    aigc_key: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="智能生成密钥 (TODO: 实现加密)"
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
