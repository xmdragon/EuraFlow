"""
EuraFlow 事件总线
基于 Redis Streams 实现持久化消息队列
"""
import json
import uuid
import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional, Callable, Awaitable
from contextlib import asynccontextmanager

import redis.asyncio as redis
from ef_core.config import get_settings
from ef_core.utils.logger import get_logger
from ef_core.utils.errors import EuraFlowException

logger = get_logger(__name__)


class EventPayload:
    """事件载荷"""
    
    def __init__(
        self,
        event_id: Optional[str] = None,
        topic: str = "",
        shop_id: Optional[int] = None,
        payload: Optional[Dict[str, Any]] = None,
        timestamp: Optional[str] = None
    ):
        self.event_id = event_id or str(uuid.uuid4())
        self.topic = topic
        self.shop_id = shop_id
        self.payload = payload or {}
        self.timestamp = timestamp or datetime.utcnow().isoformat() + "Z"
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "event_id": self.event_id,
            "ts": self.timestamp,
            "topic": self.topic,
            "shop_id": self.shop_id,
            "payload": self.payload
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EventPayload":
        """从字典创建"""
        return cls(
            event_id=data.get("event_id"),
            topic=data.get("topic", ""),
            shop_id=data.get("shop_id"),
            payload=data.get("payload", {}),
            timestamp=data.get("ts")
        )


class EventBus:
    """事件总线实现"""
    
    def __init__(self):
        self.settings = get_settings()
        self.redis_client: Optional[redis.Redis] = None
        self.subscriptions: Dict[str, List[Callable]] = {}
        self._consumer_tasks: List[asyncio.Task] = []
        self._running = False
    
    @asynccontextmanager
    async def _get_redis(self):
        """获取 Redis 连接"""
        if not self.redis_client:
            self.redis_client = redis.from_url(
                self.settings.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
        try:
            yield self.redis_client
        except Exception as e:
            logger.error("Redis operation failed", exc_info=True)
            raise
    
    async def initialize(self) -> None:
        """初始化事件总线"""
        logger.info("Initializing event bus")
        
        # 测试 Redis 连接
        async with self._get_redis() as r:
            await r.ping()
        
        self._running = True
        logger.info("Event bus initialized")
    
    async def shutdown(self) -> None:
        """关闭事件总线"""
        logger.info("Shutting down event bus")
        
        self._running = False
        
        # 取消所有消费者任务
        for task in self._consumer_tasks:
            task.cancel()
        
        if self._consumer_tasks:
            await asyncio.gather(*self._consumer_tasks, return_exceptions=True)
        
        # 关闭 Redis 连接
        if self.redis_client:
            await self.redis_client.close()
        
        logger.info("Event bus shutdown complete")
    
    def _get_stream_name(self, topic: str) -> str:
        """获取 Redis Stream 名称"""
        return f"ef:events:{topic}"
    
    def _get_consumer_group(self, topic: str) -> str:
        """获取消费组名称"""
        return f"ef:group:{topic}"
    
    async def publish(
        self,
        topic: str,
        payload: Dict[str, Any],
        key: Optional[str] = None
    ) -> str:
        """发布事件到指定主题"""
        if not topic.startswith("ef."):
            raise ValueError(f"Invalid topic format: {topic}")
        
        event = EventPayload(
            topic=topic,
            shop_id=payload.get("shop_id"),
            payload=payload
        )
        
        stream_name = self._get_stream_name(topic)
        
        # 序列化事件数据
        event_data = {
            "data": json.dumps(event.to_dict())
        }
        
        # 如果提供了 key，用于分区
        if key:
            event_data["key"] = key
        
        # 发布到 Redis Stream
        async with self._get_redis() as r:
            message_id = await r.xadd(stream_name, event_data)
        
        logger.debug(f"Published event to {topic}", 
                    event_id=event.event_id,
                    message_id=message_id)
        
        # 同时触发内存中的订阅者（低延迟）
        await self._trigger_handlers(topic, event)
        
        return event.event_id
    
    async def subscribe(
        self,
        topic: str,
        handler: Callable[[Dict[str, Any]], Awaitable[None]]
    ) -> None:
        """订阅事件主题"""
        if not topic.startswith("ef."):
            raise ValueError(f"Invalid topic format: {topic}")
        
        # 添加到内存订阅列表
        if topic not in self.subscriptions:
            self.subscriptions[topic] = []
        self.subscriptions[topic].append(handler)
        
        # 创建消费组（如果不存在）
        stream_name = self._get_stream_name(topic)
        group_name = self._get_consumer_group(topic)
        
        async with self._get_redis() as r:
            try:
                await r.xgroup_create(stream_name, group_name, id="0", mkstream=True)
                logger.info(f"Created consumer group {group_name} for {stream_name}")
            except redis.ResponseError as e:
                if "BUSYGROUP" not in str(e):
                    raise
        
        # 启动消费者任务
        consumer_task = asyncio.create_task(
            self._consume_stream(topic, handler)
        )
        self._consumer_tasks.append(consumer_task)
        
        logger.info(f"Subscribed to topic {topic}")
    
    async def _consume_stream(
        self,
        topic: str,
        handler: Callable[[Dict[str, Any]], Awaitable[None]]
    ) -> None:
        """消费 Redis Stream"""
        stream_name = self._get_stream_name(topic)
        group_name = self._get_consumer_group(topic)
        consumer_name = f"{group_name}:{uuid.uuid4().hex[:8]}"
        
        logger.info(f"Starting consumer {consumer_name} for {topic}")
        
        while self._running:
            try:
                async with self._get_redis() as r:
                    # 读取消息
                    messages = await r.xreadgroup(
                        group_name,
                        consumer_name,
                        {stream_name: ">"},
                        count=10,
                        block=1000  # 1秒超时
                    )
                    
                    if not messages:
                        continue
                    
                    for stream, stream_messages in messages:
                        for message_id, data in stream_messages:
                            try:
                                # 解析事件数据
                                event_json = data.get("data", "{}")
                                event_dict = json.loads(event_json)
                                event = EventPayload.from_dict(event_dict)
                                
                                # 调用处理器
                                await handler(event.payload)
                                
                                # 确认消息
                                await r.xack(stream_name, group_name, message_id)
                                
                                logger.debug(f"Processed message {message_id} from {topic}")
                                
                            except Exception as e:
                                logger.error(f"Error processing message {message_id}",
                                           exc_info=True)
                                # TODO: 实现重试和死信队列逻辑
                                
            except asyncio.CancelledError:
                logger.info(f"Consumer {consumer_name} cancelled")
                break
            except Exception as e:
                logger.error(f"Consumer {consumer_name} error", exc_info=True)
                await asyncio.sleep(5)  # 错误后等待重试
    
    async def _trigger_handlers(
        self,
        topic: str,
        event: EventPayload
    ) -> None:
        """触发内存中的事件处理器"""
        handlers = self.subscriptions.get(topic, [])
        
        for handler in handlers:
            try:
                await handler(event.payload)
            except Exception as e:
                logger.error(f"Handler error for topic {topic}",
                           handler=handler.__name__,
                           exc_info=True)
    
    async def get_pending_messages(
        self,
        topic: str,
        group: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """获取待处理的消息"""
        stream_name = self._get_stream_name(topic)
        group_name = group or self._get_consumer_group(topic)
        
        async with self._get_redis() as r:
            # 获取待处理消息信息
            pending = await r.xpending(stream_name, group_name)
            
            # redis-py 4.x 返回字典结构
            if not pending or (isinstance(pending, dict) and pending.get("pending", 0) == 0) or (isinstance(pending, list) and pending[0] == 0):
                return []
            
            # 获取详细的待处理消息
            messages = await r.xpending_range(
                stream_name,
                group_name,
                min="-",
                max="+",
                count=100
            )
            
            result = []
            for msg in messages:
                result.append({
                    "message_id": msg["message_id"],
                    "consumer": msg["consumer"],
                    "idle_time_ms": msg["time_since_delivered"],
                    "delivery_count": msg["times_delivered"]
                })
            
            return result
    
    async def retry_message(
        self,
        topic: str,
        message_id: str,
        group: Optional[str] = None
    ) -> bool:
        """重试指定消息"""
        stream_name = self._get_stream_name(topic)
        group_name = group or self._get_consumer_group(topic)
        
        async with self._get_redis() as r:
            # 重新分配消息给消费者
            claimed = await r.xclaim(
                stream_name,
                group_name,
                "retry_consumer",
                min_idle_time=0,
                message_ids=[message_id]
            )
            
            return len(claimed) > 0


# 全局事件总线实例
_event_bus: Optional[EventBus] = None


def get_event_bus() -> EventBus:
    """获取事件总线单例"""
    global _event_bus
    if _event_bus is None:
        _event_bus = EventBus()
    return _event_bus