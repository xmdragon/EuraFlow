"""
Redis 工具模块

提供全局 Redis 连接获取方法
"""
import redis.asyncio as redis
from typing import Optional

from ef_core.config import get_settings

_redis_client: Optional[redis.Redis] = None
_connection_pool: Optional[redis.ConnectionPool] = None


async def get_redis() -> redis.Redis:
    """
    获取 Redis 异步客户端单例（使用连接池）

    连接池配置：
    - max_connections=50: 支持 50+ 并发请求
    - 单例模式：全局共享同一个连接池

    Returns:
        redis.Redis: Redis 异步客户端
    """
    global _redis_client, _connection_pool

    if _redis_client is None:
        settings = get_settings()
        # 创建连接池（支持高并发）
        _connection_pool = redis.ConnectionPool.from_url(
            settings.redis_url,
            max_connections=50,
            encoding="utf-8",
            decode_responses=True,
        )
        _redis_client = redis.Redis(connection_pool=_connection_pool)

    return _redis_client


async def close_redis() -> None:
    """关闭 Redis 连接和连接池"""
    global _redis_client, _connection_pool

    if _redis_client is not None:
        await _redis_client.close()
        _redis_client = None

    if _connection_pool is not None:
        await _connection_pool.disconnect()
        _connection_pool = None
