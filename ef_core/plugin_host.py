"""
EuraFlow 插件宿主系统
- 启动时静态扫描和加载插件
- 通过 Feature Flag 控制启用/禁用
- 依赖注入和服务隔离
"""
import json
import importlib
import inspect
from pathlib import Path
from typing import Dict, Any, List, Optional, Protocol, Callable, Awaitable
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError
from ef_core.config import get_settings
from ef_core.utils.logging import get_logger
from ef_core.utils.errors import EuraFlowException, ValidationError as EFValidationError

logger = get_logger(__name__)


class PluginMetadata(BaseModel):
    """插件元数据模型"""
    name: str
    version: str
    enabled: bool = True
    capabilities: List[str] = []
    required_services: List[str] = []
    config_schema: Optional[Dict[str, Any]] = None
    
    class Config:
        extra = "allow"  # 允许额外字段


@dataclass
class LoadedPlugin:
    """已加载的插件信息"""
    metadata: PluginMetadata
    module: Any
    config: Dict[str, Any]
    hooks: List[Callable]
    tasks: List[Callable]


class HookAPI(Protocol):
    """插件 Hook 接口协议"""
    
    async def register_cron(
        self, 
        name: str, 
        cron: str, 
        task: Callable[..., Awaitable]
    ) -> None:
        """注册定时任务"""
        ...
    
    async def publish_event(
        self, 
        topic: str, 
        payload: Dict[str, Any], 
        key: Optional[str] = None
    ) -> None:
        """发布事件"""
        ...
    
    async def consume(
        self, 
        topic: str, 
        handler: Callable[[Dict[str, Any]], Awaitable]
    ) -> None:
        """订阅事件"""
        ...
    
    def get_service(self, name: str) -> Any:
        """获取服务实例"""
        ...


class PluginHookAPI:
    """插件 Hook API 实现"""
    
    def __init__(self, plugin_name: str, plugin_host: "PluginHost"):
        self.plugin_name = plugin_name
        self.plugin_host = plugin_host
        self._registered_tasks = []
        self._event_handlers = []
    
    async def register_cron(
        self, 
        name: str, 
        cron: str, 
        task: Callable[..., Awaitable]
    ) -> None:
        """注册定时任务"""
        if not name.startswith("ef."):
            raise EFValidationError(
                code="INVALID_TASK_NAME",
                detail=f"Task name must start with 'ef.': {name}"
            )
        
        logger.info(f"Plugin {self.plugin_name} registering cron task",
                   task_name=name, cron=cron)
        
        self._registered_tasks.append({
            "name": name,
            "cron": cron,
            "task": task,
            "plugin": self.plugin_name
        })
        
        # 实际注册到 Celery 的逻辑将在 tasks 模块中实现
        await self.plugin_host.task_registry.register_cron(name, cron, task)
    
    async def publish_event(
        self, 
        topic: str, 
        payload: Dict[str, Any], 
        key: Optional[str] = None
    ) -> None:
        """发布事件"""
        if not topic.startswith("ef."):
            raise EFValidationError(
                code="INVALID_TOPIC",
                detail=f"Event topic must start with 'ef.': {topic}"
            )
        
        logger.debug(f"Plugin {self.plugin_name} publishing event",
                    topic=topic, key=key)
        
        await self.plugin_host.event_bus.publish(topic, payload, key)
    
    async def consume(
        self, 
        topic: str, 
        handler: Callable[[Dict[str, Any]], Awaitable]
    ) -> None:
        """订阅事件"""
        if not topic.startswith("ef."):
            raise EFValidationError(
                code="INVALID_TOPIC",
                detail=f"Event topic must start with 'ef.': {topic}"
            )
        
        logger.info(f"Plugin {self.plugin_name} subscribing to topic",
                   topic=topic)
        
        self._event_handlers.append({
            "topic": topic,
            "handler": handler,
            "plugin": self.plugin_name
        })
        
        await self.plugin_host.event_bus.subscribe(topic, handler)
    
    def get_service(self, name: str) -> Any:
        """获取服务实例"""
        # 检查插件是否有权限访问该服务
        plugin = self.plugin_host.plugins.get(self.plugin_name)
        if plugin and name not in plugin.metadata.required_services:
            raise EFValidationError(
                code="SERVICE_ACCESS_DENIED",
                detail=f"Plugin {self.plugin_name} not authorized to access service {name}"
            )
        
        service = self.plugin_host.services.get(name)
        if not service:
            raise EFValidationError(
                code="SERVICE_NOT_FOUND",
                detail=f"Service {name} not found"
            )
        
        return service


class PluginHost:
    """插件宿主管理器"""
    
    def __init__(self):
        self.settings = get_settings()
        self.plugins: Dict[str, LoadedPlugin] = {}
        self.services: Dict[str, Any] = {}
        self.event_bus = None  # 将在 event_bus 模块中注入
        self.task_registry = None  # 将在 tasks 模块中注入
        self._feature_flags: Dict[str, bool] = {}
    
    def register_service(self, name: str, service: Any) -> None:
        """注册核心服务"""
        logger.info(f"Registering service: {name}")
        self.services[name] = service
    
    def set_feature_flag(self, plugin_name: str, enabled: bool) -> None:
        """设置插件的 Feature Flag"""
        self._feature_flags[plugin_name] = enabled
        logger.info(f"Feature flag set for {plugin_name}: {enabled}")
    
    def is_plugin_enabled(self, plugin_name: str) -> bool:
        """检查插件是否启用"""
        # Feature Flag 优先级最高
        if plugin_name in self._feature_flags:
            return self._feature_flags[plugin_name]
        
        # 其次检查插件元数据
        plugin = self.plugins.get(plugin_name)
        if plugin:
            return plugin.metadata.enabled
        
        return False
    
    async def discover_plugins(self) -> List[str]:
        """发现所有可用插件"""
        plugin_dir = Path(self.settings.plugin_dir)
        discovered = []
        
        if not plugin_dir.exists():
            logger.warning(f"Plugin directory does not exist: {plugin_dir}")
            return discovered
        
        # 扫描 ef.* 命名空间下的插件
        for namespace_dir in plugin_dir.glob("ef"):
            for domain_dir in namespace_dir.iterdir():
                if domain_dir.is_dir():
                    for plugin_dir in domain_dir.iterdir():
                        if plugin_dir.is_dir():
                            plugin_json = plugin_dir / self.settings.plugin_config_file
                            if plugin_json.exists():
                                plugin_name = f"ef.{domain_dir.name}.{plugin_dir.name}"
                                discovered.append(plugin_name)
                                logger.info(f"Discovered plugin: {plugin_name}")
        
        return discovered
    
    async def load_plugin(self, plugin_name: str) -> Optional[LoadedPlugin]:
        """加载单个插件"""
        try:
            # 读取插件元数据
            plugin_path = Path(self.settings.plugin_dir) / plugin_name.replace(".", "/")
            metadata_file = plugin_path / self.settings.plugin_config_file
            
            if not metadata_file.exists():
                logger.error(f"Plugin metadata not found: {metadata_file}")
                return None
            
            with open(metadata_file, "r", encoding="utf-8") as f:
                metadata_dict = json.load(f)
            
            # 验证元数据
            metadata = PluginMetadata(**metadata_dict)
            
            # 检查是否启用
            if not self.is_plugin_enabled(plugin_name):
                logger.info(f"Plugin {plugin_name} is disabled, skipping")
                return None
            
            # 动态导入插件模块
            module = importlib.import_module(f"plugins.{plugin_name}")
            
            # 检查插件是否有 setup 函数
            if not hasattr(module, "setup"):
                logger.error(f"Plugin {plugin_name} missing setup function")
                return None
            
            # 创建插件专用的 Hook API
            hook_api = PluginHookAPI(plugin_name, self)
            
            # 加载插件配置
            config = self._load_plugin_config(plugin_name, metadata.config_schema)
            
            # 调用插件的 setup 函数
            setup_func = getattr(module, "setup")
            if inspect.iscoroutinefunction(setup_func):
                await setup_func(hook_api, config)
            else:
                setup_func(hook_api, config)
            
            # 创建 LoadedPlugin 实例
            loaded_plugin = LoadedPlugin(
                metadata=metadata,
                module=module,
                config=config,
                hooks=hook_api._registered_tasks,
                tasks=hook_api._event_handlers
            )
            
            self.plugins[plugin_name] = loaded_plugin
            logger.info(f"Successfully loaded plugin: {plugin_name}")
            
            return loaded_plugin
            
        except Exception as e:
            logger.error(f"Failed to load plugin {plugin_name}", exc_info=True)
            return None
    
    def _load_plugin_config(
        self, 
        plugin_name: str, 
        schema: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """加载插件配置"""
        config = {}
        
        # 从环境变量加载配置
        env_prefix = f"EF_PLUGIN_{plugin_name.upper().replace('.', '_')}__"
        import os
        for key, value in os.environ.items():
            if key.startswith(env_prefix):
                config_key = key[len(env_prefix):].lower()
                config[config_key] = value
        
        # TODO: 从配置中心/Redis 加载动态配置
        
        # 验证配置（如果有 schema）
        if schema:
            # TODO: 使用 jsonschema 验证配置
            pass
        
        return config
    
    async def initialize(self) -> None:
        """初始化插件系统"""
        logger.info("Initializing plugin host")
        
        if not self.settings.plugin_auto_load:
            logger.info("Plugin auto-load disabled")
            return
        
        # 发现并加载所有插件
        discovered = await self.discover_plugins()
        
        for plugin_name in discovered:
            await self.load_plugin(plugin_name)
        
        logger.info(f"Plugin host initialized with {len(self.plugins)} plugins")
    
    async def shutdown(self) -> None:
        """关闭插件系统"""
        logger.info("Shutting down plugin host")
        
        # 调用每个插件的 teardown 函数（如果有）
        for plugin_name, plugin in self.plugins.items():
            if hasattr(plugin.module, "teardown"):
                teardown_func = getattr(plugin.module, "teardown")
                try:
                    if inspect.iscoroutinefunction(teardown_func):
                        await teardown_func()
                    else:
                        teardown_func()
                except Exception as e:
                    logger.error(f"Error during plugin {plugin_name} teardown", exc_info=True)
        
        self.plugins.clear()
        logger.info("Plugin host shutdown complete")


# 全局插件宿主实例
_plugin_host: Optional[PluginHost] = None


def get_plugin_host() -> PluginHost:
    """获取插件宿主单例"""
    global _plugin_host
    if _plugin_host is None:
        _plugin_host = PluginHost()
    return _plugin_host