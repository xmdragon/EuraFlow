"""
认证服务
"""
import os
import secrets
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from uuid import uuid4

import bcrypt
from jose import JWTError, jwt
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import redis.asyncio as redis

from ef_core.config import get_settings
from ef_core.database import get_db_manager
from ef_core.models.users import User
from ef_core.utils.logger import get_logger
from ef_core.utils.errors import UnauthorizedError, ValidationError
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload

# 延迟导入避免循环依赖
def _get_session_service():
    from ef_core.services.session_service import get_session_service
    return get_session_service()

logger = get_logger(__name__)


class AuthService:
    """认证服务"""
    
    def __init__(self):
        self.settings = get_settings()
        self._redis_client = None
        self._fernet = None
        
        # JWT配置
        # 访问令牌：8小时（开发和生产环境统一）
        # 刷新令牌：7天
        self.access_token_expire = timedelta(hours=8)
        self.refresh_token_expire = timedelta(days=7)
        self.algorithm = "HS256"
    
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
    
    @property
    def fernet(self) -> Fernet:
        """获取Fernet加密器（用于API密钥加密）"""
        if not self._fernet:
            # 从SECRET_KEY派生加密密钥
            secret_key = self.settings.secret_key.encode()
            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=b'euraflow_salt',  # 固定salt用于密钥派生
                iterations=100000,
            )
            key = base64.urlsafe_b64encode(kdf.derive(secret_key))
            self._fernet = Fernet(key)
        return self._fernet
    
    # ========== 密码处理 ==========

    def hash_password(self, password: str) -> str:
        """哈希密码"""
        # 确保密码不超过72字节（bcrypt限制）
        password_bytes = password[:72].encode('utf-8')
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password_bytes, salt)
        return hashed.decode('utf-8')

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """验证密码"""
        # 确保密码不超过72字节（bcrypt限制）
        password_bytes = plain_password[:72].encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')
        try:
            return bcrypt.checkpw(password_bytes, hashed_bytes)
        except Exception as e:
            logger.error(f"Password verification error: {e}")
            return False
    
    # ========== JWT处理 ==========
    
    def create_access_token(self, data: dict) -> str:
        """创建访问令牌"""
        to_encode = data.copy()
        expire = datetime.now(timezone.utc) + self.access_token_expire
        to_encode.update({
            "exp": expire,
            "type": "access",
            "jti": str(uuid4())  # JWT ID用于黑名单
        })
        
        return jwt.encode(to_encode, self.settings.secret_key, algorithm=self.algorithm)
    
    def create_refresh_token(self, data: dict) -> str:
        """创建刷新令牌"""
        to_encode = data.copy()
        expire = datetime.now(timezone.utc) + self.refresh_token_expire
        jti = str(uuid4())
        to_encode.update({
            "exp": expire,
            "type": "refresh",
            "jti": jti
        })
        
        return jwt.encode(to_encode, self.settings.secret_key, algorithm=self.algorithm)
    
    def decode_token(self, token: str) -> dict:
        """解码JWT令牌"""
        try:
            payload = jwt.decode(
                token, 
                self.settings.secret_key, 
                algorithms=[self.algorithm]
            )
            return payload
        except JWTError as e:
            raise UnauthorizedError(
                code="INVALID_TOKEN",
                detail=f"Token validation failed: {str(e)}"
            )
    
    async def revoke_token(self, jti: str, expires_in: int):
        """撤销令牌（加入黑名单）"""
        try:
            await self.redis_client.setex(
                f"token_blacklist:{jti}",
                expires_in,
                "revoked"
            )
            logger.info(f"Token revoked", jti=jti)
        except Exception as e:
            logger.error(f"Failed to revoke token", jti=jti, exc_info=True)
    
    async def is_token_revoked(self, jti: str) -> bool:
        """检查令牌是否被撤销"""
        try:
            result = await self.redis_client.get(f"token_blacklist:{jti}")
            return result is not None
        except Exception as e:
            logger.error(f"Failed to check token blacklist", jti=jti, exc_info=True)
            return False
    
    # ========== 用户认证 ==========
    
    async def authenticate_user(self, email_or_username: str, password: str) -> Optional[User]:
        """认证用户（支持用户名或手机号登录）"""
        db_manager = get_db_manager()

        async with db_manager.get_session() as session:
            # 查询用户（支持用户名或手机号，包含 parent_user 用于子账号继承状态）
            stmt = select(User).where(
                or_(
                    User.username == email_or_username,
                    User.phone == email_or_username
                )
            ).options(
                selectinload(User.primary_shop),
                selectinload(User.shops),
                selectinload(User.parent_user)
            )

            result = await session.execute(stmt)
            user = result.scalar_one_or_none()

            if not user:
                return None

            # 验证密码
            if not self.verify_password(password, user.password_hash):
                return None

            # 检查用户是否激活
            if not user.is_active:
                raise UnauthorizedError(
                    code="USER_INACTIVE",
                    detail="User account is deactivated"
                )

            # 检查账号状态和过期时间（admin 不受限制）
            can_login, error_msg = user.can_login()
            if not can_login:
                raise UnauthorizedError(
                    code="ACCOUNT_STATUS_ERROR",
                    detail=error_msg
                )

            # 更新最后登录时间
            user.last_login_at = datetime.now(timezone.utc)
            await session.commit()

            # 刷新用户对象以确保所有属性都已加载
            await session.refresh(user)

            return user
    
    async def login(
        self,
        email_or_username: str,
        password: str,
        ip_address: str = None,
        user_agent: str = None,
        device_info: str = None
    ) -> dict:
        """用户登录

        Args:
            email_or_username: 邮箱或用户名
            password: 密码
            ip_address: 客户端IP地址
            user_agent: User-Agent
            device_info: 设备信息

        Returns:
            dict: 包含 access_token, refresh_token, user, kicked_session_token
        """
        # 检查登录限流
        if await self.check_rate_limit(email_or_username, ip_address):
            raise UnauthorizedError(
                code="RATE_LIMIT_EXCEEDED",
                detail="Too many login attempts. Please try again later."
            )

        # 使用数据库管理器获取新会话
        db_manager = get_db_manager()
        kicked_session_token = None

        async with db_manager.get_session() as session:
            # 认证用户
            user = await self.authenticate_user(email_or_username, password)

            if not user:
                # 记录失败尝试
                await self.record_login_attempt(email_or_username, ip_address, success=False)
                logger.warning(f"Login failed", username=email_or_username, ip=ip_address)

                raise UnauthorizedError(
                    code="INVALID_CREDENTIALS",
                    detail="Invalid username or password"
                )

            # 记录成功登录
            await self.record_login_attempt(email_or_username, ip_address, success=True)
            logger.info(f"User logged in", user_id=user.id, username=user.username, ip=ip_address)

            # 单设备登录：创建新会话，踢出旧设备
            session_service = _get_session_service()
            session_token, kicked_session_token = await session_service.create_session(
                db=session,
                user_id=user.id,
                device_info=device_info,
                ip_address=ip_address,
                user_agent=user_agent
            )

            await session.commit()

            # 重新查询用户以获取最新数据
            stmt = select(User).where(User.id == user.id).options(
                selectinload(User.shops),
                selectinload(User.account_level)
            )
            result = await session.execute(stmt)
            user = result.scalar_one()

            # 在会话内构建用户数据，避免detached instance错误
            # 手机号脱敏：第5-8位用*代替
            masked_phone = None
            if user.phone and len(user.phone) == 11:
                masked_phone = f"{user.phone[:3]}****{user.phone[7:]}"

            user_data = {
                "id": user.id,
                "username": user.username,
                "phone": masked_phone,  # 脱敏后的手机号
                "username_changed": user.username_changed,
                "role": user.role,
                "permissions": user.permissions,
                "is_active": user.is_active,
                "account_status": user.account_status,
                "expires_at": user.expires_at.isoformat() if user.expires_at else None,
                "parent_user_id": user.parent_user_id,
                "primary_shop_id": user.primary_shop_id,
                "shop_ids": [shop.id for shop in user.shops] if user.shops else [],
                "account_level_id": user.account_level_id,
                "account_level": user.account_level.to_dict() if user.account_level else None,
                "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
                "created_at": user.created_at.isoformat(),
                "updated_at": user.updated_at.isoformat()
            }

            # 获取用户的权限代码列表（从角色权限表）
            from ef_core.services.permission_service import get_permission_service
            permission_service = get_permission_service()
            permission_codes = await permission_service.get_user_permissions(session, user.role)

            # 创建令牌（包含店铺权限和会话令牌，避免每次请求查询数据库）
            # admin 用户 shop_ids 为 None（表示可访问所有店铺）
            shop_ids = None if user.role == "admin" else [shop.id for shop in user.shops] if user.shops else []
            token_data = {
                "sub": str(user.id),
                "username": user.username,
                "role": user.role,
                "permissions": permission_codes,  # 使用从角色权限表查询的权限
                "shop_id": user.primary_shop_id,
                "shop_ids": shop_ids,  # 存入 JWT，避免每次查询
                "session_token": session_token  # 会话令牌，用于单设备登录验证
            }

        access_token = self.create_access_token(token_data)
        refresh_token = self.create_refresh_token({"sub": str(user.id), "session_token": session_token})

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "user": user_data,
            "kicked_session_token": kicked_session_token  # 被踢出的旧会话令牌，用于WebSocket通知
        }
    
    async def refresh_access_token(self, refresh_token: str) -> dict:
        """刷新访问令牌"""
        try:
            payload = self.decode_token(refresh_token)

            # 验证令牌类型
            if payload.get("type") != "refresh":
                raise UnauthorizedError(
                    code="INVALID_TOKEN_TYPE",
                    detail="Invalid token type"
                )

            # 检查黑名单
            jti = payload.get("jti")
            if await self.is_token_revoked(jti):
                raise UnauthorizedError(
                    code="TOKEN_REVOKED",
                    detail="Token has been revoked"
                )

            # 获取会话令牌（用于单设备登录验证）
            session_token = payload.get("session_token")

            # 获取用户信息
            user_id = payload.get("sub")
            db_manager = get_db_manager()

            async with db_manager.get_session() as session:
                stmt = select(User).where(User.id == int(user_id)).options(selectinload(User.shops))
                result = await session.execute(stmt)
                user = result.scalar_one_or_none()

                if not user or not user.is_active:
                    raise UnauthorizedError(
                        code="USER_NOT_FOUND",
                        detail="User not found or inactive"
                    )

                # 验证会话令牌（单设备登录）
                if session_token and user.current_session_token:
                    if user.current_session_token != session_token:
                        raise UnauthorizedError(
                            code="SESSION_EXPIRED",
                            detail="您的账号在其他设备登录，当前会话已失效"
                        )

                # 获取用户的权限代码列表（从角色权限表）
                # Token 刷新时重新查询权限，实现权限变更生效
                from ef_core.services.permission_service import get_permission_service
                permission_service = get_permission_service()
                permission_codes = await permission_service.get_user_permissions(session, user.role)

                # 创建新的访问令牌（包含店铺权限和会话令牌）
                shop_ids = None if user.role == "admin" else [shop.id for shop in user.shops] if user.shops else []
                token_data = {
                    "sub": str(user.id),
                    "username": user.username,
                    "role": user.role,
                    "permissions": permission_codes,  # 使用从角色权限表查询的权限
                    "shop_id": user.primary_shop_id,
                    "shop_ids": shop_ids,
                    "session_token": session_token  # 保持原会话令牌
                }

                new_access_token = self.create_access_token(token_data)

                # 旋转refresh token（保持session_token）
                new_refresh_token = self.create_refresh_token({
                    "sub": str(user.id),
                    "session_token": session_token
                })

                # 撤销旧的refresh token
                await self.revoke_token(jti, int(self.refresh_token_expire.total_seconds()))

                return {
                    "access_token": new_access_token,
                    "refresh_token": new_refresh_token,
                    "token_type": "bearer"
                }

        except JWTError as e:
            raise UnauthorizedError(
                code="INVALID_TOKEN",
                detail=f"Invalid refresh token: {str(e)}"
            )
    
    async def logout(self, access_token: str, refresh_token: str = None):
        """用户登出"""
        try:
            # 撤销访问令牌
            access_payload = self.decode_token(access_token)
            access_jti = access_payload.get("jti")
            if access_jti:
                await self.revoke_token(
                    access_jti, 
                    int(self.access_token_expire.total_seconds())
                )
            
            # 撤销刷新令牌
            if refresh_token:
                refresh_payload = self.decode_token(refresh_token)
                refresh_jti = refresh_payload.get("jti")
                if refresh_jti:
                    await self.revoke_token(
                        refresh_jti,
                        int(self.refresh_token_expire.total_seconds())
                    )
            
            logger.info("User logged out", user_id=access_payload.get("sub"))
            
        except Exception as e:
            logger.error("Logout error", exc_info=True)
    
    # ========== 限流 ==========
    
    async def check_rate_limit(self, identifier: str, ip_address: str = None) -> bool:
        """检查登录限流（5次/分钟）"""
        try:
            # 组合标识符（账号+IP）
            key = f"login_rate:{identifier}"
            if ip_address:
                key += f":{ip_address}"
            
            # 获取当前计数
            count = await self.redis_client.get(key)
            if count and int(count) >= 5:
                return True
            
            return False
            
        except Exception as e:
            logger.error("Rate limit check failed", exc_info=True)
            return False
    
    async def record_login_attempt(
        self, 
        identifier: str, 
        ip_address: str = None,
        success: bool = False
    ):
        """记录登录尝试"""
        try:
            if not success:
                # 失败时增加计数
                key = f"login_rate:{identifier}"
                if ip_address:
                    key += f":{ip_address}"
                
                await self.redis_client.incr(key)
                await self.redis_client.expire(key, 60)  # 1分钟过期
            
            # 记录指标（用于Prometheus）
            metric_key = "ef_auth_login_success_total" if success else "ef_auth_login_fail_total"
            await self.redis_client.incr(metric_key)
            
        except Exception as e:
            logger.error("Failed to record login attempt", exc_info=True)
    
    # ========== API密钥加密 ==========
    
    def encrypt_api_key(self, api_key: str) -> str:
        """加密API密钥"""
        return self.fernet.encrypt(api_key.encode()).decode()
    
    def decrypt_api_key(self, encrypted_key: str) -> str:
        """解密API密钥"""
        return self.fernet.decrypt(encrypted_key.encode()).decode()


# 全局认证服务实例
_auth_service: Optional[AuthService] = None


def get_auth_service() -> AuthService:
    """获取认证服务单例"""
    global _auth_service
    if _auth_service is None:
        _auth_service = AuthService()
    return _auth_service


import base64  # 添加缺失的导入