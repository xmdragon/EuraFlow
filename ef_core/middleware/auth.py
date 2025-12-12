"""
认证中间件（简化版本）
"""
from typing import Callable, Optional

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from ef_core.utils.logger import get_logger
from ef_core.utils.errors import UnauthorizedError, ForbiddenError
from ef_core.services.auth_service import get_auth_service


class AuthMiddleware(BaseHTTPMiddleware):
    """认证中间件"""

    # 无需认证的路径
    PUBLIC_PATHS = {
        "/healthz",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/api/ef/v1/auth/login",
        "/api/ef/v1/auth/refresh",
        "/api/ef/v1/auth/captcha",  # 滑块验证码
        "/api/ef/v1/auth/captcha/verify",  # 验证码验证
        "/api/ef/v1/ozon/webhook"  # Ozon webhook回调端点
    }

    # 公开路径前缀（用于内部管理接口）
    PUBLIC_PREFIXES = [
        "/docs",
        "/redoc",
        "/api/ef/v1/ozon/webhook",
        "/api/ef/v1/ozon/sync-services"  # 同步服务管理接口
    ]

    # 克隆状态下禁止访问的路径前缀
    # 注意：用户管理 /api/ef/v1/auth/users 不在此列表中，因为 manager 可以管理自己的子账号
    # 克隆 manager 后应该能看到该 manager 的子账号列表（后端 API 会根据角色自动过滤）
    CLONE_RESTRICTED_PREFIXES = [
        "/api/ef/v1/system",          # 系统管理（仅 admin）
        "/api/ef/v1/manager-levels",  # 管理员级别（仅 admin）
    ]

    # 克隆状态下允许访问的特殊路径（白名单，优先于 CLONE_RESTRICTED_PREFIXES）
    CLONE_ALLOWED_PATHS = [
        "/api/ef/v1/auth/clone/restore",  # 恢复身份
        "/api/ef/v1/auth/clone/status",   # 获取状态
    ]
    
    def __init__(self, app, logger=None):
        super().__init__(app)
        self.logger = logger or get_logger("middleware.auth")
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # 检查是否为公开路径
        if self._is_public_path(request.url.path):
            return await call_next(request)

        # 1. 优先检查 X-API-Key 头（用于API Key认证）
        api_key = request.headers.get("x-api-key")
        if api_key:
            # API Key 认证交给路由层处理
            # 这里只是标记已提供认证凭据，不进行验证
            return await call_next(request)

        # 2. 检查 Authorization 头（JWT Token认证）
        auth_header = request.headers.get("authorization", "")

        if not auth_header:
            # 对于开发环境，允许无认证访问
            from ef_core.config import get_settings
            settings = get_settings()
            if settings.api_debug:
                # 设置开发环境默认用户信息
                request.state.user_id = 1
                request.state.shop_id = None  # 不设置默认店铺ID
                request.state.permissions = ["*"]
                return await call_next(request)
            else:
                return JSONResponse(
                    status_code=401,
                    content={
                        "ok": False,
                        "error": {
                            "type": "about:blank",
                            "title": "Unauthorized",
                            "status": 401,
                            "detail": "Authorization header or X-API-Key header is required",
                            "code": "MISSING_AUTH_HEADER"
                        }
                    }
                )
        
        # 简化的 token 验证（生产环境需要实现 JWT 验证）
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={
                    "ok": False,
                    "error": {
                        "type": "about:blank",
                        "title": "Unauthorized",
                        "status": 401,
                        "detail": "Authorization header must start with 'Bearer '",
                        "code": "INVALID_AUTH_FORMAT"
                    }
                }
            )
        
        token = auth_header[7:]  # 移除 "Bearer "
        
        # 验证 token（这里是简化实现）
        user_info = await self._validate_token(token)
        if not user_info:
            # 对于开发环境，即使 token 无效也允许访问
            from ef_core.config import get_settings
            settings = get_settings()
            if settings.api_debug:
                # 设置开发环境默认用户信息
                request.state.user_id = 1
                request.state.shop_id = None  # 不设置默认店铺ID
                request.state.permissions = ["*"]
                return await call_next(request)
            else:
                return JSONResponse(
                    status_code=401,
                    content={
                        "ok": False,
                        "error": {
                            "type": "about:blank",
                            "title": "Unauthorized",
                            "status": 401,
                            "detail": "Invalid or expired token",
                            "code": "INVALID_TOKEN"
                        }
                    }
                )
        
        # 设置用户信息到请求状态（包含 shop_ids，避免后续数据库查询）
        request.state.user_id = user_info["user_id"]
        request.state.shop_id = user_info.get("shop_id")
        request.state.shop_ids = user_info.get("shop_ids")  # None 表示 admin 可访问所有
        request.state.permissions = user_info.get("permissions", [])
        request.state.role = user_info.get("role", "sub_account")
        request.state.can_write = user_info.get("can_write", True)
        request.state.write_error = user_info.get("write_error", "")

        # 设置克隆状态信息
        request.state.is_cloned = user_info.get("is_cloned", False)
        request.state.clone_session_id = user_info.get("clone_session_id")
        request.state.original_user_id = user_info.get("original_user_id")

        # 克隆状态下检查受限路径
        if user_info.get("is_cloned"):
            if self._is_clone_restricted_path(request.url.path):
                return JSONResponse(
                    status_code=403,
                    content={
                        "ok": False,
                        "error": {
                            "type": "about:blank",
                            "title": "Forbidden",
                            "status": 403,
                            "detail": "克隆状态下无法访问此功能，请先恢复身份",
                            "code": "CLONE_RESTRICTED"
                        }
                    }
                )

        # 检查写操作权限（对于 suspended 或 expired 账号）
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if not user_info.get("can_write", True):
                return JSONResponse(
                    status_code=403,
                    content={
                        "ok": False,
                        "error": {
                            "type": "about:blank",
                            "title": "Forbidden",
                            "status": 403,
                            "detail": user_info.get("write_error", "账号已到期"),
                            "code": "ACCOUNT_WRITE_FORBIDDEN"
                        }
                    }
                )

        # 继续处理请求
        return await call_next(request)
    
    def _is_public_path(self, path: str) -> bool:
        """检查是否为公开路径"""
        # 精确匹配
        if path in self.PUBLIC_PATHS:
            return True

        # 前缀匹配
        for prefix in self.PUBLIC_PREFIXES:
            if path.startswith(prefix):
                return True

        return False

    def _is_clone_restricted_path(self, path: str) -> bool:
        """检查是否为克隆状态下受限的路径"""
        # 先检查白名单
        if path in self.CLONE_ALLOWED_PATHS:
            return False

        # 检查受限前缀
        for prefix in self.CLONE_RESTRICTED_PREFIXES:
            if path.startswith(prefix):
                return True

        return False
    
    async def _validate_token(self, token: str) -> Optional[dict]:
        """验证 JWT token"""
        auth_service = get_auth_service()

        try:
            # 解码令牌
            payload = auth_service.decode_token(token)

            # 验证令牌类型
            if payload.get("type") != "access":
                return None

            # 检查黑名单
            jti = payload.get("jti")
            if jti and await auth_service.is_token_revoked(jti):
                return None

            # 验证会话令牌（单设备登录）和账号状态
            session_token = payload.get("session_token")
            user_id = int(payload.get("sub"))
            can_write = True
            write_error = ""

            from ef_core.database import get_db_manager
            from ef_core.models.users import User
            from sqlalchemy import select
            from sqlalchemy.orm import selectinload

            db_manager = get_db_manager()
            async with db_manager.get_session() as db:
                # 查询用户（包含 parent_user 用于子账号继承状态）
                stmt = select(User).where(User.id == user_id).options(
                    selectinload(User.parent_user)
                )
                result = await db.execute(stmt)
                user = result.scalar_one_or_none()

                if not user:
                    return None

                # 验证会话令牌
                if session_token and user.current_session_token:
                    if user.current_session_token != session_token:
                        self.logger.info(
                            f"Session expired for user {user_id}: "
                            f"current={user.current_session_token[:8]}..., provided={session_token[:8]}..."
                        )
                        return None

                # 检查账号是否可以执行写操作（admin 不受限制）
                can_write, write_error = user.can_write()

            # 解析克隆状态
            is_cloned = payload.get("is_cloned", False)
            clone_session_id = payload.get("clone_session_id")
            original_user_id = payload.get("original_user_id")

            # 如果是克隆状态，验证克隆会话是否有效
            if is_cloned and clone_session_id:
                from ef_core.services.clone_service import get_clone_service
                clone_service = get_clone_service()
                session_valid = await clone_service.validate_clone_session(clone_session_id)
                if not session_valid:
                    self.logger.info(f"Clone session expired: {clone_session_id}")
                    return None

            # 返回用户信息（包含 shop_ids、session_token、写权限和克隆状态）
            return {
                "user_id": user_id,
                "shop_id": payload.get("shop_id"),
                "shop_ids": payload.get("shop_ids"),  # None 表示 admin 可访问所有
                "permissions": payload.get("permissions", []),
                "role": payload.get("role", "sub_account"),
                "session_token": session_token,
                "can_write": can_write,
                "write_error": write_error,
                "is_cloned": is_cloned,
                "clone_session_id": clone_session_id,
                "original_user_id": original_user_id
            }

        except Exception as e:
            self.logger.debug(f"Token validation failed: {e}")
            return None
    
    def check_permission(self, request: Request, required_permission: str) -> bool:
        """检查权限"""
        user_permissions = getattr(request.state, "permissions", [])
        
        # 超级权限
        if "*" in user_permissions:
            return True
        
        # 精确权限匹配
        if required_permission in user_permissions:
            return True
        
        return False


def require_permission(permission: str):
    """权限装饰器"""
    def decorator(func):
        async def wrapper(request: Request, *args, **kwargs):
            # 获取认证中间件实例（简化实现）
            auth_middleware = AuthMiddleware(None)

            if not auth_middleware.check_permission(request, permission):
                raise ForbiddenError(
                    code="INSUFFICIENT_PERMISSIONS",
                    detail=f"Required permission: {permission}"
                )

            return await func(request, *args, **kwargs)

        return wrapper
    return decorator


def check_role(user, required_role: str) -> bool:
    """检查用户角色是否满足要求

    Args:
        user: 用户对象
        required_role: 要求的角色 (sub_account, manager, admin)

    Returns:
        bool: 是否满足角色要求

    角色权限层级：
    - admin > manager > sub_account
    - admin: 超级管理员，可以查看所有店铺，管理所有用户
    - manager: 管理员，可以创建子账号和店铺（受级别限额）
    - sub_account: 子账号，只能查看被绑定的店铺
    """
    if not user:
        return False

    user_role = user.role

    # admin 拥有最高权限
    if user_role == "admin":
        return True

    # 如果要求 manager 角色
    if required_role == "manager":
        return user_role in ["manager", "admin"]

    # 如果要求 admin 角色
    if required_role == "admin":
        return user_role == "admin"

    # 如果要求 sub_account 角色（最低权限）
    if required_role == "sub_account":
        return user_role in ["sub_account", "manager", "admin"]

    return False


def require_role(required_role: str = "manager"):
    """
    创建角色检查依赖函数，用于FastAPI路由的权限控制

    Usage:
        from ef_core.api.auth import get_current_user_flexible
        from ef_core.middleware.auth import require_role

        @router.post("/products")
        async def create_product(
            current_user: User = Depends(require_role("manager"))
        ):
            # 只有 manager 和 admin 可以访问
            pass

    Args:
        required_role: 要求的最低角色 (sub_account, manager, admin)

    Returns:
        依赖函数，用于FastAPI的Depends()

    角色层级：
    - admin: 超级管理员
    - manager: 管理员（可创建子账号和店铺）
    - sub_account: 子账号（仅查看绑定的店铺）
    """
    from ef_core.api.auth import get_current_user_flexible
    from fastapi import Depends

    async def _check_role(user=Depends(get_current_user_flexible)):
        """内部角色检查函数"""
        if not user:
            raise ForbiddenError(
                code="AUTHENTICATION_REQUIRED",
                detail="需要登录才能执行此操作"
            )

        if not check_role(user, required_role):
            role_names = {
                "admin": "超级管理员",
                "manager": "管理员",
                "sub_account": "子账号"
            }
            current_role_name = role_names.get(user.role, user.role)
            required_role_name = role_names.get(required_role, required_role)

            raise ForbiddenError(
                code="INSUFFICIENT_PERMISSIONS",
                detail=f"您的角色为{current_role_name}，无权执行此操作。需要{required_role_name}或更高权限。"
            )

        return user

    return _check_role


def require_shops():
    """
    创建店铺检查依赖函数，确保用户已关联至少一个店铺

    Usage:
        from ef_core.middleware.auth import require_shops

        @router.get("/settings")
        async def get_settings(
            current_user: User = Depends(require_shops())
        ):
            # 只有关联了店铺的用户才能访问
            pass

    Returns:
        依赖函数，用于FastAPI的Depends()
    """
    from ef_core.api.auth import get_current_user_flexible
    from fastapi import Depends

    async def _check_shops(user=Depends(get_current_user_flexible)):
        """内部店铺检查函数"""
        if not user:
            raise ForbiddenError(
                code="AUTHENTICATION_REQUIRED",
                detail="需要登录才能执行此操作"
            )

        # 检查用户是否有关联店铺
        # 优先使用缓存的 shop_ids，否则检查 shops 关系
        has_shops = False
        if hasattr(user, '_cached_shop_ids') and user._cached_shop_ids is not None:
            has_shops = len(user._cached_shop_ids) > 0
        elif hasattr(user, 'shops') and user.shops:
            has_shops = len(user.shops) > 0

        if not has_shops:
            raise ForbiddenError(
                code="NO_SHOPS",
                detail="请先添加店铺后再使用此功能"
            )

        return user

    return _check_shops