"""
服务Handler全局注册表

管理所有插件注册的后台服务Handler
"""
import logging
from typing import Callable, Optional, Dict, Any, List
from threading import Lock


logger = logging.getLogger(__name__)


class ServiceHandlerRegistry:
    """服务Handler全局注册表（线程安全）"""

    def __init__(self):
        """初始化注册表"""
        self._handlers: Dict[str, Callable] = {}
        self._metadata: Dict[str, Dict[str, Any]] = {}
        self._lock = Lock()

    def register(
        self,
        service_key: str,
        handler: Callable,
        name: str,
        description: str,
        plugin: str,
        config_schema: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        注册服务Handler

        Args:
            service_key: 服务唯一标识
            handler: 异步处理函数
            name: 服务显示名称
            description: 服务功能说明
            plugin: 所属插件标识
            config_schema: 配置参数Schema（JSON Schema格式）

        Raises:
            ValueError: 如果service_key已存在
        """
        with self._lock:
            if service_key in self._handlers:
                logger.warning(f"Service handler already registered: {service_key}, overwriting")

            self._handlers[service_key] = handler
            self._metadata[service_key] = {
                "service_key": service_key,
                "name": name,
                "description": description,
                "plugin": plugin,
                "config_schema": config_schema or {}
            }

            logger.info(f"Registered service handler: {service_key} (plugin={plugin})")

    def unregister(self, service_key: str) -> None:
        """
        取消注册服务Handler

        Args:
            service_key: 服务唯一标识
        """
        with self._lock:
            if service_key in self._handlers:
                del self._handlers[service_key]
                del self._metadata[service_key]
                logger.info(f"Unregistered service handler: {service_key}")
            else:
                logger.warning(f"Service handler not found: {service_key}")

    def get_handler(self, service_key: str) -> Optional[Callable]:
        """
        获取Handler

        Args:
            service_key: 服务唯一标识

        Returns:
            Handler函数，如果不存在则返回None
        """
        return self._handlers.get(service_key)

    def get_metadata(self, service_key: str) -> Optional[Dict[str, Any]]:
        """
        获取Handler元数据

        Args:
            service_key: 服务唯一标识

        Returns:
            元数据字典，如果不存在则返回None
        """
        return self._metadata.get(service_key)

    def list_handlers(self) -> List[Dict[str, Any]]:
        """
        列出所有已注册的Handler

        Returns:
            元数据列表，按service_key排序
        """
        with self._lock:
            return sorted(
                list(self._metadata.values()),
                key=lambda x: x["service_key"]
            )

    def exists(self, service_key: str) -> bool:
        """
        检查Handler是否存在

        Args:
            service_key: 服务唯一标识

        Returns:
            是否存在
        """
        return service_key in self._handlers

    def count(self) -> int:
        """
        获取已注册Handler数量

        Returns:
            数量
        """
        return len(self._handlers)


# 全局单例
_registry_instance: Optional[ServiceHandlerRegistry] = None
_registry_lock = Lock()


def get_registry() -> ServiceHandlerRegistry:
    """
    获取全局注册表实例（线程安全）

    Returns:
        全局注册表实例
    """
    global _registry_instance

    if _registry_instance is None:
        with _registry_lock:
            if _registry_instance is None:
                _registry_instance = ServiceHandlerRegistry()
                logger.info("Service handler registry initialized")

    return _registry_instance
