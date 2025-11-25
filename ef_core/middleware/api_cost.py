"""
API 耗时日志中间件
记录每个 API 请求的耗时信息到 logs/api_cost.log
"""
import json
import logging
import time
from pathlib import Path
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


class ApiCostMiddleware(BaseHTTPMiddleware):
    """API 耗时日志中间件

    记录格式：时间 | 方法 | 路径 | 状态码 | 耗时(ms) | 参数摘要
    """

    def __init__(self, app, log_dir: str = "logs"):
        super().__init__(app)

        # 获取项目根目录（ef_core 的上级目录）
        project_root = Path(__file__).parent.parent.parent
        self.log_dir = project_root / log_dir
        self.log_file = self.log_dir / "api_cost.log"

        # 确保日志目录存在
        self.log_dir.mkdir(parents=True, exist_ok=True)

        # 配置专用 logger
        self.logger = self._setup_logger()

        # 慢请求阈值（毫秒）
        self.slow_threshold_ms = 1000

        # 启动时输出日志路径
        import sys
        sys.stderr.write(f"[ApiCostMiddleware] Initialized! Log file: {self.log_file}\n")
        sys.stderr.flush()

    def _setup_logger(self) -> logging.Logger:
        """配置专用文件 logger"""
        logger = logging.getLogger("api_cost")
        logger.setLevel(logging.INFO)

        # 避免重复添加 handler
        if logger.handlers:
            return logger

        # 文件处理器 - 追加模式，每天轮转
        from logging.handlers import TimedRotatingFileHandler

        file_handler = TimedRotatingFileHandler(
            self.log_file,
            when="midnight",
            interval=1,
            backupCount=30,  # 保留30天
            encoding="utf-8"
        )
        file_handler.suffix = "%Y-%m-%d"

        # 简洁的日志格式
        formatter = logging.Formatter(
            "%(asctime)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        )
        file_handler.setFormatter(formatter)

        logger.addHandler(file_handler)

        # 不传播到父 logger
        logger.propagate = False

        return logger

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # DEBUG: 记录所有请求
        path = request.url.path
        import sys
        sys.stderr.write(f"[ApiCostMiddleware] Processing: {request.method} {path}\n")
        sys.stderr.flush()

        # 跳过静态资源和健康检查
        if self._should_skip(path):
            return await call_next(request)

        # 记录开始时间
        start_time = time.perf_counter()

        # 提取请求参数（不读取 body，避免干扰）
        params_summary = self._extract_query_params(request)

        # 执行请求
        try:
            response = await call_next(request)

            # 计算耗时
            duration_ms = (time.perf_counter() - start_time) * 1000

            # 记录日志
            self._log_request(
                method=request.method,
                path=path,
                status_code=response.status_code,
                duration_ms=duration_ms,
                params=params_summary
            )

            return response
        except Exception as e:
            # 异常情况也记录
            duration_ms = (time.perf_counter() - start_time) * 1000
            self._log_request(
                method=request.method,
                path=path,
                status_code=500,
                duration_ms=duration_ms,
                params=params_summary
            )
            raise

    def _should_skip(self, path: str) -> bool:
        """判断是否跳过记录"""
        skip_prefixes = (
            "/healthz",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/favicon.ico",
            "/static/",
            "/assets/",
        )
        return path.startswith(skip_prefixes)

    def _extract_query_params(self, request: Request) -> str:
        """提取查询参数摘要（不读取 body）"""
        params = {}

        # 查询参数
        if request.query_params:
            query_dict = dict(request.query_params)
            # 截断过长的值
            for key, value in query_dict.items():
                if isinstance(value, str) and len(value) > 100:
                    query_dict[key] = value[:100] + "..."
            params["q"] = query_dict

        # 转换为紧凑字符串
        if not params:
            return "-"

        return json.dumps(params, ensure_ascii=False, separators=(",", ":"))

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

        # 格式: 方法 | 路径 | 状态码 | 耗时 | 参数
        log_message = (
            f"{method:6s} | {path:60s} | {status_code:3d} | "
            f"{duration_ms:8.2f}ms{slow_marker} | {params}"
        )

        # 直接写文件作为备用方案
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write(f"{timestamp} | {log_message}\n")

        self.logger.info(log_message)
