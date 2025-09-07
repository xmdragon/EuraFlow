"""
EuraFlow 日志系统
- JSON 格式输出
- 必需字段：ts, level, trace_id, plugin, action, shop_id, latency_ms, result, err
- PII 自动脱敏
"""
import json
import logging
import re
import sys
from datetime import datetime
from typing import Any, Dict, Optional
from contextvars import ContextVar

import structlog
from structlog.processors import JSONRenderer, TimeStamper, add_log_level

# Context variables for request tracking
trace_id_var: ContextVar[Optional[str]] = ContextVar("trace_id", default=None)
plugin_var: ContextVar[Optional[str]] = ContextVar("plugin", default=None)
shop_id_var: ContextVar[Optional[int]] = ContextVar("shop_id", default=None)


class PIIMaskingProcessor:
    """PII 数据脱敏处理器"""
    
    # 脱敏规则
    PATTERNS = {
        # 电话号码：保留前3位和后3位
        "phone": (
            re.compile(r"(\+\d{1,3}\s?\d{3})\d{4,8}(\d{3})"),
            r"\1****\2"
        ),
        # 邮箱：保留首字母和域名
        "email": (
            re.compile(r"([a-zA-Z0-9])[a-zA-Z0-9._-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"),
            r"\1***@\2"
        ),
        # 地址：仅保留城市
        "address": (
            re.compile(r"(г\.\s*[^,]+|город\s+[^,]+|city:\s*[^,]+)[^}]*", re.IGNORECASE),
            r"\1 [MASKED]"
        ),
        # Token/密钥
        "token": (
            re.compile(r"(token|key|secret|password)[\"']?\s*[:=]\s*[\"']?([^\"'\s,}]+)"),
            r"\1=***MASKED***"
        ),
    }
    
    def __call__(self, logger, method_name, event_dict):
        """处理日志事件，脱敏 PII 数据"""
        return self._mask_dict(event_dict)
    
    def _mask_dict(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """递归脱敏字典中的 PII 数据"""
        if not isinstance(data, dict):
            return data
            
        masked_data = {}
        for key, value in data.items():
            if isinstance(value, str):
                masked_data[key] = self._mask_string(value)
            elif isinstance(value, dict):
                masked_data[key] = self._mask_dict(value)
            elif isinstance(value, list):
                masked_data[key] = [
                    self._mask_dict(item) if isinstance(item, dict)
                    else self._mask_string(item) if isinstance(item, str)
                    else item
                    for item in value
                ]
            else:
                masked_data[key] = value
        return masked_data
    
    def _mask_string(self, text: str) -> str:
        """脱敏字符串中的 PII 数据"""
        for pattern, replacement in self.PATTERNS.values():
            text = pattern.sub(replacement, text)
        return text


class EuraFlowProcessor:
    """添加 EuraFlow 必需字段"""
    
    def __call__(self, logger, method_name, event_dict):
        # 添加时间戳
        event_dict["ts"] = datetime.utcnow().isoformat() + "Z"
        
        # 添加上下文变量
        if trace_id := trace_id_var.get():
            event_dict["trace_id"] = trace_id
        
        if plugin := plugin_var.get():
            event_dict["plugin"] = plugin
            
        if shop_id := shop_id_var.get():
            event_dict["shop_id"] = shop_id
        
        # 重命名标准字段
        if "event" in event_dict:
            event_dict["action"] = event_dict.pop("event")
            
        if "exception" in event_dict:
            event_dict["err"] = str(event_dict.pop("exception"))
            
        return event_dict


def setup_logging(
    log_level: str = "INFO",
    log_format: str = "json",
    enable_pii_masking: bool = True
) -> None:
    """配置日志系统"""
    
    # 配置处理器链
    processors = [
        TimeStamper(fmt="iso"),
        add_log_level,
        EuraFlowProcessor(),
    ]
    
    if enable_pii_masking:
        processors.append(PIIMaskingProcessor())
    
    # 根据格式选择渲染器
    if log_format == "json":
        processors.append(JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer())
    
    # 配置 structlog
    structlog.configure(
        processors=processors,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
    
    # 配置标准库日志
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level.upper()),
    )


def get_logger(name: str = __name__) -> structlog.stdlib.BoundLogger:
    """获取日志记录器"""
    return structlog.get_logger(name)


# 日志上下文管理器
class LogContext:
    """日志上下文管理器，用于设置请求级别的上下文"""
    
    def __init__(
        self,
        trace_id: Optional[str] = None,
        plugin: Optional[str] = None,
        shop_id: Optional[int] = None
    ):
        self.trace_id = trace_id
        self.plugin = plugin
        self.shop_id = shop_id
        self._tokens = []
    
    def __enter__(self):
        if self.trace_id:
            self._tokens.append(trace_id_var.set(self.trace_id))
        if self.plugin:
            self._tokens.append(plugin_var.set(self.plugin))
        if self.shop_id:
            self._tokens.append(shop_id_var.set(self.shop_id))
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        for token in self._tokens:
            token.var.reset(token)