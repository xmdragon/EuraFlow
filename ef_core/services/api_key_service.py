"""
API Key服务层
处理API Key的生成、验证和管理

安全说明：
- API Key 使用 SHA256 哈希存储（非 bcrypt）
- API Key 本身是 40+ 字符随机串，安全性足够
- SHA256 支持直接查询，验证时间 O(1)
"""
import secrets
import hashlib
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.models.api_keys import APIKey
from ef_core.models.users import User
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)


class APIKeyService:
    """API Key管理服务"""

    @staticmethod
    def generate_api_key() -> str:
        """
        生成随机API Key
        格式：ef_live_[32位随机字符]
        """
        random_part = secrets.token_urlsafe(32)[:32]  # 32个字符
        return f"ef_live_{random_part}"

    @staticmethod
    def hash_key(key: str) -> str:
        """
        哈希API Key（使用SHA256）

        SHA256 是确定性哈希，相同输入产生相同输出，
        支持直接通过 hash 查询数据库。
        """
        return hashlib.sha256(key.encode('utf-8')).hexdigest()

    @staticmethod
    def verify_key(key: str, key_hash: str) -> bool:
        """
        验证API Key（SHA256 直接比较）
        """
        try:
            computed_hash = hashlib.sha256(key.encode('utf-8')).hexdigest()
            return computed_hash == key_hash
        except Exception as e:
            logger.error(f"API Key验证失败: {e}")
            return False

    async def create_api_key(
        self,
        db: AsyncSession,
        user_id: int,
        name: str,
        permissions: List[str] = None,
        expires_in_days: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        创建新的API Key

        Args:
            db: 数据库会话
            user_id: 用户ID
            name: Key名称
            permissions: 权限列表，默认["product_selection:write"]
            expires_in_days: 过期天数（可选）

        Returns:
            包含原始key和key_id的字典
        """
        # 生成原始Key
        raw_key = self.generate_api_key()

        # 哈希存储
        key_hash = self.hash_key(raw_key)

        # 计算过期时间
        expires_at = None
        if expires_in_days:
            expires_at = datetime.utcnow() + timedelta(days=expires_in_days)

        # 默认权限
        if permissions is None:
            permissions = ["product_selection:write"]

        # 创建记录
        api_key = APIKey(
            user_id=user_id,
            key_hash=key_hash,
            name=name,
            permissions=permissions,
            is_active=True,
            expires_at=expires_at
        )

        db.add(api_key)
        await db.commit()
        await db.refresh(api_key)

        logger.info(f"创建API Key: id={api_key.id}, user_id={user_id}, name={name}")

        return {
            "key_id": api_key.id,
            "key": raw_key,  # 仅在创建时返回原始Key
            "name": name,
            "permissions": permissions,
            "expires_at": api_key.expires_at.isoformat() if api_key.expires_at else None,
            "created_at": api_key.created_at.isoformat()
        }

    async def validate_api_key(
        self,
        db: AsyncSession,
        key: str
    ) -> Optional[User]:
        """
        验证API Key并返回关联用户

        使用 SHA256 哈希直接查询数据库，O(1) 复杂度。

        Args:
            db: 数据库会话
            key: 原始API Key

        Returns:
            验证通过返回User对象，否则返回None
        """
        # 计算 SHA256 哈希
        key_hash = self.hash_key(key)

        # 直接通过哈希查询（O(1)，微秒级）
        stmt = select(APIKey).where(
            and_(
                APIKey.key_hash == key_hash,
                APIKey.is_active == True,
                # 检查是否过期
                (APIKey.expires_at.is_(None) | (APIKey.expires_at > datetime.utcnow()))
            )
        )
        result = await db.execute(stmt)
        api_key = result.scalar_one_or_none()

        if not api_key:
            logger.warning("API Key验证失败: 无效的Key")
            return None

        # 更新最后使用时间
        api_key.last_used_at = datetime.utcnow()
        await db.commit()

        # 获取关联用户
        user_stmt = select(User).where(
            and_(
                User.id == api_key.user_id,
                User.is_active == True
            )
        )
        user_result = await db.execute(user_stmt)
        user = user_result.scalar_one_or_none()

        if user:
            logger.info(f"API Key验证成功: key_id={api_key.id}, user_id={user.id}")
            return user
        else:
            logger.warning(f"API Key关联用户不存在或未激活: key_id={api_key.id}")
            return None

    async def list_user_keys(
        self,
        db: AsyncSession,
        user_id: int
    ) -> List[Dict[str, Any]]:
        """
        列出用户的所有API Keys

        Args:
            db: 数据库会话
            user_id: 用户ID

        Returns:
            API Key列表（不包含key_hash）
        """
        stmt = select(APIKey).where(
            APIKey.user_id == user_id
        ).order_by(APIKey.created_at.desc())

        result = await db.execute(stmt)
        api_keys = result.scalars().all()

        return [key.to_dict() for key in api_keys]

    async def delete_api_key(
        self,
        db: AsyncSession,
        key_id: int,
        user_id: int
    ) -> bool:
        """
        删除API Key

        Args:
            db: 数据库会话
            key_id: Key ID
            user_id: 用户ID（用于权限检查）

        Returns:
            删除成功返回True
        """
        stmt = select(APIKey).where(
            and_(
                APIKey.id == key_id,
                APIKey.user_id == user_id
            )
        )
        result = await db.execute(stmt)
        api_key = result.scalar_one_or_none()

        if not api_key:
            logger.warning(f"尝试删除不存在的API Key: key_id={key_id}, user_id={user_id}")
            return False

        await db.delete(api_key)
        await db.commit()

        logger.info(f"删除API Key: key_id={key_id}, user_id={user_id}")
        return True

    async def regenerate_api_key(
        self,
        db: AsyncSession,
        key_id: int,
        user_id: int
    ) -> Optional[Dict[str, Any]]:
        """
        重新生成API Key（保留其他信息）

        Args:
            db: 数据库会话
            key_id: Key ID
            user_id: 用户ID（用于权限检查）

        Returns:
            新的API Key信息（包含原始key）
        """
        stmt = select(APIKey).where(
            and_(
                APIKey.id == key_id,
                APIKey.user_id == user_id
            )
        )
        result = await db.execute(stmt)
        api_key = result.scalar_one_or_none()

        if not api_key:
            logger.warning(f"尝试重新生成不存在的API Key: key_id={key_id}, user_id={user_id}")
            return None

        # 生成新Key
        raw_key = self.generate_api_key()
        api_key.key_hash = self.hash_key(raw_key)
        api_key.updated_at = datetime.utcnow()

        await db.commit()
        await db.refresh(api_key)

        logger.info(f"重新生成API Key: key_id={key_id}, user_id={user_id}")

        return {
            "key_id": api_key.id,
            "key": raw_key,  # 返回新的原始Key
            "name": api_key.name,
            "permissions": api_key.permissions,
            "expires_at": api_key.expires_at.isoformat() if api_key.expires_at else None,
            "updated_at": api_key.updated_at.isoformat()
        }

    async def check_permission(
        self,
        db: AsyncSession,
        key: str,
        required_permission: str
    ) -> bool:
        """
        检查API Key是否有指定权限

        Args:
            db: 数据库会话
            key: 原始API Key
            required_permission: 所需权限（如"product_selection:write"）

        Returns:
            有权限返回True
        """
        # 计算 SHA256 哈希，直接查询
        key_hash = self.hash_key(key)

        stmt = select(APIKey).where(
            and_(
                APIKey.key_hash == key_hash,
                APIKey.is_active == True,
                (APIKey.expires_at.is_(None) | (APIKey.expires_at > datetime.utcnow()))
            )
        )
        result = await db.execute(stmt)
        api_key = result.scalar_one_or_none()

        if not api_key:
            return False

        # 检查权限
        if "*" in api_key.permissions or required_permission in api_key.permissions:
            return True

        return False


# 单例模式
_api_key_service_instance = None


def get_api_key_service() -> APIKeyService:
    """获取API Key服务实例（单例）"""
    global _api_key_service_instance
    if _api_key_service_instance is None:
        _api_key_service_instance = APIKeyService()
    return _api_key_service_instance
