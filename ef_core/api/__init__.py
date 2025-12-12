"""
EuraFlow API 路由模块
"""

from fastapi import APIRouter
import logging

from .auth import router as auth_router
from .clone_routes import router as clone_router
from .api_keys_routes import router as api_keys_router
from .orders import router as orders_router
from .shipments import router as shipments_router
from .inventory import router as inventory_router
from .listings import router as listings_router
from .system import router as system_router
from .finance import router as finance_router
from .settings import router as settings_router
from .exchange_rate import router as exchange_rate_router
from .notification_routes import router as notification_router
from .audit_routes import router as audit_router
from .account_level_routes import router as account_level_router
from .credit import router as credit_router
from .admin_credit import router as admin_credit_router
from .permission_routes import router as permission_router

logger = logging.getLogger(__name__)

# 创建主路由器
api_router = APIRouter()

# 注册核心路由
api_router.include_router(auth_router, tags=["Authentication"])
api_router.include_router(clone_router, tags=["Clone Identity"])
api_router.include_router(api_keys_router, tags=["API Keys"])
api_router.include_router(account_level_router, tags=["Account Levels"])
api_router.include_router(settings_router, tags=["Settings"])
api_router.include_router(exchange_rate_router, tags=["Exchange Rates"])
api_router.include_router(notification_router, tags=["Notifications"])
api_router.include_router(audit_router, tags=["Audit Logs"])
api_router.include_router(credit_router, tags=["Credit"])
api_router.include_router(admin_credit_router, tags=["Admin Credit"])
api_router.include_router(permission_router, tags=["Permissions"])
api_router.include_router(orders_router, prefix="/orders", tags=["Orders"])
api_router.include_router(shipments_router, prefix="/shipments", tags=["Shipments"])
api_router.include_router(inventory_router, prefix="/inventory", tags=["Inventory"])
api_router.include_router(listings_router, prefix="/listings", tags=["Listings"])
api_router.include_router(system_router, prefix="/system", tags=["System"])
api_router.include_router(finance_router, tags=["Finance"])

# Load plugin routes dynamically

# 1. Load System Sync Service plugin routes
try:
    from plugins.ef.system.sync_service import get_router as get_sync_service_router

    sync_service_router = get_sync_service_router()
    if sync_service_router:
        # Plugin router already has /sync-services prefix
        api_router.include_router(sync_service_router)
        logger.info("Loaded System Sync Service plugin routes")
    else:
        logger.warning("System Sync Service plugin has no routes")
except ImportError as e:
    logger.warning(f"Could not import System Sync Service plugin: {e}")
except Exception as e:
    logger.error(f"Error loading System Sync Service plugin routes: {e}")

# 2. Load Ozon plugin routes
try:
    from plugins.ef.channels.ozon import get_router as get_ozon_router

    ozon_router = get_ozon_router()
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
