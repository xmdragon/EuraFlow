"""
指标收集中间件
"""
import time
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

try:
    from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
    PROMETHEUS_AVAILABLE = True
except ImportError:
    PROMETHEUS_AVAILABLE = False

from ef_core.utils.logging import get_logger


class MetricsMiddleware(BaseHTTPMiddleware):
    """指标收集中间件"""
    
    def __init__(self, app, logger=None):
        super().__init__(app)
        self.logger = logger or get_logger("middleware.metrics")
        
        if PROMETHEUS_AVAILABLE:
            # 请求计数器
            self.request_count = Counter(
                'ef_http_requests_total',
                'Total HTTP requests',
                ['method', 'endpoint', 'status_code']
            )
            
            # 请求延迟直方图
            self.request_duration = Histogram(
                'ef_http_request_duration_seconds',
                'HTTP request duration',
                ['method', 'endpoint']
            )
            
            # 请求大小直方图
            self.request_size = Histogram(
                'ef_http_request_size_bytes',
                'HTTP request size',
                ['method', 'endpoint']
            )
            
            # 响应大小直方图
            self.response_size = Histogram(
                'ef_http_response_size_bytes',
                'HTTP response size',
                ['method', 'endpoint', 'status_code']
            )
        else:
            self.logger.warning("Prometheus client not available, metrics disabled")
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not PROMETHEUS_AVAILABLE:
            return await call_next(request)
        
        # 提取请求信息
        method = request.method
        endpoint = self._get_endpoint_pattern(request)
        
        # 记录请求大小
        request_size = self._get_request_size(request)
        self.request_size.labels(method=method, endpoint=endpoint).observe(request_size)
        
        # 记录请求开始时间
        start_time = time.time()
        
        try:
            # 处理请求
            response = await call_next(request)
            
            # 记录指标
            duration = time.time() - start_time
            status_code = str(response.status_code)
            
            self.request_count.labels(
                method=method,
                endpoint=endpoint,
                status_code=status_code
            ).inc()
            
            self.request_duration.labels(
                method=method,
                endpoint=endpoint
            ).observe(duration)
            
            # 记录响应大小
            response_size = self._get_response_size(response)
            self.response_size.labels(
                method=method,
                endpoint=endpoint,
                status_code=status_code
            ).observe(response_size)
            
            return response
            
        except Exception as e:
            # 记录错误指标
            self.request_count.labels(
                method=method,
                endpoint=endpoint,
                status_code="500"
            ).inc()
            
            duration = time.time() - start_time
            self.request_duration.labels(
                method=method,
                endpoint=endpoint
            ).observe(duration)
            
            raise
    
    def _get_endpoint_pattern(self, request: Request) -> str:
        """获取端点模式（用于聚合指标）"""
        path = request.url.path
        
        # 替换 ID 参数为占位符
        import re
        
        # 替换数字 ID
        path = re.sub(r'/\d+', '/{id}', path)
        
        # 替换 UUID
        path = re.sub(r'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '/{uuid}', path)
        
        # 替换其他常见参数模式
        path = re.sub(r'/[A-Za-z0-9_-]{20,}', '/{token}', path)
        
        return path or "/"
    
    def _get_request_size(self, request: Request) -> float:
        """获取请求大小（字节）"""
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                return float(content_length)
            except (ValueError, TypeError):
                pass
        
        # 估算大小
        size = 0
        
        # 请求行大小
        size += len(f"{request.method} {request.url.path} HTTP/1.1")
        
        # 头部大小
        for name, value in request.headers.items():
            size += len(f"{name}: {value}\r\n")
        
        return float(size)
    
    def _get_response_size(self, response: Response) -> float:
        """获取响应大小（字节）"""
        content_length = response.headers.get("content-length")
        if content_length:
            try:
                return float(content_length)
            except (ValueError, TypeError):
                pass
        
        # 估算大小（不太准确，但比没有好）
        size = 0
        
        # 状态行大小
        size += len(f"HTTP/1.1 {response.status_code}")
        
        # 头部大小
        for name, value in response.headers.items():
            size += len(f"{name}: {value}\r\n")
        
        # Body 大小估算（如果是 JSON）
        if hasattr(response, 'body') and response.body:
            if isinstance(response.body, bytes):
                size += len(response.body)
            elif isinstance(response.body, str):
                size += len(response.body.encode('utf-8'))
        
        return float(size)


def get_metrics_handler():
    """获取指标端点处理器"""
    async def metrics_endpoint(request: Request):
        if not PROMETHEUS_AVAILABLE:
            return Response("Prometheus client not available", status_code=503)
        
        metrics_data = generate_latest()
        return Response(
            metrics_data,
            media_type=CONTENT_TYPE_LATEST
        )
    
    return metrics_endpoint