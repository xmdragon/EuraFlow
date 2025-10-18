"""
同步服务Handler注册协议

定义插件如何向系统注册后台同步服务Handler
"""
from typing import Protocol, List, Callable, Optional, Dict, Any
from dataclasses import dataclass


@dataclass
class ServiceHandlerRegistration:
    """服务Handler注册信息"""

    service_key: str
    """服务唯一标识（全局唯一，建议格式：{plugin}_{service}）"""

    handler: Callable[[Dict[str, Any]], Any]
    """
    服务处理函数

    签名: async def handler(config: Dict[str, Any]) -> Dict[str, Any]

    参数:
        config: 服务配置（来自SyncService.config_json + 手动触发时的额外参数）

    返回:
        {
            "records_processed": int,  # 处理记录数
            "records_updated": int,    # 更新记录数
            "message": str,            # 简短摘要
            ...                        # 其他自定义字段
        }
    """

    name: str
    """服务显示名称（用于UI展示）"""

    description: str
    """服务功能说明（详细描述服务用途）"""

    plugin: str
    """所属插件标识（如：ef.channels.ozon）"""

    config_schema: Optional[Dict[str, Any]] = None
    """
    配置参数Schema（JSON Schema格式）

    示例:
    {
        "batch_size": {
            "type": "integer",
            "default": 10,
            "minimum": 1,
            "maximum": 100,
            "description": "每次处理订单数"
        },
        "delay_seconds": {
            "type": "integer",
            "default": 5,
            "description": "处理间隔（秒）"
        }
    }
    """


class SyncServiceHandlerProvider(Protocol):
    """
    插件通过此协议向系统提供后台服务Handler

    插件在 setup() 阶段调用全局注册表注册Handler
    """

    def provide_handlers(self) -> List[ServiceHandlerRegistration]:
        """
        提供Handler注册列表

        Returns:
            Handler注册信息列表
        """
        ...
