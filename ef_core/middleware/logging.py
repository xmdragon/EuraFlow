"""
请求日志中间件

记录所有入站 API 请求的完整信息：
- 请求地址、方法、参数
- 响应状态码、响应体（截断）
- 耗时统计
"""
import json
import time
import uuid
from typing import Callable, Optional

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import StreamingResponse

from ef_core.utils.logger import get_logger, LogContext


# 不记录详细日志的路径（健康检查、静态资源等）
SKIP_DETAIL_PATHS = {
    "/healthz",
    "/metrics",
    "/favicon.ico",
}

# 敏感字段（不记录到日志）
SENSITIVE_FIELDS = {"password", "api_key", "apikey", "secret", "token", "authorization"}

# 最大记录的请求/响应体大小（字节）
MAX_BODY_LOG_SIZE = 10000


class LoggingMiddleware(BaseHTTPMiddleware):
    """请求日志中间件 - 记录完整的请求和响应信息"""

    def __init__(self, app, logger=None):
        super().__init__(app)
        self.logger = logger or get_logger("middleware.logging")

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # 生成 trace_id
        trace_id = str(uuid.uuid4())
        request.state.trace_id = trace_id

        # 提取请求信息
        method = request.method
        path = request.url.path
        url = str(request.url)
        client_ip = self._get_client_ip(request)
        user_agent = request.headers.get("user-agent", "")

        # 判断是否需要记录详细日志
        skip_detail = path in SKIP_DETAIL_PATHS

        # 记录请求开始
        start_time = time.time()

        # 注意：不能在 BaseHTTPMiddleware 中预先读取请求体
        # 因为这会导致后续路由处理器无法读取请求体
        # 如果需要记录请求体，应使用纯 ASGI 中间件或在请求处理后记录
        request_body = None

        # 读取查询参数
        query_params = dict(request.query_params) if request.query_params else None

        with LogContext(trace_id=trace_id):
            # 记录入站请求
            log_data = {
                "direction": "inbound",
                "method": method,
                "path": path,
                "url": url,
                "client_ip": client_ip,
                "user_agent": user_agent[:200] if user_agent else None,
            }

            if query_params and not skip_detail:
                log_data["query_params"] = self._mask_sensitive(query_params)

            self.logger.info("API request", **log_data)

            # 处理请求
            try:
                response = await call_next(request)

                # 记录请求完成
                duration_ms = int((time.time() - start_time) * 1000)

                # 读取响应体（仅对非流式响应）
                response_body = None
                if not skip_detail and not isinstance(response, StreamingResponse):
                    response_body = await self._read_response_body(response)

                # 记录响应
                resp_log_data = {
                    "direction": "inbound",
                    "method": method,
                    "path": path,
                    "status_code": response.status_code,
                    "latency_ms": duration_ms,
                    "result": "success" if response.status_code < 400 else "error",
                }

                if response_body and not skip_detail:
                    resp_log_data["response_body"] = self._truncate_body(response_body)

                if response.status_code >= 400:
                    self.logger.warning("API response error", **resp_log_data)
                else:
                    self.logger.info("API response", **resp_log_data)

                # 添加 trace_id 到响应头
                response.headers["X-Trace-Id"] = trace_id

                return response

            except Exception as e:
                # 记录请求异常
                duration_ms = int((time.time() - start_time) * 1000)

                self.logger.error(
                    "API request failed",
                    direction="inbound",
                    method=method,
                    path=path,
                    latency_ms=duration_ms,
                    result="error",
                    err=str(e),
                    exc_info=True
                )

                raise

    async def _read_response_body(self, response: Response) -> Optional[str]:
        """读取响应体"""
        try:
            # 获取响应体
            body = b""
            async for chunk in response.body_iterator:
                body += chunk

            if not body:
                return None

            # 重新创建响应体迭代器
            async def body_iterator():
                yield body

            response.body_iterator = body_iterator()

            # 尝试解析为 JSON
            try:
                json_body = json.loads(body)
                # 响应体不需要脱敏（不包含敏感输入）
                return json.dumps(json_body, ensure_ascii=False)
            except json.JSONDecodeError:
                return body.decode("utf-8", errors="replace")
        except Exception:
            return None

    def _mask_sensitive(self, data) -> dict:
        """脱敏敏感字段"""
        if isinstance(data, dict):
            masked = {}
            for key, value in data.items():
                if key.lower() in SENSITIVE_FIELDS:
                    masked[key] = "***MASKED***"
                elif isinstance(value, dict):
                    masked[key] = self._mask_sensitive(value)
                elif isinstance(value, list):
                    masked[key] = [self._mask_sensitive(item) if isinstance(item, dict) else item for item in value]
                else:
                    masked[key] = value
            return masked
        return data

    def _truncate_body(self, body: str) -> str:
        """截断过长的请求/响应体"""
        if len(body) > MAX_BODY_LOG_SIZE:
            return body[:MAX_BODY_LOG_SIZE] + f"... [truncated, total {len(body)} bytes]"
        return body

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