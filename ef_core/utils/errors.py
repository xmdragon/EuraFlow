"""
EuraFlow 错误处理系统
遵循 RFC7807 Problem Details 标准
"""
from typing import Any, Dict, Optional
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


class ProblemDetail(BaseModel):
    """RFC7807 Problem Details 模型"""
    type: str = Field(default="about:blank")
    title: str
    status: int
    detail: Optional[str] = None
    instance: Optional[str] = None
    code: Optional[str] = None  # 业务错误码
    
    class Config:
        json_schema_extra = {
            "example": {
                "type": "about:blank",
                "title": "Price guard violated",
                "status": 422,
                "detail": "price 1499 < min margin with cost 1300",
                "code": "OZON_GUARD_PRICE_VIOLATION"
            }
        }


class EuraFlowException(Exception):
    """EuraFlow 基础异常类"""
    
    def __init__(
        self,
        status: int,
        code: str,
        title: str,
        detail: Optional[str] = None,
        **kwargs
    ):
        self.status = status
        self.code = code
        self.title = title
        self.detail = detail
        self.extra = kwargs
        super().__init__(detail or title)
    
    def to_problem_detail(self, instance: Optional[str] = None) -> ProblemDetail:
        """转换为 Problem Details 格式"""
        return ProblemDetail(
            type="about:blank",
            title=self.title,
            status=self.status,
            detail=self.detail,
            instance=instance,
            code=self.code,
            **self.extra
        )
    
    def to_response(self, request: Optional[Request] = None) -> JSONResponse:
        """转换为 JSON 响应"""
        instance = str(request.url) if request else None
        problem = self.to_problem_detail(instance)
        
        return JSONResponse(
            status_code=self.status,
            content={
                "ok": False,
                "error": problem.model_dump(exclude_none=True)
            }
        )


# 预定义错误类
class BadRequestError(EuraFlowException):
    """400 错误请求"""
    def __init__(self, code: str, detail: str):
        super().__init__(
            status=400,
            code=code,
            title="Bad Request",
            detail=detail
        )


class UnauthorizedError(EuraFlowException):
    """401 未授权"""
    def __init__(self, code: str = "UNAUTHORIZED", detail: str = "Authentication required"):
        super().__init__(
            status=401,
            code=code,
            title="Unauthorized",
            detail=detail
        )


class ForbiddenError(EuraFlowException):
    """403 禁止访问"""
    def __init__(self, code: str = "FORBIDDEN", detail: str = "Access denied"):
        super().__init__(
            status=403,
            code=code,
            title="Forbidden",
            detail=detail
        )


class NotFoundError(EuraFlowException):
    """404 未找到"""
    def __init__(self, code: str, resource: str):
        super().__init__(
            status=404,
            code=code,
            title="Not Found",
            detail=f"{resource} not found"
        )


class ConflictError(EuraFlowException):
    """409 冲突"""
    def __init__(self, code: str, detail: str):
        super().__init__(
            status=409,
            code=code,
            title="Conflict",
            detail=detail
        )


class ValidationError(EuraFlowException):
    """422 验证失败"""
    def __init__(self, code: str, detail: str):
        super().__init__(
            status=422,
            code=code,
            title="Validation Failed",
            detail=detail
        )


class RateLimitError(EuraFlowException):
    """429 限流"""
    def __init__(self, code: str = "RATE_LIMITED", retry_after: Optional[int] = None):
        super().__init__(
            status=429,
            code=code,
            title="Too Many Requests",
            detail="Rate limit exceeded",
            retry_after=retry_after
        )


class InternalServerError(EuraFlowException):
    """500 内部错误"""
    def __init__(self, code: str = "INTERNAL_ERROR", detail: str = "An internal error occurred"):
        super().__init__(
            status=500,
            code=code,
            title="Internal Server Error",
            detail=detail
        )


class ServiceUnavailableError(EuraFlowException):
    """503 服务不可用"""
    def __init__(self, code: str = "SERVICE_UNAVAILABLE", detail: str = "Service temporarily unavailable"):
        super().__init__(
            status=503,
            code=code,
            title="Service Unavailable",
            detail=detail
        )


# 错误处理装饰器
def handle_errors(logger=None):
    """错误处理装饰器"""
    def decorator(func):
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except EuraFlowException:
                raise  # 直接抛出自定义异常
            except Exception as e:
                if logger:
                    logger.error(f"Unexpected error in {func.__name__}", exc_info=True)
                raise InternalServerError(
                    code="UNEXPECTED_ERROR",
                    detail=str(e) if logger else "An unexpected error occurred"
                )
        return wrapper
    return decorator