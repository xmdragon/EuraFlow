"""
主账号级别服务
"""
from typing import Optional, List
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.models.account_level import AccountLevel
from ef_core.models.users import User
from ef_core.utils.logger import get_logger
from ef_core.utils.errors import NotFoundError, ValidationError, ConflictError

logger = get_logger(__name__)


class AccountLevelService:
    """主账号级别服务"""

    @staticmethod
    async def get_all(db: AsyncSession) -> List[AccountLevel]:
        """获取所有主账号级别"""
        stmt = select(AccountLevel).order_by(AccountLevel.sort_order, AccountLevel.id)
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def get_by_id(db: AsyncSession, level_id: int) -> Optional[AccountLevel]:
        """根据ID获取主账号级别"""
        stmt = select(AccountLevel).where(AccountLevel.id == level_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_by_name(db: AsyncSession, name: str) -> Optional[AccountLevel]:
        """根据名称获取主账号级别"""
        stmt = select(AccountLevel).where(AccountLevel.name == name)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_default(db: AsyncSession) -> Optional[AccountLevel]:
        """获取默认主账号级别"""
        stmt = select(AccountLevel).where(AccountLevel.is_default == True)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def create(
        db: AsyncSession,
        name: str,
        alias: Optional[str] = None,
        max_sub_accounts: int = 5,
        max_shops: int = 10,
        default_expiration_days: int = 30,
        extra_config: Optional[dict] = None,
        is_default: bool = False,
        sort_order: int = 0
    ) -> AccountLevel:
        """创建主账号级别"""
        # 检查名称是否已存在
        existing = await AccountLevelService.get_by_name(db, name)
        if existing:
            raise ConflictError(
                code="LEVEL_NAME_EXISTS",
                detail=f"主账号级别名称 '{name}' 已存在"
            )

        # 如果设置为默认，先取消其他默认
        if is_default:
            await AccountLevelService._clear_default(db)

        level = AccountLevel(
            name=name,
            alias=alias,
            max_sub_accounts=max_sub_accounts,
            max_shops=max_shops,
            default_expiration_days=default_expiration_days,
            extra_config=extra_config or {},
            is_default=is_default,
            sort_order=sort_order
        )
        db.add(level)
        await db.flush()
        await db.refresh(level)

        logger.info(f"创建主账号级别: id={level.id}, name={name}")
        return level

    @staticmethod
    async def update(
        db: AsyncSession,
        level_id: int,
        name: Optional[str] = None,
        alias: Optional[str] = None,
        max_sub_accounts: Optional[int] = None,
        max_shops: Optional[int] = None,
        default_expiration_days: Optional[int] = None,
        extra_config: Optional[dict] = None,
        is_default: Optional[bool] = None,
        sort_order: Optional[int] = None
    ) -> AccountLevel:
        """更新主账号级别"""
        level = await AccountLevelService.get_by_id(db, level_id)
        if not level:
            raise NotFoundError(
                code="LEVEL_NOT_FOUND",
                detail=f"主账号级别 ID={level_id} 不存在"
            )

        # 如果更新名称，检查是否冲突
        if name and name != level.name:
            existing = await AccountLevelService.get_by_name(db, name)
            if existing:
                raise ConflictError(
                    code="LEVEL_NAME_EXISTS",
                    detail=f"主账号级别名称 '{name}' 已存在"
                )
            level.name = name

        if alias is not None:
            level.alias = alias
        if max_sub_accounts is not None:
            level.max_sub_accounts = max_sub_accounts
        if max_shops is not None:
            level.max_shops = max_shops
        if default_expiration_days is not None:
            level.default_expiration_days = default_expiration_days
        if extra_config is not None:
            level.extra_config = extra_config
        if sort_order is not None:
            level.sort_order = sort_order

        # 如果设置为默认，先取消其他默认
        if is_default is not None:
            if is_default:
                await AccountLevelService._clear_default(db)
            level.is_default = is_default

        await db.flush()
        await db.refresh(level)

        logger.info(f"更新主账号级别: id={level_id}")
        return level

    @staticmethod
    async def delete(db: AsyncSession, level_id: int) -> bool:
        """删除主账号级别"""
        level = await AccountLevelService.get_by_id(db, level_id)
        if not level:
            raise NotFoundError(
                code="LEVEL_NOT_FOUND",
                detail=f"主账号级别 ID={level_id} 不存在"
            )

        # 检查是否有用户使用此级别
        stmt = select(func.count()).select_from(User).where(User.account_level_id == level_id)
        result = await db.execute(stmt)
        user_count = result.scalar()

        if user_count > 0:
            raise ValidationError(
                code="LEVEL_IN_USE",
                detail=f"无法删除：有 {user_count} 个用户正在使用此级别"
            )

        await db.delete(level)
        logger.info(f"删除主账号级别: id={level_id}")
        return True

    @staticmethod
    async def _clear_default(db: AsyncSession) -> None:
        """清除所有默认标记"""
        stmt = select(AccountLevel).where(AccountLevel.is_default == True)
        result = await db.execute(stmt)
        levels = result.scalars().all()
        for level in levels:
            level.is_default = False


# 全局服务实例
_account_level_service: Optional[AccountLevelService] = None


def get_account_level_service() -> AccountLevelService:
    """获取主账号级别服务单例"""
    global _account_level_service
    if _account_level_service is None:
        _account_level_service = AccountLevelService()
    return _account_level_service
