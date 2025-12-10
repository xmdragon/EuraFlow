"""
Redis 工具模块

提供全局 Redis 连接获取方法
"""
import redis.asyncio as redis
from typing import Optional

from ef_core.config import get_settings

_redis_client: Optional[redis.Redis] = None


async def get_redis() -> redis.Redis:
    """
    获取 Redis 异步客户端单例

    Returns:
        redis.Redis: Redis 异步客户端
    """
    global _redis_client

    if _redis_client is None:
        settings = get_settings()
        _redis_client = redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True
        )

    return _redis_client


async def close_redis() -> None:
    """关闭 Redis 连接"""
    global _redis_client

    if _redis_client is not None:
        await _redis_client.close()
        _redis_client = None
