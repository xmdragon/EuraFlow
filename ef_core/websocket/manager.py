"""
WebSocket通知管理器
管理所有活跃的WebSocket连接，支持按用户和店铺路由通知
"""
import asyncio
import json
from typing import Dict, Set, Any, Optional
from datetime import datetime, timezone
from fastapi import WebSocket
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)


class NotificationManager:
    """WebSocket通知管理器（单例）"""

    _instance: Optional['NotificationManager'] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        # 连接存储：user_id -> {websocket连接}
        self._connections: Dict[int, Set[WebSocket]] = {}

        # 用户订阅的店铺：user_id -> {shop_ids}
        self._user_shops: Dict[int, Set[int]] = {}

        # WebSocket到用户的反向映射：websocket -> user_id
        self._ws_to_user: Dict[WebSocket, int] = {}

        # 连接统计
        self._total_connections = 0

        self._initialized = True
        logger.info("NotificationManager initialized")

    async def connect(self, websocket: WebSocket, user_id: int, shop_ids: Optional[list[int]] = None):
        """
        注册新的WebSocket连接

        Args:
            websocket: WebSocket连接对象
            user_id: 用户ID
            shop_ids: 用户订阅的店铺ID列表
        """
        await websocket.accept()

        # 添加连接
        if user_id not in self._connections:
            self._connections[user_id] = set()
        self._connections[user_id].add(websocket)

        # 记录反向映射
        self._ws_to_user[websocket] = user_id

        # 记录用户订阅的店铺
        if shop_ids:
            if user_id not in self._user_shops:
                self._user_shops[user_id] = set()
            self._user_shops[user_id].update(shop_ids)

        self._total_connections += 1

        logger.info(
            f"WebSocket connected: user_id={user_id}, "
            f"shops={shop_ids}, "
            f"total_connections={self._total_connections}"
        )

        # 发送连接成功消息
        await self._send_to_websocket(websocket, {
            "type": "connected",
            "user_id": user_id,
            "shop_ids": list(shop_ids) if shop_ids else [],
            "timestamp": datetime.now(timezone.utc).isoformat()
        })

    async def disconnect(self, websocket: WebSocket):
        """
        注销WebSocket连接

        Args:
            websocket: 要断开的WebSocket连接
        """
        user_id = self._ws_to_user.get(websocket)

        if user_id is None:
            logger.warning("Disconnect called for unknown websocket")
            return

        # 移除连接
        if user_id in self._connections:
            self._connections[user_id].discard(websocket)
            if not self._connections[user_id]:
                del self._connections[user_id]
                # 清理用户店铺订阅
                if user_id in self._user_shops:
                    del self._user_shops[user_id]

        # 清理反向映射
        del self._ws_to_user[websocket]

        self._total_connections -= 1

        logger.info(
            f"WebSocket disconnected: user_id={user_id}, "
            f"total_connections={self._total_connections}"
        )

    async def send_to_user(self, user_id: int, message: Dict[str, Any]) -> int:
        """
        发送消息给特定用户的所有连接

        Args:
            user_id: 用户ID
            message: 消息内容

        Returns:
            成功发送的连接数
        """
        if user_id not in self._connections:
            logger.debug(f"User {user_id} has no active connections")
            return 0

        connections = self._connections[user_id].copy()
        sent_count = 0
        failed_connections = []

        for websocket in connections:
            try:
                await self._send_to_websocket(websocket, message)
                sent_count += 1
            except Exception as e:
                logger.error(f"Failed to send to user {user_id}: {e}")
                failed_connections.append(websocket)

        # 清理失败的连接
        for websocket in failed_connections:
            await self.disconnect(websocket)

        return sent_count

    async def send_to_shop_users(self, shop_id: int, message: Dict[str, Any]) -> int:
        """
        发送消息给订阅了特定店铺的所有用户

        Args:
            shop_id: 店铺ID
            message: 消息内容

        Returns:
            成功发送的连接数
        """
        sent_count = 0

        for user_id, shop_ids in self._user_shops.items():
            if shop_id in shop_ids:
                count = await self.send_to_user(user_id, message)
                sent_count += count

        logger.debug(f"Sent message to {sent_count} connections for shop {shop_id}")
        return sent_count

    async def broadcast(self, message: Dict[str, Any]) -> int:
        """
        广播消息给所有连接

        Args:
            message: 消息内容

        Returns:
            成功发送的连接数
        """
        sent_count = 0

        for user_id in list(self._connections.keys()):
            count = await self.send_to_user(user_id, message)
            sent_count += count

        logger.info(f"Broadcasted message to {sent_count} connections")
        return sent_count

    async def send_ping(self, websocket: WebSocket):
        """
        发送心跳消息

        Args:
            websocket: WebSocket连接
        """
        try:
            await self._send_to_websocket(websocket, {
                "type": "ping",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        except Exception as e:
            logger.error(f"Failed to send ping: {e}")
            await self.disconnect(websocket)

    async def _send_to_websocket(self, websocket: WebSocket, message: Dict[str, Any]):
        """
        发送消息到WebSocket（内部方法）

        Args:
            websocket: WebSocket连接
            message: 消息内容

        Raises:
            Exception: 发送失败
        """
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"WebSocket send failed: {e}")
            raise

    def get_stats(self) -> Dict[str, Any]:
        """
        获取连接统计信息

        Returns:
            统计信息字典
        """
        return {
            "total_connections": self._total_connections,
            "unique_users": len(self._connections),
            "subscribed_shops": sum(len(shops) for shops in self._user_shops.values()),
            "users_by_shop": {
                shop_id: sum(1 for shops in self._user_shops.values() if shop_id in shops)
                for shop_id in set().union(*self._user_shops.values())
            } if self._user_shops else {}
        }


# 全局单例实例
notification_manager = NotificationManager()
