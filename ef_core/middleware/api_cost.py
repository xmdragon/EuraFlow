"""
API 耗时日志中间件
记录每个 API 请求的耗时信息到 logs/api_cost.log

使用原生 ASGI 中间件，避免 BaseHTTPMiddleware 的问题
"""
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Any

from starlette.types import ASGIApp, Receive, Send, Scope, Message


class ApiCostMiddleware:
    """API 耗时日志中间件（原生 ASGI 实现）

    记录格式：时间 | 方法 | 路径 | 状态码 | 耗时(ms) | 参数摘要
    """

    def __init__(self, app: ASGIApp, log_dir: str = "logs", **kwargs):
        self.app = app

        # 获取项目根目录（ef_core 的上级目录）
        project_root = Path(__file__).parent.parent.parent
        self.log_dir = project_root / log_dir
        self.log_file = self.log_dir / "api_cost.log"

        # 确保日志目录存在
        self.log_dir.mkdir(parents=True, exist_ok=True)

        # 创建空日志文件（确保文件存在）
        if not self.log_file.exists():
            self.log_file.touch()

        # 慢请求阈值（毫秒）
        self.slow_threshold_ms = 1000

        # 跳过的路径前缀
        self.skip_prefixes = (
            "/healthz",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/favicon.ico",
            "/static/",
            "/assets/",
        )

        import sys
        sys.stderr.write(f"[ApiCostMiddleware] Initialized! Log: {self.log_file}\n")
        sys.stderr.flush()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # 只处理 HTTP 请求
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope["path"]

        # 跳过静态资源和健康检查
        if path.startswith(self.skip_prefixes):
            await self.app(scope, receive, send)
            return

        # 记录开始时间
        start_time = time.perf_counter()
        method = scope["method"]
        query_string = scope.get("query_string", b"").decode("utf-8")

        # 存储状态码
        status_code = 0

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            # 计算耗时
            duration_ms = (time.perf_counter() - start_time) * 1000

            # 提取查询参数
            params = f"?{query_string}" if query_string else "-"

            # 记录日志
            self._log_request(
                method=method,
                path=path,
                status_code=status_code,
                duration_ms=duration_ms,
                params=params
            )

    def _log_request(
        self,
        method: str,
        path: str,
        status_code: int,
        duration_ms: float,
        params: str
    ):
        """记录请求日志"""
        # 标记慢请求
        slow_marker = " [SLOW]" if duration_ms >= self.slow_threshold_ms else ""

        # 格式: 时间 | 方法 | 路径 | 状态码 | 耗时 | 参数
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_message = (
            f"{timestamp} | {method:6s} | {path:60s} | {status_code:3d} | "
            f"{duration_ms:8.2f}ms{slow_marker} | {params}"
        )

        # 直接写文件
        try:
            with open(self.log_file, "a", encoding="utf-8") as f:
                f.write(f"{log_message}\n")
        except Exception:
            pass  # 忽略写入错误，不影响请求处理
