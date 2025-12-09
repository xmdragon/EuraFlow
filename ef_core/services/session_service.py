"""
登录会话服务 - 用于单设备登录限制
"""
import secrets
from datetime import datetime, timezone
from typing import Optional, List

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.models.user_login_session import UserLoginSession
from ef_core.models.users import User
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)


class SessionService:
    """登录会话服务

    实现单设备登录限制：
    - 每次登录生成唯一会话令牌
    - 新设备登录时使旧会话失效
    - 支持 WebSocket 通知被踢出的设备
    """

    @staticmethod
    def generate_session_token() -> str:
        """生成64位十六进制会话令牌"""
        return secrets.token_hex(32)

    @staticmethod
    async def create_session(
        db: AsyncSession,
        user_id: int,
        device_info: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> tuple[str, Optional[str]]:
        """创建新登录会话

        Args:
            db: 数据库会话
            user_id: 用户ID
            device_info: 设备信息
            ip_address: IP地址
            user_agent: User-Agent

        Returns:
            tuple: (新会话令牌, 被踢出的旧会话令牌)
        """
        # 获取用户当前会话令牌
        stmt = select(User).where(User.id == user_id)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()

        if not user:
            raise ValueError(f"用户 ID={user_id} 不存在")

        old_session_token = user.current_session_token

        # 使旧会话失效
        if old_session_token:
            await SessionService.invalidate_session(db, old_session_token)
            logger.info(f"用户 {user_id} 旧会话已失效", old_token=old_session_token[:8] + "...")

        # 生成新会话令牌
        new_session_token = SessionService.generate_session_token()

        # 创建会话记录
        session_record = UserLoginSession(
            user_id=user_id,
            session_token=new_session_token,
            device_info=device_info,
            ip_address=ip_address,
            user_agent=user_agent,
            is_active=True
        )
        db.add(session_record)

        # 更新用户当前会话令牌
        user.current_session_token = new_session_token

        await db.flush()

        logger.info(
            f"用户 {user_id} 新会话已创建",
            new_token=new_session_token[:8] + "...",
            ip=ip_address
        )

        return new_session_token, old_session_token

    @staticmethod
    async def invalidate_session(db: AsyncSession, session_token: str) -> bool:
        """使会话失效

        Args:
            db: 数据库会话
            session_token: 会话令牌

        Returns:
            bool: 是否成功
        """
        # 更新会话记录为非活跃
        stmt = (
            update(UserLoginSession)
            .where(UserLoginSession.session_token == session_token)
            .values(is_active=False)
        )
        result = await db.execute(stmt)

        if result.rowcount > 0:
            logger.debug(f"会话已失效: {session_token[:8]}...")
            return True
        return False

    @staticmethod
    async def validate_session(db: AsyncSession, user_id: int, session_token: str) -> bool:
        """验证会话是否有效

        Args:
            db: 数据库会话
            user_id: 用户ID
            session_token: 会话令牌

        Returns:
            bool: 会话是否有效
        """
        # 检查用户当前会话令牌是否匹配
        stmt = select(User.current_session_token).where(User.id == user_id)
        result = await db.execute(stmt)
        current_token = result.scalar_one_or_none()

        if current_token is None:
            # 用户没有活跃会话（可能是旧Token，过渡期放行）
            return True

        return current_token == session_token

    @staticmethod
    async def get_active_session(db: AsyncSession, user_id: int) -> Optional[UserLoginSession]:
        """获取用户当前活跃会话

        Args:
            db: 数据库会话
            user_id: 用户ID

        Returns:
            活跃会话记录，如果没有则返回 None
        """
        stmt = (
            select(UserLoginSession)
            .where(
                UserLoginSession.user_id == user_id,
                UserLoginSession.is_active == True
            )
            .order_by(UserLoginSession.created_at.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_user_sessions(
        db: AsyncSession,
        user_id: int,
        include_inactive: bool = False
    ) -> List[UserLoginSession]:
        """获取用户的登录会话历史

        Args:
            db: 数据库会话
            user_id: 用户ID
            include_inactive: 是否包含已失效的会话

        Returns:
            会话记录列表
        """
        stmt = select(UserLoginSession).where(UserLoginSession.user_id == user_id)

        if not include_inactive:
            stmt = stmt.where(UserLoginSession.is_active == True)

        stmt = stmt.order_by(UserLoginSession.created_at.desc())
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def update_activity(db: AsyncSession, session_token: str) -> bool:
        """更新会话最后活动时间

        Args:
            db: 数据库会话
            session_token: 会话令牌

        Returns:
            bool: 是否成功
        """
        stmt = (
            update(UserLoginSession)
            .where(
                UserLoginSession.session_token == session_token,
                UserLoginSession.is_active == True
            )
            .values(last_activity_at=datetime.now(timezone.utc))
        )
        result = await db.execute(stmt)
        return result.rowcount > 0

    @staticmethod
    async def logout(db: AsyncSession, user_id: int, session_token: str) -> bool:
        """用户登出

        Args:
            db: 数据库会话
            user_id: 用户ID
            session_token: 会话令牌

        Returns:
            bool: 是否成功
        """
        # 使会话失效
        await SessionService.invalidate_session(db, session_token)

        # 清除用户当前会话令牌
        stmt = (
            update(User)
            .where(
                User.id == user_id,
                User.current_session_token == session_token
            )
            .values(current_session_token=None)
        )
        result = await db.execute(stmt)

        if result.rowcount > 0:
            logger.info(f"用户 {user_id} 已登出")
            return True
        return False

    @staticmethod
    async def cleanup_expired_sessions(
        db: AsyncSession,
        max_age_days: int = 30
    ) -> int:
        """清理过期会话记录

        Args:
            db: 数据库会话
            max_age_days: 最大保留天数

        Returns:
            int: 清理的记录数
        """
        from datetime import timedelta

        cutoff_date = datetime.now(timezone.utc) - timedelta(days=max_age_days)

        stmt = select(UserLoginSession).where(
            UserLoginSession.is_active == False,
            UserLoginSession.created_at < cutoff_date
        )
        result = await db.execute(stmt)
        sessions = result.scalars().all()

        count = len(sessions)
        for session in sessions:
            await db.delete(session)

        if count > 0:
            logger.info(f"清理了 {count} 条过期会话记录")

        return count


# 全局服务实例
_session_service: Optional[SessionService] = None


def get_session_service() -> SessionService:
    """获取会话服务单例"""
    global _session_service
    if _session_service is None:
        _session_service = SessionService()
    return _session_service
