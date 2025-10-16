"""
Ozon 平台 API 端点
"""
from fastapi import APIRouter
import logging

router = APIRouter(prefix="/ozon", tags=["Ozon"])
logger = logging.getLogger(__name__)

# 延迟导入子路由以避免循环导入

# 原有子路由
try:
    from .watermark_routes import router as watermark_router
    router.include_router(watermark_router)
except ImportError as e:
    logger.warning(f"Could not import watermark routes: {e}")

try:
    from .product_selection_routes import router as product_selection_router
    router.include_router(product_selection_router)
except ImportError as e:
    logger.warning(f"Could not import product selection routes: {e}")

try:
    from .webhook_routes import router as webhook_router
    router.include_router(webhook_router)
except ImportError as e:
    import traceback
    import sys
    print(f"════════ WEBHOOK IMPORT ERROR ════════", file=sys.stderr)
    print(f"Error: {e}", file=sys.stderr)
    print(f"Traceback:\n{traceback.format_exc()}", file=sys.stderr)
    print(f"═════════════════════════════════════", file=sys.stderr)
    logger.warning(f"Could not import webhook routes: {e}")

try:
    from .chat_routes import router as chat_router
    router.include_router(chat_router)
except ImportError as e:
    logger.warning(f"Could not import chat routes: {e}")

try:
    from .kuajing84_routes import router as kuajing84_router
    router.include_router(kuajing84_router)
except ImportError as e:
    logger.warning(f"Could not import kuajing84 routes: {e}")

try:
    from .sync_service_routes import router as sync_service_router
    router.include_router(sync_service_router)
except ImportError as e:
    logger.warning(f"Could not import sync service routes: {e}")

# 新拆分的业务子路由
try:
    from .sync_task_routes import router as sync_task_router
    router.include_router(sync_task_router)
    logger.info("✓ Loaded sync_task_routes")
except ImportError as e:
    logger.warning(f"Could not import sync task routes: {e}")

try:
    from .stats_routes import router as stats_router
    router.include_router(stats_router)
    logger.info("✓ Loaded stats_routes")
except ImportError as e:
    logger.warning(f"Could not import stats routes: {e}")

try:
    from .shop_routes import router as shop_router
    router.include_router(shop_router)
    logger.info("✓ Loaded shop_routes")
except ImportError as e:
    logger.warning(f"Could not import shop routes: {e}")

try:
    from .product_routes import router as product_router
    router.include_router(product_router)
    logger.info("✓ Loaded product_routes")
except ImportError as e:
    logger.warning(f"Could not import product routes: {e}")

try:
    from .order_routes import router as order_router
    router.include_router(order_router)
    logger.info("✓ Loaded order_routes")
except ImportError as e:
    logger.warning(f"Could not import order routes: {e}")

try:
    from .packing_routes import router as packing_router
    router.include_router(packing_router)
    logger.info("✓ Loaded packing_routes")
except ImportError as e:
    logger.warning(f"Could not import packing routes: {e}")

try:
    from .report_routes import router as report_router
    router.include_router(report_router)
    logger.info("✓ Loaded report_routes")
except ImportError as e:
    logger.warning(f"Could not import report routes: {e}")

try:
    from .listing_routes import router as listing_router
    router.include_router(listing_router)
    logger.info("✓ Loaded listing_routes")
except ImportError as e:
    logger.warning(f"Could not import listing routes: {e}")

try:
    from .quick_publish_routes import router as quick_publish_router
    router.include_router(quick_publish_router)
    logger.info("✓ Loaded quick_publish_routes")
except ImportError as e:
    logger.warning(f"Could not import quick publish routes: {e}")


logger.info("Ozon API routes initialized successfully")
