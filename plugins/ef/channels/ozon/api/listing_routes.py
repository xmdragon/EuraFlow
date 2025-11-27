"""
商品上架管理 API 路由（聚合路由）

拆分为以下子模块：
- listing/category_routes.py: 类目管理
- listing/product_routes.py: 商品操作
- listing/import_routes.py: 商品创建/导入
- listing/media_routes.py: 图片上传
"""

import logging

from fastapi import APIRouter

from .listing.category_routes import router as category_router
from .listing.import_routes import router as import_router
from .listing.media_routes import router as media_router
from .listing.product_routes import router as product_router

router = APIRouter(tags=["ozon-listing"])
logger = logging.getLogger(__name__)

# 注册子路由
router.include_router(category_router)
router.include_router(product_router)
router.include_router(import_router)
router.include_router(media_router)

logger.info("Listing routes initialized successfully")
