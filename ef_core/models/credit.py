"""
额度与消费系统数据模型
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional, TYPE_CHECKING

from sqlalchemy import (
    BigInteger, String, Boolean, DateTime, Integer, Text,
    ForeignKey, Index, Numeric, func
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ef_core.models.base import Base

if TYPE_CHECKING:
    from ef_core.models.users import User


class CreditAccount(Base):
    """额度账户表 - 仅 main_account/admin 拥有"""
    __tablename__ = "credit_accounts"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="账户ID"
    )

    # 关联用户（main_account 或 admin）
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        comment="账户所属用户ID（main_account 或 admin）"
    )

    # 额度余额 - 使用 Decimal(18,4) 精确计算
    balance: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        default=Decimal("0.0000"),
        nullable=False,
        comment="当前余额（点数）"
    )

    # 累计充值
    total_recharged: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        default=Decimal("0.0000"),
        nullable=False,
        comment="累计充值（点数）"
    )

    # 累计消费
    total_consumed: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        default=Decimal("0.0000"),
        nullable=False,
        comment="累计消费（点数）"
    )

    # 预警阈值
    low_balance_threshold: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        default=Decimal("100.0000"),
        nullable=False,
        comment="余额不足预警阈值"
    )

    # 预警静默（用户选择"不再提醒"后，下次充值前不弹窗）
    low_balance_alert_muted: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否静默余额不足提醒"
    )

    # 版本号（乐观锁）
    version: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="乐观锁版本号"
    )

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        comment="更新时间"
    )

    # 关系
    user: Mapped["User"] = relationship("User", back_populates="credit_account")
    transactions: Mapped[list["CreditTransaction"]] = relationship(
        "CreditTransaction",
        back_populates="account",
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_credit_accounts_user_id", "user_id"),
    )

    def __repr__(self) -> str:
        return f"<CreditAccount(id={self.id}, user_id={self.user_id}, balance={self.balance})>"

    def is_low_balance(self) -> bool:
        """检查是否低于预警阈值"""
        return self.balance < self.low_balance_threshold


class CreditTransaction(Base):
    """额度交易记录表（充值/消费/退还）"""
    __tablename__ = "credit_transactions"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="交易ID"
    )

    # 关联账户
    account_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("credit_accounts.id", ondelete="CASCADE"),
        nullable=False,
        comment="额度账户ID"
    )

    # 交易类型：recharge（充值）/ consume（消费）/ refund（退还）/ adjust（调整）
    transaction_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="交易类型：recharge/consume/refund/adjust"
    )

    # 交易金额（正数为增加，负数为扣除）
    amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
        comment="交易金额（点数，正数增加，负数扣除）"
    )

    # 交易前余额
    balance_before: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
        comment="交易前余额"
    )

    # 交易后余额
    balance_after: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
        comment="交易后余额"
    )

    # 消费模块（仅消费类型）：print_label / product_collect / translate / ...
    module: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="消费模块：print_label 等"
    )

    # 执行用户（子账号消费时，记录实际执行者）
    operator_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id"),
        nullable=False,
        comment="操作用户ID（实际执行者）"
    )

    # 详情（JSONB，存储订单号列表等）
    details: Mapped[dict] = mapped_column(
        JSONB,
        default=dict,
        nullable=False,
        comment="交易详情（如订单号列表）"
    )

    # 充值相关字段
    payment_method: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
        comment="支付方式：manual/wechat/alipay"
    )
    payment_amount_cny: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 2),
        nullable=True,
        comment="实付金额（CNY）"
    )
    payment_order_no: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        comment="支付订单号"
    )

    # 审批人（手动充值时的审批/操作管理员）
    approved_by: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("users.id"),
        nullable=True,
        comment="审批人ID（充值时的管理员）"
    )

    # 幂等键
    idempotency_key: Mapped[Optional[str]] = mapped_column(
        String(64),
        unique=True,
        nullable=True,
        comment="幂等键"
    )

    # 请求信息
    ip_address: Mapped[Optional[str]] = mapped_column(
        String(45),
        nullable=True,
        comment="客户端IP"
    )

    # 备注
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="备注"
    )

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="创建时间"
    )

    # 关系
    account: Mapped["CreditAccount"] = relationship("CreditAccount", back_populates="transactions")
    operator: Mapped["User"] = relationship("User", foreign_keys=[operator_user_id])
    approver: Mapped[Optional["User"]] = relationship("User", foreign_keys=[approved_by])

    __table_args__ = (
        Index("idx_credit_tx_account_time", "account_id", "created_at"),
        Index("idx_credit_tx_type_time", "transaction_type", "created_at"),
        Index("idx_credit_tx_module_time", "module", "created_at"),
        Index("idx_credit_tx_operator", "operator_user_id", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<CreditTransaction(id={self.id}, type={self.transaction_type}, amount={self.amount})>"


class CreditModuleConfig(Base):
    """模块消费配置表"""
    __tablename__ = "credit_module_configs"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        comment="配置ID"
    )

    # 模块标识：print_label / product_collect / translate / ...
    module_key: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        comment="模块标识"
    )

    # 模块显示名称
    module_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="模块显示名称"
    )

    # 单次消费点数
    cost_per_unit: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
        comment="单次消费点数"
    )

    # 单位描述
    unit_description: Mapped[str] = mapped_column(
        String(50),
        default="次",
        nullable=False,
        comment="单位描述（如：个面单、次翻译）"
    )

    # 是否启用
    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否启用计费"
    )

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        comment="更新时间"
    )

    __table_args__ = (
        Index("idx_credit_module_configs_key", "module_key"),
    )

    def __repr__(self) -> str:
        return f"<CreditModuleConfig(key={self.module_key}, cost={self.cost_per_unit})>"
