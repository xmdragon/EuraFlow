"""
店铺权限控制工具

提供统一的店铺权限过滤逻辑，确保用户只能访问其授权的店铺数据
"""
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ef_core.models.users import User
import logging

logger = logging.getLogger(__name__)


async def get_user_shop_ids(
    user: User,
    db: AsyncSession
) -> Optional[List[int]]:
    """
    获取用户有权访问的店铺ID列表

    权限规则：
    - admin: 返回 None（表示可以访问所有店铺）
    - operator/viewer: 返回 user_shops 表中关联的店铺ID列表
    - 如果用户没有任何店铺权限，返回空列表 []

    Args:
        user: 用户对象
        db: 数据库会话

    Returns:
        - None: admin用户，可访问所有店铺
        - List[int]: 普通用户授权的店铺ID列表
        - []: 无任何店铺权限
    """
    # admin 可以访问所有店铺
    if user.role == "admin":
        logger.debug(f"用户 {user.username} (role={user.role}) 具有admin权限，可访问所有店铺")
        return None

    # 查询用户关联的店铺
    from ef_core.models.users import user_shops

    stmt = select(user_shops.c.shop_id).where(user_shops.c.user_id == user.id)
    result = await db.execute(stmt)
    shop_ids = [row[0] for row in result.fetchall()]

    logger.debug(
        f"用户 {user.username} (role={user.role}) 有权访问的店铺: {shop_ids}"
    )

    return shop_ids


async def filter_by_shop_permission(
    user: User,
    db: AsyncSession,
    requested_shop_id: Optional[int] = None
) -> Optional[List[int]]:
    """
    根据用户权限过滤店铺ID

    用于API中的店铺过滤逻辑：
    - 如果用户请求特定店铺，验证其是否有权访问该店铺
    - 如果用户未指定店铺（查询所有店铺），返回其授权的店铺ID列表

    Args:
        user: 用户对象
        db: 数据库会话
        requested_shop_id: 用户请求访问的店铺ID（可选）

    Returns:
        - None: admin用户访问所有店铺（不需要过滤）
        - [shop_id]: 用户有权访问指定的店铺
        - []: 用户无权访问请求的店铺（或没有任何店铺权限）

    Raises:
        PermissionError: 当用户请求访问未授权的店铺时
    """
    # 获取用户授权的店铺列表
    authorized_shop_ids = await get_user_shop_ids(user, db)

    # admin 用户：无需过滤
    if authorized_shop_ids is None:
        # 如果请求了特定店铺，返回该店铺ID；否则返回None表示所有店铺
        return [requested_shop_id] if requested_shop_id else None

    # 普通用户：检查权限
    if requested_shop_id is not None:
        # 用户请求特定店铺，验证权限
        if requested_shop_id not in authorized_shop_ids:
            logger.warning(
                f"用户 {user.username} (id={user.id}) 尝试访问未授权的店铺 {requested_shop_id}。"
                f"已授权店铺: {authorized_shop_ids}"
            )
            raise PermissionError(
                f"您没有权限访问店铺 {requested_shop_id}。"
                f"请联系管理员分配店铺权限。"
            )
        return [requested_shop_id]

    # 用户未指定店铺，返回其所有授权店铺
    if not authorized_shop_ids:
        logger.warning(
            f"用户 {user.username} (id={user.id}, role={user.role}) "
            f"没有关联任何店铺，无法访问数据"
        )

    return authorized_shop_ids


def build_shop_filter_condition(shop_model, shop_ids: Optional[List[int]]):
    """
    构建店铺过滤的 SQLAlchemy 查询条件

    Args:
        shop_model: 数据模型类（必须有 shop_id 字段）
        shop_ids: 店铺ID列表，None表示不过滤

    Returns:
        SQLAlchemy 查询条件，或 True（不过滤）
    """
    if shop_ids is None:
        # admin 用户，不需要过滤
        return True

    if not shop_ids:
        # 用户没有任何店铺权限，返回永远为False的条件
        return False

    # 过滤为授权的店铺
    return shop_model.shop_id.in_(shop_ids)
