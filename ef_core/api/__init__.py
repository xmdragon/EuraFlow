"""
EuraFlow API 路由模块
"""
from fastapi import APIRouter
from .orders import router as orders_router
from .shipments import router as shipments_router
from .inventory import router as inventory_router
from .listings import router as listings_router
from .system import router as system_router

# 创建主路由器
api_router = APIRouter()

# 注册子路由
api_router.include_router(orders_router, prefix="/orders", tags=["Orders"])
api_router.include_router(shipments_router, prefix="/shipments", tags=["Shipments"])
api_router.include_router(inventory_router, prefix="/inventory", tags=["Inventory"])  
api_router.include_router(listings_router, prefix="/listings", tags=["Listings"])
api_router.include_router(system_router, prefix="/system", tags=["System"])

__all__ = ["api_router"]