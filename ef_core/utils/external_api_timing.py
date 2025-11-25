"""
外部 API 计时工具

用于记录外部 API 调用的耗时，方便性能分析和监控。
日志输出到 logs/external_api_timing.log
"""

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional

# 延迟初始化的 logger
_external_api_logger: Optional[logging.Logger] = None


def get_external_api_logger() -> logging.Logger:
    """获取外部 API 计时日志器（延迟初始化）"""
    global _external_api_logger
    if _external_api_logger is None:
        _external_api_logger = logging.getLogger("external_api_timing")
        _external_api_logger.setLevel(logging.INFO)

        # 检查是否已有 handler
        if not _external_api_logger.handlers:
            # 获取项目根目录
            project_root = os.path.dirname(os.path.dirname(os.path.dirname(
                os.path.abspath(__file__)
            )))
            log_dir = os.path.join(project_root, "logs")
            os.makedirs(log_dir, exist_ok=True)

            handler = logging.FileHandler(
                os.path.join(log_dir, "external_api_timing.log"),
                encoding="utf-8"
            )
            handler.setFormatter(logging.Formatter(
                "%(asctime)s | %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S"
            ))
            _external_api_logger.addHandler(handler)
            _external_api_logger.propagate = False
    return _external_api_logger


def log_external_api_timing(
    service: str,
    method: str,
    endpoint: str,
    elapsed_ms: float,
    extra_info: Optional[str] = None
) -> None:
    """
    记录外部 API 调用计时

    Args:
        service: 服务名称（如 OZON, Kuajing84, Xiangjifanyi）
        method: HTTP 方法（GET, POST 等）
        endpoint: API 端点
        elapsed_ms: 耗时（毫秒）
        extra_info: 额外信息（如 shop_id, error 等）
    """
    logger = get_external_api_logger()
    msg = f"{service} | {method} {endpoint} | {elapsed_ms:.1f}ms"
    if extra_info:
        msg += f" | {extra_info}"
    logger.info(msg)


class ExternalAPITimer:
    """
    外部 API 计时器

    用法:
        timer = ExternalAPITimer("OZON", "POST", "/v3/product/list", shop_id=123)
        timer.start()
        # ... 执行 HTTP 请求 ...
        timer.stop()  # 自动记录日志

        # 或使用 with 语句
        with timer:
            # ... 执行 HTTP 请求 ...
    """

    def __init__(
        self,
        service: str,
        method: str,
        endpoint: str,
        **extra_kwargs
    ):
        self.service = service
        self.method = method
        self.endpoint = endpoint
        self.extra_kwargs = extra_kwargs
        self._start_time: Optional[float] = None
        self._elapsed_ms: Optional[float] = None

    def start(self) -> None:
        """开始计时"""
        self._start_time = time.perf_counter()

    def stop(self, error: Optional[str] = None) -> float:
        """
        停止计时并记录日志

        Args:
            error: 错误信息（可选）

        Returns:
            耗时（毫秒）
        """
        if self._start_time is None:
            raise RuntimeError("Timer not started")

        self._elapsed_ms = (time.perf_counter() - self._start_time) * 1000

        # 构建额外信息
        extra_parts = []
        for key, value in self.extra_kwargs.items():
            extra_parts.append(f"{key}={value}")
        if error:
            extra_parts.append(f"ERROR={error}")

        extra_info = " | ".join(extra_parts) if extra_parts else None

        log_external_api_timing(
            self.service,
            self.method,
            self.endpoint,
            self._elapsed_ms,
            extra_info
        )

        return self._elapsed_ms

    @property
    def elapsed_ms(self) -> Optional[float]:
        """获取耗时（毫秒），如果还未停止则返回 None"""
        return self._elapsed_ms

    def __enter__(self) -> "ExternalAPITimer":
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        error = None
        if exc_type is not None:
            error = exc_type.__name__
        self.stop(error=error)


@asynccontextmanager
async def timed_external_api(
    service: str,
    method: str,
    endpoint: str,
    **extra_kwargs
):
    """
    异步上下文管理器，用于计时外部 API 调用

    用法:
        async with timed_external_api("OZON", "POST", "/v3/product/list", shop_id=123):
            response = await client.post(url, data=data)
    """
    timer = ExternalAPITimer(service, method, endpoint, **extra_kwargs)
    timer.start()
    try:
        yield timer
    except Exception as e:
        timer.stop(error=type(e).__name__)
        raise
    else:
        timer.stop()
