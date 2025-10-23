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
        "/api/ef/v1/ozon/webhook"  # Ozon webhook回调端点
    }

    # 公开路径前缀（用于内部管理接口）
    PUBLIC_PREFIXES = [
        "/docs",
        "/redoc",
        "/api/ef/v1/ozon/webhook",
        "/api/ef/v1/ozon/sync-services"  # 同步服务管理接口
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
        
        # 设置用户信息到请求状态
        request.state.user_id = user_info["user_id"]
        request.state.shop_id = user_info.get("shop_id")
        request.state.permissions = user_info.get("permissions", [])
        
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
            
            # 返回用户信息
            return {
                "user_id": int(payload.get("sub")),
                "shop_id": payload.get("shop_id"),
                "permissions": payload.get("permissions", []),
                "role": payload.get("role", "viewer")
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
        required_role: 要求的角色 (operator, admin)

    Returns:
        bool: 是否满足角色要求

    角色权限层级：
    - admin > operator > viewer
    - admin 可以执行所有操作
    - operator 可以修改数据
    - viewer 只能查看数据
    """
    if not user:
        return False

    # admin 拥有最高权限
    if user.role == "admin":
        return True

    # 如果要求 operator 角色
    if required_role == "operator":
        return user.role in ["operator", "admin"]

    # 如果要求 admin 角色
    if required_role == "admin":
        return user.role == "admin"

    return False


def require_role(required_role: str = "operator"):
    """
    创建角色检查依赖函数，用于FastAPI路由的权限控制

    Usage:
        from ef_core.api.auth import get_current_user_flexible
        from ef_core.middleware.auth import require_role

        @router.post("/products")
        async def create_product(
            current_user: User = Depends(require_role("operator"))
        ):
            # 只有 operator 和 admin 可以访问
            pass

    Args:
        required_role: 要求的最低角色 (operator 或 admin)

    Returns:
        依赖函数，用于FastAPI的Depends()
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
                "admin": "管理员",
                "operator": "操作员",
                "viewer": "查看员"
            }
            current_role_name = role_names.get(user.role, user.role)
            required_role_name = role_names.get(required_role, required_role)

            raise ForbiddenError(
                code="INSUFFICIENT_PERMISSIONS",
                detail=f"您的角色为{current_role_name}，无权执行此操作。需要{required_role_name}或更高权限。"
            )

        return user

    return _check_role