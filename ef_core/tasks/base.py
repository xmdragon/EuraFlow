"""
基础任务类和装饰器
"""
import time
import asyncio
from typing import Any, Dict, Optional, Callable, Awaitable
from functools import wraps

from celery import Task
from celery.exceptions import Retry
from ef_core.utils.logger import get_logger, LogContext
from ef_core.utils.errors import EuraFlowException

logger = get_logger(__name__)


class BaseTask(Task):
    """EuraFlow 基础任务类"""

    # 自动重试配置
    # 注意：不能包含 Retry 异常，否则会导致无限递归
    # Retry 异常是 Celery 用于触发重试的特殊异常，不应被 autoretry 捕获
    autoretry_for = (Exception,)
    dont_autoretry_for = (Retry,)  # 排除 Retry 异常
    max_retries = 5
    default_retry_delay = 60
    retry_backoff = True
    retry_backoff_max = 300  # 5分钟
    retry_jitter = True
    
    def __init__(self):
        super().__init__()
        self.start_time = None
    
    def __call__(self, *args, **kwargs):
        """任务调用包装器，添加日志上下文"""
        self.start_time = time.time()
        
        # 提取日志上下文
        task_name = self.name
        plugin_name = None
        shop_id = kwargs.get("shop_id")
        
        if task_name.startswith("ef.") and "." in task_name[3:]:
            parts = task_name.split(".")
            if len(parts) >= 3:
                plugin_name = f"{parts[0]}.{parts[1]}.{parts[2]}"
        
        with LogContext(plugin=plugin_name, shop_id=shop_id):
            try:
                logger.info(f"Task starting", task=task_name, args=args, kwargs=kwargs)
                
                result = super().__call__(*args, **kwargs)
                
                duration = time.time() - self.start_time
                logger.info(f"Task completed", 
                           task=task_name, 
                           latency_ms=int(duration * 1000),
                           result="success")
                
                return result
                
            except Exception as e:
                duration = time.time() - self.start_time
                logger.error(f"Task failed",
                           task=task_name,
                           latency_ms=int(duration * 1000),
                           result="error",
                           err=str(e))
                raise
    
    def retry(self, args=None, kwargs=None, exc=None, throw=True, 
              eta=None, countdown=None, max_retries=None, **options):
        """增强的重试逻辑"""
        if exc:
            logger.warning(f"Task retrying due to error", 
                         task=self.name,
                         retry_count=self.request.retries,
                         error=str(exc))
        
        return super().retry(args, kwargs, exc, throw, eta, countdown, max_retries, **options)


def task_with_context(
    bind=True,
    base=BaseTask,
    **task_kwargs
):
    """任务装饰器，自动添加上下文和错误处理"""
    def decorator(func):
        # 处理异步函数
        if asyncio.iscoroutinefunction(func):
            @wraps(func)
            def sync_wrapper(*args, **kwargs):
                """将异步函数包装为同步函数"""
                return asyncio.run(func(*args, **kwargs))
            
            sync_wrapper.__name__ = func.__name__
            sync_wrapper.__doc__ = func.__doc__
            task_func = sync_wrapper
        else:
            task_func = func
        
        # 应用 Celery 任务装饰器
        from .celery_app import celery_app
        task_name = task_kwargs.pop("name", f"ef.core.{func.__name__}")
        return celery_app.task(
            bind=bind,
            base=base,
            name=task_name,
            **task_kwargs
        )(task_func)
    
    return decorator


def plugin_task(
    plugin_name: str,
    task_name: str,
    **task_kwargs
):
    """插件任务装饰器"""
    full_name = f"{plugin_name}.{task_name}"
    return task_with_context(name=full_name, **task_kwargs)


class TaskExecutor:
    """任务执行器 - 统一处理同步/异步任务"""
    
    @staticmethod
    async def execute_async_task(
        task_func: Callable[..., Awaitable[Any]],
        *args,
        **kwargs
    ) -> Any:
        """执行异步任务"""
        try:
            return await task_func(*args, **kwargs)
        except Exception as e:
            logger.error(f"Async task execution failed", 
                        task=task_func.__name__, 
                        exc_info=True)
            raise
    
    @staticmethod
    def execute_sync_task(
        task_func: Callable[..., Any],
        *args,
        **kwargs
    ) -> Any:
        """执行同步任务"""
        try:
            return task_func(*args, **kwargs)
        except Exception as e:
            logger.error(f"Sync task execution failed",
                        task=task_func.__name__,
                        exc_info=True)
            raise


# 常用任务装饰器
def cron_task(cron_expression: str, **kwargs):
    """定时任务装饰器"""
    return task_with_context(
        **kwargs,
        # Celery Beat 会根据 cron 表达式调度
        # 实际的 cron 注册在 TaskRegistry 中完成
    )


def retry_task(
    max_retries: int = 5,
    countdown: int = 60,
    exponential_backoff: bool = True,
    **kwargs
):
    """重试任务装饰器

    注意：默认 bind=False，避免函数签名需要 self 参数
    """
    task_options = {
        "max_retries": max_retries,
        "default_retry_delay": countdown,
        "retry_backoff": exponential_backoff,
        "retry_backoff_max": 600,  # 10分钟
        "retry_jitter": True,
        "bind": False,  # 默认不绑定，避免函数需要 self 参数
        **kwargs
    }

    return task_with_context(**task_options)