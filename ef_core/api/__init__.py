"""
EuraFlow API 路由模块
"""

from fastapi import APIRouter
import logging

from .auth import router as auth_router
from .api_keys_routes import router as api_keys_router
from .orders import router as orders_router
from .shipments import router as shipments_router
from .inventory import router as inventory_router
from .listings import router as listings_router
from .system import router as system_router
from .finance import router as finance_router

logger = logging.getLogger(__name__)

# 创建主路由器
api_router = APIRouter()

# 注册核心路由
api_router.include_router(auth_router, tags=["Authentication"])
api_router.include_router(api_keys_router, tags=["API Keys"])
api_router.include_router(orders_router, prefix="/orders", tags=["Orders"])
api_router.include_router(shipments_router, prefix="/shipments", tags=["Shipments"])
api_router.include_router(inventory_router, prefix="/inventory", tags=["Inventory"])
api_router.include_router(listings_router, prefix="/listings", tags=["Listings"])
api_router.include_router(system_router, prefix="/system", tags=["System"])
api_router.include_router(finance_router, tags=["Finance"])

# Load plugin routes dynamically
try:
    # Import Ozon plugin to get its router
    from plugins.ef.channels.ozon import get_router

    ozon_router = get_router()
    if ozon_router:
        # Plugin router already has /ozon prefix, don't add another one
        api_router.include_router(ozon_router)
        logger.info("Loaded Ozon plugin routes")
    else:
        logger.warning("Ozon plugin has no routes")
except ImportError as e:
    logger.warning(f"Could not import Ozon plugin: {e}")
except Exception as e:
    logger.error(f"Error loading Ozon plugin routes: {e}")

# Legacy Ozon routes removed - using plugin routes only

__all__ = ["api_router"]
