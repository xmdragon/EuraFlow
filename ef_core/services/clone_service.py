"""
超级管理员账号克隆服务
"""
import json
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

import redis.asyncio as redis
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ef_core.config import get_settings
from ef_core.database import get_db_manager
from ef_core.models.users import User
from ef_core.utils.logger import get_logger
from ef_core.utils.errors import ForbiddenError, ValidationError, NotFoundError

logger = get_logger(__name__)


class CloneService:
    """账号克隆服务"""

    CLONE_SESSION_TTL = 1800  # 30分钟
    CLONE_SESSION_PREFIX = "clone_session:"
    ADMIN_CLONE_PREFIX = "admin_clone:"  # 记录 admin 当前的克隆会话

    def __init__(self):
        self.settings = get_settings()
        self._redis_client = None

    @property
    def redis_client(self) -> redis.Redis:
        """获取Redis客户端（懒加载）"""
        if not self._redis_client:
            self._redis_client = redis.from_url(
                self.settings.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
        return self._redis_client

    async def create_clone_session(
        self,
        admin_user: User,
        target_user_id: int,
        original_token_data: dict
    ) -> dict:
        """创建克隆会话

        Args:
            admin_user: 超级管理员用户对象
            target_user_id: 要克隆的目标用户ID
            original_token_data: 原始 Token 数据（用于恢复）

        Returns:
            dict: 包含 session_id, clone_token_data, expires_at 等信息
        """
        # 验证超级管理员身份（所有 role=admin 的用户都可以克隆）
        if admin_user.role != "admin":
            raise ForbiddenError(
                code="NOT_SUPER_ADMIN",
                detail="只有超级管理员可以克隆身份"
            )

        # 检查是否已有活跃的克隆会话
        existing_session = await self._get_admin_active_session(admin_user.id)
        if existing_session:
            raise ValidationError(
                code="CLONE_SESSION_EXISTS",
                detail="已有活跃的克隆会话，请先恢复身份"
            )

        # 查询目标用户
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            stmt = select(User).where(User.id == target_user_id).options(
                selectinload(User.shops)
            )
            result = await session.execute(stmt)
            target_user = result.scalar_one_or_none()

            if not target_user:
                raise NotFoundError(
                    code="USER_NOT_FOUND",
                    detail="目标用户不存在"
                )

            # 验证目标用户是 manager 角色
            if target_user.role != "manager":
                raise ValidationError(
                    code="INVALID_TARGET_ROLE",
                    detail="只能克隆 manager 角色的用户"
                )

            # 验证目标用户是激活状态
            if not target_user.is_active:
                raise ValidationError(
                    code="TARGET_NOT_ACTIVE",
                    detail="目标用户未激活"
                )

            # 创建克隆会话
            session_id = str(uuid4())
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=self.CLONE_SESSION_TTL)

            # 获取目标用户的店铺 ID
            shop_ids = [shop.id for shop in target_user.shops] if target_user.shops else []

            # 构建克隆会话数据
            session_data = {
                "admin_user_id": admin_user.id,
                "admin_username": admin_user.username,
                "cloned_user_id": target_user.id,
                "cloned_username": target_user.username,
                "cloned_shop_ids": shop_ids,
                "cloned_primary_shop_id": target_user.primary_shop_id,
                "original_token_data": original_token_data,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "expires_at": expires_at.isoformat()
            }

            # 存储到 Redis
            await self.redis_client.setex(
                f"{self.CLONE_SESSION_PREFIX}{session_id}",
                self.CLONE_SESSION_TTL,
                json.dumps(session_data)
            )

            # 记录 admin 当前的克隆会话（用于防止重复克隆）
            await self.redis_client.setex(
                f"{self.ADMIN_CLONE_PREFIX}{admin_user.id}",
                self.CLONE_SESSION_TTL,
                session_id
            )

            logger.info(
                "Clone session created",
                admin_user_id=admin_user.id,
                cloned_user_id=target_user.id,
                cloned_username=target_user.username,
                session_id=session_id
            )

            # 返回克隆 Token 所需数据
            return {
                "session_id": session_id,
                "expires_at": expires_at,
                "remaining_seconds": self.CLONE_SESSION_TTL,
                "clone_token_data": {
                    "sub": str(target_user.id),
                    "username": target_user.username,
                    "role": target_user.role,
                    "permissions": target_user.permissions,
                    "shop_id": target_user.primary_shop_id,
                    "shop_ids": shop_ids,
                    # 克隆标识
                    "is_cloned": True,
                    "clone_session_id": session_id,
                    "original_user_id": admin_user.id,
                    "original_username": admin_user.username
                },
                "cloned_user": {
                    "id": target_user.id,
                    "username": target_user.username,
                    "role": target_user.role,
                    "shop_ids": shop_ids
                },
                "original_user": {
                    "id": admin_user.id,
                    "username": admin_user.username
                }
            }

    async def restore_session(self, clone_session_id: str) -> dict:
        """恢复原始身份

        Args:
            clone_session_id: 克隆会话ID

        Returns:
            dict: 原始 Token 数据
        """
        session_data = await self._get_session_data(clone_session_id)

        if not session_data:
            raise ValidationError(
                code="CLONE_SESSION_NOT_FOUND",
                detail="克隆会话不存在或已过期"
            )

        # 获取原始 Token 数据
        original_token_data = session_data.get("original_token_data", {})
        admin_user_id = session_data.get("admin_user_id")

        # 删除克隆会话
        await self.redis_client.delete(f"{self.CLONE_SESSION_PREFIX}{clone_session_id}")
        await self.redis_client.delete(f"{self.ADMIN_CLONE_PREFIX}{admin_user_id}")

        logger.info(
            "Clone session restored",
            admin_user_id=admin_user_id,
            session_id=clone_session_id
        )

        return {
            "original_token_data": original_token_data,
            "admin_user_id": admin_user_id,
            "admin_username": session_data.get("admin_username")
        }

    async def get_clone_status(self, clone_session_id: str) -> Optional[dict]:
        """获取克隆状态

        Args:
            clone_session_id: 克隆会话ID

        Returns:
            dict | None: 克隆状态信息
        """
        session_data = await self._get_session_data(clone_session_id)

        if not session_data:
            return None

        # 计算剩余时间
        expires_at = datetime.fromisoformat(session_data["expires_at"])
        now = datetime.now(timezone.utc)
        remaining_seconds = max(0, int((expires_at - now).total_seconds()))

        return {
            "is_cloned": True,
            "session_id": clone_session_id,
            "original_user": {
                "id": session_data["admin_user_id"],
                "username": session_data["admin_username"]
            },
            "cloned_user": {
                "id": session_data["cloned_user_id"],
                "username": session_data["cloned_username"],
                "shop_ids": session_data.get("cloned_shop_ids", [])
            },
            "expires_at": session_data["expires_at"],
            "remaining_seconds": remaining_seconds
        }

    async def invalidate_session(self, clone_session_id: str) -> bool:
        """使克隆会话失效

        Args:
            clone_session_id: 克隆会话ID

        Returns:
            bool: 是否成功
        """
        session_data = await self._get_session_data(clone_session_id)

        if session_data:
            admin_user_id = session_data.get("admin_user_id")
            await self.redis_client.delete(f"{self.CLONE_SESSION_PREFIX}{clone_session_id}")
            if admin_user_id:
                await self.redis_client.delete(f"{self.ADMIN_CLONE_PREFIX}{admin_user_id}")

            logger.info(
                "Clone session invalidated",
                session_id=clone_session_id
            )
            return True

        return False

    async def validate_clone_session(self, clone_session_id: str) -> bool:
        """验证克隆会话是否有效

        Args:
            clone_session_id: 克隆会话ID

        Returns:
            bool: 是否有效
        """
        session_data = await self._get_session_data(clone_session_id)
        return session_data is not None

    async def _get_session_data(self, session_id: str) -> Optional[dict]:
        """获取会话数据"""
        data = await self.redis_client.get(f"{self.CLONE_SESSION_PREFIX}{session_id}")
        if data:
            return json.loads(data)
        return None

    async def _get_admin_active_session(self, admin_user_id: int) -> Optional[str]:
        """获取 admin 当前活跃的克隆会话ID"""
        return await self.redis_client.get(f"{self.ADMIN_CLONE_PREFIX}{admin_user_id}")


# 单例模式
_clone_service: Optional[CloneService] = None


def get_clone_service() -> CloneService:
    """获取克隆服务单例"""
    global _clone_service
    if _clone_service is None:
        _clone_service = CloneService()
    return _clone_service
