"""
EuraFlow 同步服务系统插件

统一管理所有后台同步服务的配置、调度和日志
"""
from typing import Optional
import logging
logger = logging.getLogger(__name__)
from fastapi import APIRouter

# 插件版本
__version__ = "1.0.0"


def get_router() -> Optional[APIRouter]:
    """
    获取插件的 API 路由

    Returns:
        插件的路由器，如果插件不提供 API 则返回 None
    """
    try:
        from .api.routes import router
        return router
    except ImportError as e:
        import sys

        logger.error(f"SYNC SERVICE ROUTER IMPORT ERROR: {e}", exc_info=True)

        if 'plugins.ef.system.sync_service.api.routes' in sys.modules:
            try:
                from .api.routes import router
                logger.info("Successfully recovered router from sys.modules")
                return router
            except Exception as recovery_error:
                logger.error(f"Failed to recover router: {recovery_error}")

        return None
    except Exception as e:
        logger.error(f"SYNC SERVICE ROUTER UNEXPECTED ERROR: {e}", exc_info=True)
        return None


async def setup(hooks) -> None:
    """插件初始化函数"""
    logger.info("Sync service management plugin initialized")
    logger.info(f"Version: {__version__}")


async def teardown() -> None:
    """插件清理函数"""
    logger.info("Sync service management plugin shutting down...")
