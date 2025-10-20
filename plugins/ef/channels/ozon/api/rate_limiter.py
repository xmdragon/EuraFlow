"""
限流器实现
使用令牌桶算法控制 API 请求频率

性能优化：
- 使用成熟的 aiolimiter 库，避免持锁睡眠的反模式
- 支持高并发场景，无锁竞争导致的串行化问题
"""
import asyncio
import time
from typing import Dict, Optional
from collections import defaultdict
from aiolimiter import AsyncLimiter


class TokenBucket:
    """令牌桶实现（基于 aiolimiter.AsyncLimiter）"""

    def __init__(self, rate: float, capacity: Optional[float] = None):
        """
        初始化令牌桶

        Args:
            rate: 每秒生成的令牌数
            capacity: 桶容量（默认等于rate）
        """
        self.rate = rate
        self.capacity = capacity or rate
        # 使用 aiolimiter 的 AsyncLimiter
        # max_rate: 最大令牌数, time_period: 时间周期（秒）
        self._limiter = AsyncLimiter(max_rate=rate, time_period=1.0)

    async def acquire(self, tokens: int = 1) -> float:
        """
        获取令牌（无持锁睡眠，支持高并发）

        Args:
            tokens: 需要的令牌数

        Returns:
            等待时间（秒）- 兼容原接口，始终返回 0
        """
        # aiolimiter 内部正确处理令牌获取和等待
        # 不会出现持锁睡眠的问题
        await self._limiter.acquire(tokens)
        return 0  # aiolimiter 返回值为 None，这里返回 0 保持兼容性


class RateLimiter:
    """
    多资源限流器
    为不同的 API 资源设置不同的限流策略
    """
    
    def __init__(self, rate_limit: Dict[str, float]):
        """
        初始化限流器
        
        Args:
            rate_limit: 资源类型到请求速率的映射
                例如: {"products": 10, "orders": 5}
        """
        self.buckets = {
            resource: TokenBucket(rate)
            for resource, rate in rate_limit.items()
        }
        
        # 默认桶
        if "default" not in self.buckets:
            self.buckets["default"] = TokenBucket(10)
    
    async def acquire(self, resource_type: str = "default", tokens: int = 1):
        """
        获取指定资源的令牌
        
        Args:
            resource_type: 资源类型
            tokens: 需要的令牌数
        """
        bucket = self.buckets.get(resource_type, self.buckets["default"])
        wait_time = await bucket.acquire(tokens)
        
        if wait_time > 0:
            import logging
            logging.getLogger(__name__).debug(
                f"Rate limit: waited {wait_time:.2f}s for {resource_type}"
            )
        
        return wait_time
    
    def get_available_tokens(self, resource_type: str = "default") -> float:
        """获取指定资源的可用令牌数"""
        bucket = self.buckets.get(resource_type, self.buckets["default"])
        
        now = time.monotonic()
        elapsed = now - bucket.last_update
        
        return min(
            bucket.capacity,
            bucket.tokens + elapsed * bucket.rate
        )


class AdaptiveRateLimiter(RateLimiter):
    """
    自适应限流器
    根据 API 响应动态调整限流策略
    """
    
    def __init__(self, initial_rates: Dict[str, float]):
        super().__init__(initial_rates)
        self.adjustment_factor = 0.8  # 调整系数
        self.error_counts = defaultdict(int)
        self.success_counts = defaultdict(int)
        self.last_adjustment = defaultdict(float)
        self.min_rate = 1.0  # 最小速率
        self.max_rate = 100.0  # 最大速率
    
    def record_success(self, resource_type: str):
        """记录成功请求"""
        self.success_counts[resource_type] += 1
        self._maybe_adjust(resource_type)
    
    def record_error(self, resource_type: str, is_rate_limit: bool = False):
        """记录失败请求"""
        self.error_counts[resource_type] += 1
        
        if is_rate_limit:
            # 如果是限流错误，立即降低速率
            self._decrease_rate(resource_type)
        else:
            self._maybe_adjust(resource_type)
    
    def _maybe_adjust(self, resource_type: str):
        """根据成功/失败率调整限流"""
        now = time.monotonic()
        
        # 每60秒调整一次
        if now - self.last_adjustment[resource_type] < 60:
            return
        
        total = self.success_counts[resource_type] + self.error_counts[resource_type]
        if total < 10:  # 样本太少，不调整
            return
        
        success_rate = self.success_counts[resource_type] / total
        
        if success_rate > 0.95:
            # 成功率高，尝试提高速率
            self._increase_rate(resource_type)
        elif success_rate < 0.8:
            # 成功率低，降低速率
            self._decrease_rate(resource_type)
        
        # 重置计数器
        self.success_counts[resource_type] = 0
        self.error_counts[resource_type] = 0
        self.last_adjustment[resource_type] = now
    
    def _increase_rate(self, resource_type: str):
        """提高速率"""
        if resource_type in self.buckets:
            old_rate = self.buckets[resource_type].rate
            new_rate = min(self.max_rate, old_rate * 1.2)

            # 创建新的 TokenBucket，容量等于速率
            self.buckets[resource_type] = TokenBucket(new_rate, capacity=new_rate)

            import logging
            logging.getLogger(__name__).info(
                f"Rate limit increased for {resource_type}: {old_rate} -> {new_rate}"
            )

    def _decrease_rate(self, resource_type: str):
        """降低速率"""
        if resource_type in self.buckets:
            old_rate = self.buckets[resource_type].rate
            new_rate = max(self.min_rate, old_rate * self.adjustment_factor)

            # 创建新的 TokenBucket，容量等于速率
            self.buckets[resource_type] = TokenBucket(new_rate, capacity=new_rate)

            import logging
            logging.getLogger(__name__).warning(
                f"Rate limit decreased for {resource_type}: {old_rate} -> {new_rate}"
            )