"""
请求日志中间件
"""
import time
import uuid
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from ef_core.utils.logging import get_logger, LogContext


class LoggingMiddleware(BaseHTTPMiddleware):
    """请求日志中间件"""
    
    def __init__(self, app, logger=None):
        super().__init__(app)
        self.logger = logger or get_logger("middleware.logging")
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # 生成 trace_id
        trace_id = str(uuid.uuid4())
        request.state.trace_id = trace_id
        
        # 提取请求信息
        method = request.method
        url = str(request.url)
        client_ip = self._get_client_ip(request)
        user_agent = request.headers.get("user-agent", "")
        
        # 记录请求开始
        start_time = time.time()
        
        with LogContext(trace_id=trace_id):
            self.logger.info(
                f"Request started",
                method=method,
                url=url,
                client_ip=client_ip,
                user_agent=user_agent
            )
            
            # 处理请求
            try:
                response = await call_next(request)
                
                # 记录请求完成
                duration_ms = int((time.time() - start_time) * 1000)
                
                self.logger.info(
                    f"Request completed",
                    method=method,
                    url=url,
                    status_code=response.status_code,
                    latency_ms=duration_ms,
                    result="success" if response.status_code < 400 else "error"
                )
                
                # 添加 trace_id 到响应头
                response.headers["X-Trace-Id"] = trace_id
                
                return response
                
            except Exception as e:
                # 记录请求异常
                duration_ms = int((time.time() - start_time) * 1000)
                
                self.logger.error(
                    f"Request failed",
                    method=method,
                    url=url,
                    latency_ms=duration_ms,
                    result="error",
                    err=str(e)
                )
                
                raise
    
    def _get_client_ip(self, request: Request) -> str:
        """获取客户端 IP"""
        # 检查反向代理头部
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip
        
        # 使用连接 IP
        if request.client:
            return request.client.host
        
        return "unknown"