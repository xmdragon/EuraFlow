"""
额度与消费服务
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ef_core.models.credit import CreditAccount, CreditTransaction, CreditModuleConfig
from ef_core.models.users import User

logger = logging.getLogger(__name__)


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class InsufficientCreditError(Exception):
    """余额不足异常"""
    def __init__(self, required: Decimal, balance: Decimal):
        self.required = required
        self.balance = balance
        super().__init__(f"余额不足，需要 {required}，当前余额 {balance}")


class ConcurrencyError(Exception):
    """并发冲突异常"""
    pass


class CreditService:
    """
    额度服务

    功能：
    1. 额度账户管理（懒加载创建）
    2. 余额查询（子账号查询主账号余额）
    3. 消费扣费（乐观锁保证并发安全）
    4. 充值
    5. 模块消费配置
    """

    @staticmethod
    async def get_or_create_account(
        db: AsyncSession,
        user_id: int
    ) -> CreditAccount:
        """
        获取或创建额度账户（懒加载）

        Args:
            db: 数据库会话
            user_id: 用户ID（必须是 manager 或 admin）

        Returns:
            CreditAccount
        """
        result = await db.execute(
            select(CreditAccount).where(CreditAccount.user_id == user_id)
        )
        account = result.scalar_one_or_none()

        if account is None:
            # 创建新账户
            account = CreditAccount(
                user_id=user_id,
                balance=Decimal("0.0000"),
                total_recharged=Decimal("0.0000"),
                total_consumed=Decimal("0.0000"),
            )
            db.add(account)
            await db.flush()
            logger.info(f"创建额度账户: user_id={user_id}")

        return account

    @staticmethod
    async def get_master_account(
        db: AsyncSession,
        user_id: int
    ) -> CreditAccount:
        """
        获取主账号的额度账户

        - 如果是 sub_account，返回其 parent_user 的账户
        - 如果是 manager/admin，返回自己的账户

        Args:
            db: 数据库会话
            user_id: 当前用户ID

        Returns:
            CreditAccount (主账号的)
        """
        # 查询用户信息
        result = await db.execute(
            select(User).where(User.id == user_id)
        )
        user = result.scalar_one_or_none()

        if user is None:
            raise ValueError(f"用户不存在: {user_id}")

        # 确定主账号ID
        if user.role == "sub_account" and user.parent_user_id:
            master_user_id = user.parent_user_id
        else:
            master_user_id = user_id

        return await CreditService.get_or_create_account(db, master_user_id)

    @staticmethod
    async def check_balance(
        db: AsyncSession,
        user_id: int,
        required_amount: Decimal
    ) -> tuple[bool, Decimal]:
        """
        检查余额是否充足

        Args:
            db: 数据库会话
            user_id: 用户ID
            required_amount: 需要的金额

        Returns:
            (sufficient, current_balance)
        """
        account = await CreditService.get_master_account(db, user_id)
        sufficient = account.balance >= required_amount
        return sufficient, account.balance

    @staticmethod
    async def consume(
        db: AsyncSession,
        user_id: int,
        operator_user_id: int,
        module: str,
        amount: Decimal,
        details: dict,
        idempotency_key: Optional[str] = None,
        ip_address: Optional[str] = None,
        notes: Optional[str] = None,
        max_retries: int = 3
    ) -> CreditTransaction:
        """
        消费扣费（原子操作）

        使用乐观锁确保并发安全：
        1. 读取账户余额和版本号
        2. 检查余额是否充足
        3. 更新余额，带版本号条件
        4. 版本号不匹配则重试（最多3次）

        Args:
            db: 数据库会话
            user_id: 主账号用户ID
            operator_user_id: 实际执行者ID（可能是子账号）
            module: 消费模块
            amount: 消费金额（正数）
            details: 详情（如订单号列表）
            idempotency_key: 幂等键
            ip_address: 客户端IP
            notes: 备注
            max_retries: 最大重试次数

        Returns:
            CreditTransaction

        Raises:
            InsufficientCreditError: 余额不足
            ConcurrencyError: 并发冲突重试失败
        """
        # 幂等检查
        if idempotency_key:
            existing = await db.execute(
                select(CreditTransaction).where(
                    CreditTransaction.idempotency_key == idempotency_key
                )
            )
            if existing.scalar_one_or_none():
                logger.info(f"幂等命中: {idempotency_key}")
                return existing.scalar_one()

        for retry in range(max_retries):
            # 获取主账号
            account = await CreditService.get_master_account(db, user_id)

            # 检查余额
            if account.balance < amount:
                raise InsufficientCreditError(amount, account.balance)

            balance_before = account.balance
            balance_after = balance_before - amount

            # 乐观锁更新
            result = await db.execute(
                update(CreditAccount)
                .where(CreditAccount.id == account.id)
                .where(CreditAccount.version == account.version)
                .values(
                    balance=balance_after,
                    total_consumed=account.total_consumed + amount,
                    version=account.version + 1,
                    updated_at=utcnow()
                )
            )

            if result.rowcount == 1:
                # 更新成功，创建交易记录
                transaction = CreditTransaction(
                    account_id=account.id,
                    transaction_type="consume",
                    amount=-amount,  # 消费为负数
                    balance_before=balance_before,
                    balance_after=balance_after,
                    module=module,
                    operator_user_id=operator_user_id,
                    details=details,
                    idempotency_key=idempotency_key,
                    ip_address=ip_address,
                    notes=notes,
                )
                db.add(transaction)
                await db.flush()

                logger.info(
                    f"消费扣费成功: account_id={account.id}, "
                    f"operator={operator_user_id}, module={module}, "
                    f"amount={amount}, balance={balance_after}"
                )
                return transaction

            # 版本冲突，刷新并重试
            logger.warning(f"消费扣费版本冲突，重试 {retry + 1}/{max_retries}")
            await db.refresh(account)

        raise ConcurrencyError("消费扣费并发冲突，请重试")

    @staticmethod
    async def recharge(
        db: AsyncSession,
        user_id: int,
        amount: Decimal,
        payment_method: str,
        payment_amount_cny: Optional[Decimal],
        approved_by: int,
        payment_order_no: Optional[str] = None,
        notes: Optional[str] = None,
        ip_address: Optional[str] = None
    ) -> CreditTransaction:
        """
        充值

        Args:
            db: 数据库会话
            user_id: 被充值的用户ID（manager/admin）
            amount: 充值点数
            payment_method: 支付方式（manual/wechat/alipay）
            payment_amount_cny: 实付金额（CNY）
            approved_by: 审批人/操作员ID
            payment_order_no: 支付订单号
            notes: 备注
            ip_address: 客户端IP

        Returns:
            CreditTransaction
        """
        account = await CreditService.get_or_create_account(db, user_id)

        balance_before = account.balance
        balance_after = balance_before + amount

        # 更新账户余额
        account.balance = balance_after
        account.total_recharged = account.total_recharged + amount
        account.low_balance_alert_muted = False  # 充值后重置静默状态
        account.version += 1
        account.updated_at = utcnow()

        # 创建交易记录
        transaction = CreditTransaction(
            account_id=account.id,
            transaction_type="recharge",
            amount=amount,  # 充值为正数
            balance_before=balance_before,
            balance_after=balance_after,
            operator_user_id=approved_by,
            payment_method=payment_method,
            payment_amount_cny=payment_amount_cny,
            payment_order_no=payment_order_no,
            approved_by=approved_by,
            ip_address=ip_address,
            notes=notes,
            details={}
        )
        db.add(transaction)
        await db.flush()

        logger.info(
            f"充值成功: user_id={user_id}, amount={amount}, "
            f"balance={balance_after}, method={payment_method}"
        )
        return transaction

    @staticmethod
    async def mute_low_balance_alert(
        db: AsyncSession,
        user_id: int
    ) -> bool:
        """
        静默余额不足预警

        Args:
            db: 数据库会话
            user_id: 用户ID

        Returns:
            是否成功
        """
        account = await CreditService.get_master_account(db, user_id)
        account.low_balance_alert_muted = True
        account.updated_at = utcnow()
        await db.flush()
        logger.info(f"静默余额预警: user_id={user_id}")
        return True

    @staticmethod
    async def get_module_config(
        db: AsyncSession,
        module_key: str
    ) -> Optional[CreditModuleConfig]:
        """
        获取模块消费配置

        Args:
            db: 数据库会话
            module_key: 模块标识

        Returns:
            CreditModuleConfig or None
        """
        result = await db.execute(
            select(CreditModuleConfig).where(
                CreditModuleConfig.module_key == module_key,
                CreditModuleConfig.is_enabled == True
            )
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_module_cost(
        db: AsyncSession,
        module_key: str
    ) -> Decimal:
        """
        获取模块单次消费点数

        Args:
            db: 数据库会话
            module_key: 模块标识

        Returns:
            单次消费点数，如果模块不存在或未启用则返回 0
        """
        config = await CreditService.get_module_config(db, module_key)
        if config:
            return config.cost_per_unit
        return Decimal("0.0000")

    @staticmethod
    async def calculate_print_cost(
        db: AsyncSession,
        posting_numbers: list[str],
        exclude_reprints: bool = True
    ) -> dict:
        """
        计算打印消费

        Args:
            db: 数据库会话
            posting_numbers: 货件编号列表
            exclude_reprints: 是否排除补打印

        Returns:
            {
                "total_cost": Decimal,
                "unit_cost": Decimal,
                "billable_count": int,
                "reprint_count": int
            }
        """
        from plugins.ef.channels.ozon.models import OzonPosting

        unit_cost = await CreditService.get_module_cost(db, "print_label")

        if exclude_reprints and posting_numbers:
            # 查询哪些是首次打印
            result = await db.execute(
                select(OzonPosting.posting_number, OzonPosting.label_print_count)
                .where(OzonPosting.posting_number.in_(posting_numbers))
            )
            postings = {row[0]: row[1] for row in result.fetchall()}

            billable_count = sum(
                1 for pn in posting_numbers
                if postings.get(pn, 0) == 0
            )
            reprint_count = len(posting_numbers) - billable_count
        else:
            billable_count = len(posting_numbers)
            reprint_count = 0

        total_cost = unit_cost * billable_count

        return {
            "total_cost": total_cost,
            "unit_cost": unit_cost,
            "billable_count": billable_count,
            "reprint_count": reprint_count
        }

    @staticmethod
    async def get_all_module_configs(
        db: AsyncSession
    ) -> list[CreditModuleConfig]:
        """
        获取所有模块配置

        Returns:
            模块配置列表
        """
        result = await db.execute(
            select(CreditModuleConfig).order_by(CreditModuleConfig.module_key)
        )
        return list(result.scalars().all())

    @staticmethod
    async def update_module_config(
        db: AsyncSession,
        module_key: str,
        cost_per_unit: Optional[Decimal] = None,
        module_name: Optional[str] = None,
        unit_description: Optional[str] = None,
        is_enabled: Optional[bool] = None
    ) -> Optional[CreditModuleConfig]:
        """
        更新模块配置

        Returns:
            更新后的配置，如果不存在则返回 None
        """
        result = await db.execute(
            select(CreditModuleConfig).where(
                CreditModuleConfig.module_key == module_key
            )
        )
        config = result.scalar_one_or_none()

        if config is None:
            return None

        if cost_per_unit is not None:
            config.cost_per_unit = cost_per_unit
        if module_name is not None:
            config.module_name = module_name
        if unit_description is not None:
            config.unit_description = unit_description
        if is_enabled is not None:
            config.is_enabled = is_enabled

        config.updated_at = utcnow()
        await db.flush()

        logger.info(f"更新模块配置: {module_key}, cost={cost_per_unit}")
        return config

    @staticmethod
    async def get_credit_name(db: AsyncSession) -> str:
        """
        获取点数显示名称

        Returns:
            点数名称，默认 "积分"
        """
        from plugins.ef.channels.ozon.models.global_settings import OzonGlobalSetting

        result = await db.execute(
            select(OzonGlobalSetting).where(
                OzonGlobalSetting.setting_key == "credit_name"
            )
        )
        setting = result.scalar_one_or_none()

        if setting and setting.setting_value:
            return setting.setting_value.get("value", "积分")
        return "积分"

    @staticmethod
    async def get_cny_rate(db: AsyncSession) -> Decimal:
        """
        获取 CNY 到点数的兑换比例

        Returns:
            兑换比例，默认 1.0
        """
        from plugins.ef.channels.ozon.models.global_settings import OzonGlobalSetting

        result = await db.execute(
            select(OzonGlobalSetting).where(
                OzonGlobalSetting.setting_key == "credit_cny_rate"
            )
        )
        setting = result.scalar_one_or_none()

        if setting and setting.setting_value:
            try:
                return Decimal(setting.setting_value.get("value", "1.0"))
            except Exception:
                return Decimal("1.0")
        return Decimal("1.0")
