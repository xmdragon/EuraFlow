"""
汇率管理数据模型
遵循约束：UTC 时间、Decimal 金额、统一命名规范
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import String, Boolean, Integer, Numeric, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column

from ef_core.models.base import Base


class ExchangeRateConfig(Base):
    """汇率配置表 - 存储API密钥和配置"""
    __tablename__ = "exchange_rate_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    api_key: Mapped[str] = mapped_column(String(200), nullable=False, comment="API密钥（加密存储）")
    api_provider: Mapped[str] = mapped_column(String(50), nullable=False, default="exchangerate-api", comment="服务商")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="是否启用")
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="CNY", comment="基准货币")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")

    def __repr__(self):
        return f"<ExchangeRateConfig(id={self.id}, provider={self.api_provider}, enabled={self.is_enabled})>"


class ExchangeRate(Base):
    """汇率缓存表 - 存储历史汇率数据"""
    __tablename__ = "exchange_rates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    from_currency: Mapped[str] = mapped_column(String(3), nullable=False, index=True, comment="源货币")
    to_currency: Mapped[str] = mapped_column(String(3), nullable=False, index=True, comment="目标货币")
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False, comment="汇率（6位小数精度）")
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True, comment="获取时间（UTC）")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, comment="过期时间（24小时后）")
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="exchangerate-api", comment="数据来源")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")

    # 索引：支持历史查询
    __table_args__ = (
        Index('idx_exchange_rates_currency_time', 'from_currency', 'to_currency', 'fetched_at'),
    )

    def __repr__(self):
        return f"<ExchangeRate(id={self.id}, {self.from_currency}->{self.to_currency}={self.rate}, fetched_at={self.fetched_at})>"
