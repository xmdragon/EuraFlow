"""
EuraFlow 核心模块
"""

__version__ = "1.0.0"

# 注册汇率刷新服务handler
try:
    from .services.register_exchange_rate_handler import register_exchange_rate_handler
except ImportError:
    pass
