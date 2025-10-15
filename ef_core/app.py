"""
EuraFlow FastAPI 主应用
"""
import asyncio
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from ef_core.config import get_settings
from ef_core.utils.logger import setup_logging, get_logger
from ef_core.utils.errors import EuraFlowException
from ef_core.database import get_db_manager
from ef_core.event_bus import get_event_bus
from ef_core.plugin_host import get_plugin_host
from ef_core.tasks.registry import get_task_registry
from ef_core.tasks.scheduler import get_scheduler
from ef_core.middleware.auth import AuthMiddleware
from ef_core.middleware.logging import LoggingMiddleware
from ef_core.middleware.metrics import MetricsMiddleware
from ef_core.api import api_router

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时初始化
    settings = get_settings()
    
    logger.info("Starting EuraFlow application", version="1.0.0")
    
    try:
        # 初始化数据库
        db_manager = get_db_manager()
        db_healthy = await db_manager.check_connection()
        if not db_healthy:
            logger.error("Database connection check failed")
            raise RuntimeError("Database connection failed")
        
        # 初始化事件总线
        event_bus = get_event_bus()
        await event_bus.initialize()
        
        # 注册核心服务到插件宿主
        plugin_host = get_plugin_host()
        await _register_core_services(plugin_host)
        
        # 注册任务注册表和事件总线到插件宿主（必须在初始化前）
        task_registry = get_task_registry()
        plugin_host.task_registry = task_registry
        plugin_host.event_bus = event_bus
        
        # 初始化插件系统
        await plugin_host.initialize()

        # 初始化任务调度器
        scheduler = get_scheduler()

        # 注册同步服务处理函数（必须在调度器启动前，以便加载服务时能找到处理函数）
        await _register_sync_service_handlers(scheduler)

        # 启动调度器（会从数据库加载已启用的服务）
        await scheduler.start()
        logger.info("Task scheduler initialized")

        logger.info("EuraFlow application started successfully")

        yield  # 应用运行期间
        
    except Exception as e:
        logger.error("Failed to start application", exc_info=True)
        raise
    
    # 关闭时清理
    logger.info("Shutting down EuraFlow application")

    try:
        # 关闭任务调度器
        scheduler = get_scheduler()
        await scheduler.shutdown()
        logger.info("Task scheduler shutdown")

        # 关闭插件系统
        await plugin_host.shutdown()

        # 关闭事件总线
        await event_bus.shutdown()

        # 关闭数据库连接
        await db_manager.close()

        logger.info("EuraFlow application shutdown complete")

    except Exception as e:
        logger.error("Error during application shutdown", exc_info=True)


async def _register_core_services(plugin_host):
    """注册核心服务到插件宿主"""
    from ef_core.services import (
        OrdersService, ShipmentsService, 
        InventoryService, ListingsService
    )
    
    # 注册服务
    plugin_host.register_service("orders", OrdersService())
    plugin_host.register_service("shipments", ShipmentsService())
    plugin_host.register_service("inventory", InventoryService())
    plugin_host.register_service("listings", ListingsService())
    
    logger.info("Registered core services to plugin host")


async def _register_sync_service_handlers(scheduler):
    """注册同步服务处理函数到调度器"""
    try:
        from plugins.ef.channels.ozon.services.kuajing84_material_cost_sync_service import get_kuajing84_material_cost_sync_service
        from plugins.ef.channels.ozon.services.ozon_product_sync_service import get_ozon_product_sync_service
        from plugins.ef.channels.ozon.services.ozon_sync import OzonSyncService
        from plugins.ef.channels.ozon.models import OzonShop
        from ef_core.services.exchange_rate_service import ExchangeRateService
        from sqlalchemy import select
        from typing import Dict, Any

        # 0. 注册汇率刷新服务
        exchange_rate_service = ExchangeRateService()
        scheduler.register_handler(
            service_key="exchange_rate_refresh",
            handler=exchange_rate_service.refresh_rates
        )
        logger.info("Registered exchange_rate_refresh sync service handler")

        # 1. 注册跨境巴士物料成本同步服务
        kuajing84_service = get_kuajing84_material_cost_sync_service()
        scheduler.register_handler(
            service_key="kuajing84_material_cost",
            handler=kuajing84_service.sync_material_costs
        )
        logger.info("Registered kuajing84_material_cost sync service handler")

        # 2. 注册OZON商品订单增量同步服务（封装）
        async def ozon_sync_handler(config: Dict[str, Any]) -> Dict[str, Any]:
            """OZON商品订单增量同步处理函数"""
            try:
                # 获取所有活跃店铺
                db_manager = get_db_manager()
                total_products = 0
                total_orders = 0

                async with db_manager.get_session() as db:
                    result = await db.execute(
                        select(OzonShop).where(OzonShop.status == "active")
                    )
                    shops = result.scalars().all()

                    for shop in shops:
                        # 同步商品
                        sync_products = config.get("sync_products", True)
                        if sync_products:
                            product_task_id = f"ozon_sync_products_{shop.id}_{uuid.uuid4().hex[:8]}"
                            product_result = await OzonSyncService.sync_products(
                                shop_id=shop.id,
                                db=db,
                                task_id=product_task_id,
                                mode="incremental"
                            )
                            total_products += product_result.get("total_processed", 0)

                        # 同步订单
                        sync_orders = config.get("sync_orders", True)
                        if sync_orders:
                            order_task_id = f"ozon_sync_orders_{shop.id}_{uuid.uuid4().hex[:8]}"
                            order_result = await OzonSyncService.sync_orders(
                                shop_id=shop.id,
                                db=db,
                                task_id=order_task_id,
                                mode="incremental"
                            )
                            total_orders += order_result.get("total_processed", 0)

                return {
                    "records_processed": total_products + total_orders,
                    "records_updated": total_products + total_orders,
                    "message": f"同步完成：商品{total_products}条，订单{total_orders}条"
                }

            except Exception as e:
                logger.error(f"OZON sync failed: {e}", exc_info=True)
                raise

        scheduler.register_handler(
            service_key="ozon_sync_incremental",
            handler=ozon_sync_handler
        )
        logger.info("Registered ozon_sync_incremental service handler")

        # 3. 注册OZON商品增量同步服务
        ozon_product_service = get_ozon_product_sync_service()
        scheduler.register_handler(
            service_key="ozon_product_sync",
            handler=ozon_product_service.sync_products
        )
        logger.info("Registered ozon_product_sync service handler")

    except Exception as e:
        logger.warning(f"Failed to register sync service handlers: {e}", exc_info=True)


def create_app() -> FastAPI:
    """创建 FastAPI 应用"""
    settings = get_settings()
    
    # 设置日志
    setup_logging(
        log_level=settings.log_level,
        log_format=settings.log_format
    )
    
    # 创建应用
    app = FastAPI(
        title=settings.api_title,
        version=settings.api_version,
        description="EuraFlow Cross-border E-commerce Platform API",
        docs_url="/docs" if settings.api_debug else None,
        redoc_url="/redoc" if settings.api_debug else None,
        lifespan=lifespan,
        # 关闭默认的 422 验证错误处理
        openapi_url="/openapi.json" if settings.api_debug else None
    )
    
    # 添加中间件（顺序很重要）
    
    # CORS 中间件
    # 允许的来源列表
    allowed_origins = []
    if settings.api_debug:
        # 开发模式：允许所有来源
        allowed_origins = ["*"]
    else:
        # 生产模式：允许特定来源
        allowed_origins = [
            "https://www.ozon.ru",  # Tampermonkey 脚本运行的域名
            "https://ozon.ru",
            "http://localhost:3000",  # 本地前端开发
            "http://local.euraflow.com",  # 本地域名
        ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # 指标中间件
    if settings.metrics_enabled:
        app.add_middleware(MetricsMiddleware)
    
    # 日志中间件
    app.add_middleware(LoggingMiddleware)
    
    # 认证中间件
    app.add_middleware(AuthMiddleware)
    
    # 添加路由
    app.include_router(api_router, prefix=settings.api_prefix)
    
    # 异常处理器
    @app.exception_handler(EuraFlowException)
    async def euraflow_exception_handler(request: Request, exc: EuraFlowException):
        """处理 EuraFlow 自定义异常"""
        return exc.to_response(request)
    
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        """处理 Pydantic 验证异常"""
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": {
                    "type": "about:blank",
                    "title": "Validation Error",
                    "status": 400,
                    "detail": "Request validation failed",
                    "code": "VALIDATION_ERROR",
                    "validation_errors": exc.errors()
                }
            }
        )
    
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        """处理 FastAPI HTTP 异常"""
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "ok": False,
                "error": {
                    "type": "about:blank", 
                    "title": exc.detail,
                    "status": exc.status_code,
                    "detail": exc.detail,
                    "code": f"HTTP_{exc.status_code}"
                }
            }
        )
    
    @app.exception_handler(500)
    async def internal_server_error_handler(request: Request, exc: Exception):
        """处理未捕获的服务器错误"""
        logger.error("Unhandled server error", exc_info=True)
        
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": {
                    "type": "about:blank",
                    "title": "Internal Server Error", 
                    "status": 500,
                    "detail": "An internal server error occurred",
                    "code": "INTERNAL_SERVER_ERROR"
                }
            }
        )
    
    # 健康检查端点
    @app.get("/healthz")
    async def health_check():
        """健康检查端点"""
        return {"status": "healthy", "timestamp": "2025-01-01T00:00:00Z"}
    
    return app


# 创建应用实例
app = create_app()


if __name__ == "__main__":
    import uvicorn
    
    settings = get_settings()
    
    # 运行应用
    uvicorn.run(
        "ef_core.app:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_debug,
        log_level=settings.log_level.lower(),
        access_log=False,  # 使用自定义日志中间件
    )