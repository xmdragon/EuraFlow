"""
系统 API 路由
"""
from fastapi import APIRouter
from fastapi.responses import Response

from ef_core.utils.logger import get_logger
from ef_core.middleware.metrics import get_metrics_handler
from .models import ApiResponse

router = APIRouter()
logger = get_logger(__name__)


@router.get("/health", response_model=ApiResponse[dict])
async def health_check():
    """健康检查"""
    return ApiResponse.success({
        "status": "healthy",
        "timestamp": "2025-01-01T00:00:00Z",
        "version": "1.0.0"
    })


@router.get("/metrics")
async def metrics():
    """Prometheus 指标端点"""
    handler = get_metrics_handler()
    return await handler(None)


@router.get("/info", response_model=ApiResponse[dict])
async def system_info():
    """系统信息"""
    from ef_core.plugin_host import get_plugin_host
    from ef_core.config import get_settings
    
    settings = get_settings()
    plugin_host = get_plugin_host()
    
    info = {
        "name": "EuraFlow",
        "version": "1.0.0",
        "api_version": settings.api_version,
        "plugins": {
            "total": len(plugin_host.plugins),
            "enabled": sum(
                1 for p in plugin_host.plugins.values() 
                if p.metadata.enabled
            )
        }
    }
    
    return ApiResponse.success(info)