"""
安全中间件

提供：
- 安全响应头（X-Content-Type-Options, X-Frame-Options, Referrer-Policy）
- 请求大小限制
- 全局速率限制（使用 slowapi）

注意：X-XSS-Protection 已弃用，现代浏览器有内置 XSS 防护
"""
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from ef_core.utils.logger import get_logger

logger = get_logger(__name__)

# 请求体大小限制（10MB）
MAX_REQUEST_SIZE = 10 * 1024 * 1024


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """安全响应头中间件"""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        # 添加安全响应头
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        # X-XSS-Protection 已弃用，现代浏览器有内置 XSS 防护，不再需要此头部
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        return response


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """请求大小限制中间件"""

    def __init__(self, app, max_size: int = MAX_REQUEST_SIZE):
        super().__init__(app)
        self.max_size = max_size

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # 检查 Content-Length 头
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                size = int(content_length)
                if size > self.max_size:
                    return JSONResponse(
                        status_code=413,
                        content={
                            "ok": False,
                            "error": {
                                "type": "about:blank",
                                "title": "Request Entity Too Large",
                                "status": 413,
                                "detail": f"Request body exceeds {self.max_size // (1024 * 1024)}MB limit",
                                "code": "REQUEST_TOO_LARGE"
                            }
                        }
                    )
            except ValueError:
                pass

        return await call_next(request)


def setup_rate_limiter(app):
    """
    设置全局速率限制

    使用 slowapi 库实现，配置：
    - 默认限制：100 requests/minute per IP
    - 登录接口：10 requests/minute per IP（防暴力破解）

    注意：生产环境需要配置 EF__RATE_LIMIT_ENABLED=true 才会启用
    """
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded

    # 创建限流器
    limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])

    # 注册到应用
    app.state.limiter = limiter

    # 添加异常处理器
    app.add_exception_handler(
        RateLimitExceeded,
        lambda request, exc: JSONResponse(
            status_code=429,
            content={
                "ok": False,
                "error": {
                    "type": "about:blank",
                    "title": "Too Many Requests",
                    "status": 429,
                    "detail": "Rate limit exceeded. Please slow down.",
                    "code": "RATE_LIMIT_EXCEEDED"
                }
            }
        )
    )

    logger.info("Rate limiter configured: 100 requests/minute per IP")

    return limiter
