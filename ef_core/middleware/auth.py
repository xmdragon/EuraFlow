"""
认证中间件（简化版本）
"""
from typing import Callable, Optional

from fastapi import Request, Response
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
                raise UnauthorizedError(
                    code="MISSING_AUTH_HEADER",
                    detail="Authorization header or X-API-Key header is required"
                )
        
        # 简化的 token 验证（生产环境需要实现 JWT 验证）
        if not auth_header.startswith("Bearer "):
            raise UnauthorizedError(
                code="INVALID_AUTH_FORMAT",
                detail="Authorization header must start with 'Bearer '"
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
                raise UnauthorizedError(
                    code="INVALID_TOKEN",
                    detail="Invalid or expired token"
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