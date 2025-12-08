"""
ARQ Worker 配置

ARQ 是一个基于 asyncio 的轻量级任务队列，用于执行高并发的异步任务。
与 Celery 混合使用：
- Celery Beat: 定时任务调度器（派发任务）
- ARQ Workers: 高并发任务执行器（实际执行）

ARQ 优势：
- 原生支持 async/await，无需 new_event_loop() 包装
- 单 Worker 内存占用低（~30-50MB vs Celery ~130MB）
- 协程并发，高吞吐量
"""

import logging
import os
from typing import Any

from arq.connections import RedisSettings

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def startup(ctx: dict[str, Any]) -> None:
    """
    Worker 启动时初始化

    在这里初始化数据库连接池等资源，所有任务共享这些资源。
    """
    logger.info("ARQ Worker starting up...")

    # 导入数据库管理器（延迟导入，避免循环依赖）
    from ef_core.database import get_db_manager

    # 初始化数据库管理器并存储到上下文
    ctx['db_manager'] = get_db_manager()

    logger.info("ARQ Worker started successfully")


async def shutdown(ctx: dict[str, Any]) -> None:
    """
    Worker 关闭时清理资源
    """
    logger.info("ARQ Worker shutting down...")

    # 清理数据库连接（如果需要）
    # db_manager 通常是单例，由应用生命周期管理

    logger.info("ARQ Worker shutdown complete")


async def on_job_start(ctx: dict[str, Any]) -> None:
    """任务开始时的钩子"""
    job_id = ctx.get('job_id', 'unknown')
    job_try = ctx.get('job_try', 1)
    logger.info(f"Job started: {job_id} (attempt {job_try})")


async def on_job_end(ctx: dict[str, Any]) -> None:
    """任务结束时的钩子"""
    job_id = ctx.get('job_id', 'unknown')
    logger.info(f"Job completed: {job_id}")


# 获取 Redis 配置
def get_redis_settings() -> RedisSettings:
    """
    获取 Redis 连接配置

    使用 database=2 与 Celery (database=0) 隔离
    """
    redis_host = os.getenv('EF__REDIS_HOST', 'localhost')
    redis_port = int(os.getenv('EF__REDIS_PORT', '6379'))
    redis_password = os.getenv('EF__REDIS_PASSWORD', None)

    return RedisSettings(
        host=redis_host,
        port=redis_port,
        password=redis_password,
        database=2,  # 与 Celery 隔离
    )


class WorkerSettings:
    """
    ARQ Worker 配置类

    ARQ 会自动发现这个类并使用其配置启动 Worker。
    启动命令：arq ef_core.tasks.arq_worker.WorkerSettings
    """

    # Redis 连接配置
    redis_settings = get_redis_settings()

    # 注册的任务函数列表（在 arq_tasks.py 中动态填充）
    functions: list = []

    # 生命周期钩子
    on_startup = startup
    on_shutdown = shutdown
    on_job_start = on_job_start
    on_job_end = on_job_end

    # Worker 配置
    max_jobs = 50               # 单 Worker 最大并发任务数
    job_timeout = 300           # 任务超时时间（5分钟）
    max_tries = 3               # 最大重试次数
    retry_delay = 10            # 重试延迟（秒）
    poll_delay = 0.5            # 轮询队列的间隔（秒）
    queue_read_limit = 100      # 一次从队列读取的最大任务数

    # 健康检查配置
    health_check_interval = 60  # 健康检查间隔（秒）
    health_check_key = 'arq:health-check'


# 动态注册任务函数
def register_arq_function(func):
    """
    注册任务函数到 ARQ Worker

    用法：
        from ef_core.tasks.arq_worker import register_arq_function

        async def my_task(ctx, arg1, arg2):
            ...

        register_arq_function(my_task)
    """
    if func not in WorkerSettings.functions:
        WorkerSettings.functions.append(func)
        logger.info(f"Registered ARQ function: {func.__name__}")


def _register_plugin_tasks():
    """
    注册所有插件的 ARQ 任务

    在模块加载时调用，自动发现并注册各插件的任务。

    注意：此函数在 ARQ Worker 启动前调用，不能依赖事件循环。
    ARQ 任务放在独立的 arq_tasks 目录（不在 tasks 目录下），
    避免导入时触发 Celery 初始化。
    """
    try:
        # 从独立的 arq_tasks 目录导入，避免触发 tasks/__init__.py 的 Celery 导入
        from plugins.ef.channels.ozon.arq_tasks import (
            sync_shop_orders,
            sync_shop_products,
            sync_shop_inventory,
            sync_shop_promotions,
            sync_shop_finance,
        )

        # 直接注册任务
        register_arq_function(sync_shop_orders)
        register_arq_function(sync_shop_products)
        register_arq_function(sync_shop_inventory)
        register_arq_function(sync_shop_promotions)
        register_arq_function(sync_shop_finance)

        logger.info("Plugin ARQ tasks registered successfully")
    except ImportError as e:
        logger.warning(f"Failed to import OZON ARQ tasks: {e}")
    except Exception as e:
        logger.error(f"Failed to register plugin ARQ tasks: {e}", exc_info=True)


def get_registered_functions() -> list:
    """获取已注册的任务函数列表"""
    return WorkerSettings.functions.copy()


# ====================================================================================
# 模块加载时自动注册任务（ARQ Worker 启动前必须完成）
# ====================================================================================
# ARQ 要求 WorkerSettings.functions 在 Worker 创建时就已填充
# 因此必须在模块级别同步注册任务，不能在 startup 异步函数中注册
_register_plugin_tasks()
