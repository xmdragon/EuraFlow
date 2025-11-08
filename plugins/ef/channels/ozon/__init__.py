"""
EuraFlow Ozon Channel Plugin
面向 Ozon 平台的订单拉取、发货推送、库存同步等功能
"""
import asyncio
import logging
logger = logging.getLogger(__name__)
from typing import Optional, Dict, Any
from datetime import datetime, UTC, timedelta
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
        # 如果是部分导入错误但router已加载，继续使用
        import sys
        import traceback

        # 打印详细错误信息便于调试
        logger.info(f"════════ OZON ROUTER IMPORT ERROR ════════")
        logger.info(f"Error: {e}")
        logger.info("Full traceback:")
        traceback.print_exc()
        logger.info(f"═══════════════════════════════════════════")

        if 'plugins.ef.channels.ozon.api.routes' in sys.modules:
            try:
                from .api.routes import router
                logger.info("✓ Successfully recovered router from sys.modules")
                return router
            except Exception as recovery_error:
                logger.info(f"✗ Failed to recover router: {recovery_error}")

        return None
    except Exception as e:
        import traceback
        logger.info(f"════════ OZON ROUTER UNEXPECTED ERROR ════════")
        logger.info(f"Error: {e}")
        traceback.print_exc()
        logger.info(f"═════════════════════════════════════════════")
        return None


async def _get_task_schedule(db_session, service_key: str, default_cron: str) -> tuple[str | None, bool]:
    """
    从数据库获取任务调度配置

    Args:
        db_session: 数据库会话
        service_key: 服务标识
        default_cron: 默认cron表达式（如果数据库没有配置）

    Returns:
        (cron表达式, 是否启用) 如果任务未启用则返回(None, False)
    """
    try:
        from plugins.ef.system.sync_service.models.sync_service import SyncService
        from sqlalchemy import select

        result = await db_session.execute(
            select(SyncService).where(SyncService.service_key == service_key)
        )
        service = result.scalar_one_or_none()

        if not service:
            logger.info(f"Task {service_key} not found in sync_services, using default: {default_cron}")
            return default_cron, True

        if not service.is_enabled:
            logger.info(f"Task {service_key} is disabled in database, skipping registration")
            return None, False

        # 转换interval类型为cron表达式
        if service.service_type == "interval":
            interval_seconds = int(service.schedule_config)
            interval_minutes = interval_seconds // 60
            if interval_minutes < 60:
                cron = f"*/{interval_minutes} * * * *"
            else:
                interval_hours = interval_minutes // 60
                cron = f"0 */{interval_hours} * * *"
            logger.info(f"Task {service_key}: converted interval {interval_seconds}s to cron '{cron}'")
            return cron, True
        else:
            # cron类型直接使用
            logger.info(f"Task {service_key}: using cron from database '{service.schedule_config}'")
            return service.schedule_config, True

    except Exception as e:
        logger.warning(f"Failed to load schedule for {service_key} from database: {e}, using default")
        return default_cron, True


async def setup(hooks) -> None:
    """插件初始化函数"""
    # 从数据库获取Ozon店铺配置和任务调度配置
    try:
        from ef_core.database import get_db_manager
        from .models import OzonShop
        from sqlalchemy import select

        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            # 获取第一个激活的Ozon店铺
            result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active").limit(1)
            )
            shop = result.scalar_one_or_none()

            if not shop:
                logger.info("Warning: No active Ozon shop found, plugin running in standby mode")
                # 仍然注册任务，但会在执行时检查配置
                api_key = client_id = None
            else:
                # 从数据库字段获取API凭据
                api_key = shop.api_key_enc  # 注意：这里需要解密处理
                client_id = shop.client_id

                if not api_key or not client_id:
                    logger.info(f"Warning: Shop {shop.shop_name} missing API credentials, plugin running in standby mode")
                    api_key = client_id = None
                else:
                    logger.info(f"Ozon plugin initialized with shop: {shop.shop_name} (client_id: {client_id})")

            # 注册定时任务：拉取订单（使用数据库配置）
            cron, enabled = await _get_task_schedule(db, "ozon_sync_incremental", "*/30 * * * *")
            if enabled and cron:
                await hooks.register_cron(
                    name="ef.ozon.orders.pull",
                    cron=cron,
                    task=pull_orders_task
                )

            # 注册定时任务：同步库存（使用数据库配置）
            cron, enabled = await _get_task_schedule(db, "ozon_inventory_sync", "*/30 * * * *")
            if enabled and cron:
                await hooks.register_cron(
                    name="ef.ozon.inventory.sync",
                    cron=cron,
                    task=sync_inventory_task
                )

    except Exception as e:
        logger.info(f"Error loading Ozon shop configuration: {e}")
        logger.info("Plugin running in standby mode")
        api_key = client_id = None
    
    # 订阅事件：发货请求
    await hooks.consume(
        topic="ef.shipments.request",
        handler=handle_shipment_request
    )
    
    # 订阅事件：库存变更
    await hooks.consume(
        topic="ef.inventory.changed",
        handler=handle_inventory_change
    )

    # 注册同步服务处理函数到全局Handler注册表
    try:
        from plugins.ef.system.sync_service.services.handler_registry import get_registry
        from .services.kuajing84_material_cost_sync_service import get_kuajing84_material_cost_sync_service
        from .services.ozon_sync import OzonSyncService

        registry = get_registry()

        # 1. 注册跨境巴士物料成本同步服务
        kuajing84_service = get_kuajing84_material_cost_sync_service()
        registry.register(
            service_key="kuajing84_material_cost",
            handler=kuajing84_service.sync_material_costs,
            name="跨境巴士物料成本同步",
            description='自动从跨境巴士查询并更新"已打包"订单的物料成本和国内物流单号（单线程模式：每小时第15分钟执行，每次处理1个订单，处理间隔5秒）',
            plugin="ef.channels.ozon",
            config_schema={
                "batch_size": {
                    "type": "integer",
                    "default": 1,
                    "minimum": 1,
                    "maximum": 10,
                    "description": "每次处理订单数"
                },
                "delay_seconds": {
                    "type": "integer",
                    "default": 5,
                    "minimum": 1,
                    "maximum": 60,
                    "description": "处理间隔（秒）"
                }
            }
        )
        logger.info("✓ Registered kuajing84_material_cost sync service handler")

        # 2. 注册OZON财务费用同步服务
        from .services.ozon_finance_sync_service import get_ozon_finance_sync_service
        finance_service = get_ozon_finance_sync_service()
        registry.register(
            service_key="ozon_finance_sync",
            handler=finance_service.sync_finance_costs,
            name="OZON财务费用同步",
            description="从OZON同步已完成订单的财务费用明细（佣金、物流、退货等）",
            plugin="ef.channels.ozon",
            config_schema={}
        )
        logger.info("✓ Registered ozon_finance_sync service handler")

        # 3. 注册OZON促销活动同步服务（封装）
        async def ozon_promotion_sync_handler(config: Dict[str, Any]) -> Dict[str, Any]:
            """OZON促销活动同步处理函数"""
            import logging
            from datetime import datetime
            from ef_core.database import get_db_manager
            from .models import OzonShop, OzonPromotionAction
            from .services.promotion_service import PromotionService
            from sqlalchemy import select

            logger_local = logging.getLogger(__name__)
            start_time = datetime.utcnow()
            results = {
                "started_at": start_time.isoformat() + "Z",
                "shops_processed": 0,
                "actions_synced": 0,
                "candidates_synced": 0,
                "products_synced": 0,
                "auto_cancelled": 0,
                "errors": []
            }

            logger_local.info("Starting promotion sync task")

            db_manager = get_db_manager()

            try:
                async with db_manager.get_session() as db:
                    # 获取所有活跃的店铺
                    stmt = select(OzonShop).where(OzonShop.status == "active")
                    result = await db.execute(stmt)
                    shops_orm = result.scalars().all()

                    # 立即提取所有店铺信息到字典，完全脱离ORM对象
                    shops = []
                    for shop in shops_orm:
                        shops.append({
                            'id': shop.id,
                            'shop_name': shop.shop_name,
                            'status': shop.status
                        })

                    logger_local.info(f"Found {len(shops)} active shops to sync")

                    for shop_data in shops:
                        # 使用字典数据，不再依赖ORM对象
                        shop_id = shop_data['id']
                        shop_name = shop_data['shop_name']

                        try:
                            # 1. 同步活动清单
                            sync_result = await PromotionService.sync_actions(shop_id, db)
                            actions_count = sync_result.get("synced_count", 0)
                            results["actions_synced"] += actions_count
                            logger_local.info(f"Synced {actions_count} actions for shop {shop_id}")

                            # 2. 获取所有活动
                            stmt = select(OzonPromotionAction).where(
                                OzonPromotionAction.shop_id == shop_id
                            )
                            result = await db.execute(stmt)
                            actions_orm = result.scalars().all()

                            # 立即提取活动信息到字典，脱离ORM对象
                            actions = []
                            for action in actions_orm:
                                actions.append({
                                    'action_id': action.action_id,
                                    'auto_cancel_enabled': action.auto_cancel_enabled
                                })

                            for action_data in actions:
                                # 使用字典数据
                                action_id = action_data['action_id']
                                auto_cancel_enabled = action_data['auto_cancel_enabled']

                                try:
                                    # 2.1 同步候选商品
                                    sync_result = await PromotionService.sync_action_candidates(
                                        shop_id, action_id, db
                                    )
                                    candidates_count = sync_result.get("synced_count", 0)
                                    results["candidates_synced"] += candidates_count

                                    # 2.2 同步参与商品
                                    sync_result = await PromotionService.sync_action_products(
                                        shop_id, action_id, db
                                    )
                                    products_count = sync_result.get("synced_count", 0)
                                    results["products_synced"] += products_count

                                    logger_local.info(
                                        f"Synced action {action_id}: {candidates_count} candidates, {products_count} products"
                                    )

                                    # 2.3 执行自动取消（如果开启）
                                    if auto_cancel_enabled:
                                        try:
                                            cancel_result = await PromotionService.auto_cancel_task(
                                                shop_id, action_id, db
                                            )
                                            cancelled_count = cancel_result.get("cancelled_count", 0)
                                            results["auto_cancelled"] += cancelled_count

                                            if cancelled_count > 0:
                                                logger_local.info(
                                                    f"Auto-cancelled {cancelled_count} products from action {action_id}",
                                                    extra={
                                                        "shop_id": shop_id,
                                                        "action_id": action_id,
                                                        "cancelled_count": cancelled_count
                                                    }
                                                )
                                        except Exception as e:
                                            error_msg = f"Failed to auto-cancel products for action {action_id}: {str(e)}"
                                            logger_local.error(error_msg, exc_info=True)
                                            results["errors"].append({
                                                "shop_id": shop_id,
                                                "action_id": action_id,
                                                "error": error_msg,
                                                "step": "auto_cancel"
                                            })

                                except Exception as e:
                                    error_msg = f"Failed to sync action {action_id}: {str(e)}"
                                    logger_local.error(error_msg, exc_info=True)
                                    results["errors"].append({
                                        "shop_id": shop_id,
                                        "action_id": action_id,
                                        "error": error_msg
                                    })

                            results["shops_processed"] += 1

                        except Exception as e:
                            error_msg = f"Failed to sync shop {shop_id}: {str(e)}"
                            logger_local.error(error_msg, exc_info=True)
                            results["errors"].append({
                                "shop_id": shop_id,
                                "error": error_msg
                            })

                    # 记录完成时间
                    end_time = datetime.utcnow()
                    duration = (end_time - start_time).total_seconds()
                    results["completed_at"] = end_time.isoformat() + "Z"
                    results["duration_seconds"] = duration

                    logger_local.info(
                        f"Promotion sync task completed",
                        extra={
                            "shops_processed": results["shops_processed"],
                            "actions_synced": results["actions_synced"],
                            "candidates_synced": results["candidates_synced"],
                            "products_synced": results["products_synced"],
                            "auto_cancelled": results["auto_cancelled"],
                            "duration_seconds": duration,
                            "error_count": len(results["errors"])
                        }
                    )

                    return results

            except Exception as e:
                logger_local.error("Promotion sync task failed", exc_info=True)
                results["errors"].append({
                    "error": "Task failed",
                    "message": str(e)
                })
                raise

        registry.register(
            service_key="ozon_promotion_sync",
            handler=ozon_promotion_sync_handler,
            name="OZON促销活动同步",
            description="同步所有店铺的促销活动、候选商品和参与商品，并执行自动取消逻辑（每30分钟执行）",
            plugin="ef.channels.ozon",
            config_schema={}
        )
        logger.info("✓ Registered ozon_promotion_sync service handler")

        # 4. 注册OZON商品订单增量同步服务（封装）
        async def ozon_sync_handler(config: Dict[str, Any]) -> Dict[str, Any]:
            """OZON商品订单增量同步处理函数"""
            import uuid
            import logging
            from ef_core.database import get_db_manager
            from .models import OzonShop
            from sqlalchemy import select

            # 获取所有活跃店铺
            total_products = 0
            total_orders = 0
            shops_synced = []

            db_manager = get_db_manager()
            async with db_manager.get_session() as db:
                result = await db.execute(
                    select(OzonShop).where(OzonShop.status == "active")
                )
                shops = result.scalars().all()

                for shop in shops:
                    shop_products = 0
                    shop_orders = 0

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
                        shop_products = product_result.get("result", {}).get("total_synced", 0)
                        total_products += shop_products

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
                        shop_orders = order_result.get("result", {}).get("total_synced", 0)
                        total_orders += shop_orders

                    shops_synced.append({
                        "shop_id": shop.id,
                        "shop_name": shop.shop_name,
                        "products": shop_products,
                        "orders": shop_orders
                    })

            return {
                "records_processed": total_products + total_orders,
                "records_updated": total_products + total_orders,
                "message": f"同步完成：商品{total_products}条，订单{total_orders}条",
                "shops_count": len(shops_synced),
                "total_products": total_products,
                "total_orders": total_orders,
                "shops": shops_synced
            }

        registry.register(
            service_key="ozon_sync_incremental",
            handler=ozon_sync_handler,
            name="OZON增量同步",
            description="自动从OZON拉取商品和订单的增量更新（每30分钟执行一次）",
            plugin="ef.channels.ozon",
            config_schema={
                "sync_products": {
                    "type": "boolean",
                    "default": True,
                    "description": "是否同步商品"
                },
                "sync_orders": {
                    "type": "boolean",
                    "default": True,
                    "description": "是否同步订单"
                }
            }
        )
        logger.info("✓ Registered ozon_sync_incremental service handler")

        # 4. 注册OZON财务交易数据同步服务
        from .services.finance_transactions_sync_service import get_finance_transactions_sync_service
        finance_transactions_service = get_finance_transactions_sync_service()
        registry.register(
            service_key="ozon_finance_transactions_daily",
            handler=finance_transactions_service.sync_transactions,
            name="OZON财务交易同步",
            description="每天自动从OZON同步财务交易数据（默认同步昨天数据，每天UTC 22:00执行=北京时间06:00）",
            plugin="ef.channels.ozon",
            config_schema={
                "target_date": {
                    "type": "string",
                    "format": "date",
                    "description": "目标同步日期（YYYY-MM-DD格式，留空则默认昨天）"
                },
                "shop_id": {
                    "type": "integer",
                    "description": "指定店铺ID（留空则同步所有活跃店铺）"
                }
            }
        )
        logger.info("✓ Registered ozon_finance_transactions_daily service handler")

    except Exception as e:
        logger.info(f"Warning: Failed to register sync service handlers: {e}")
        import traceback
        traceback.print_exc()

    # 注册促销相关定时任务
    try:
        from .tasks.promotion_sync_task import sync_all_promotions, promotion_health_check
        from ef_core.database import get_db_manager

        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            # 注册促销同步任务（使用数据库配置）
            cron, enabled = await _get_task_schedule(db, "ozon_promotion_sync", "*/30 * * * *")
            if enabled and cron:
                await hooks.register_cron(
                    name="ef.ozon.promotions.sync",
                    cron=cron,
                    task=sync_all_promotions
                )

            # 注册健康检查任务（暂无数据库配置，使用默认值）
            await hooks.register_cron(
                name="ef.ozon.promotions.health_check",
                cron="0 * * * *",  # 每小时执行
                task=promotion_health_check
            )

        logger.info("✓ Registered promotion tasks successfully")
    except Exception as e:
        logger.info(f"Warning: Failed to register promotion tasks: {e}")
        import traceback
        traceback.print_exc()

    # 注册其他同步服务的定时任务（统一使用 Celery Beat）
    try:
        from ef_core.database import get_db_manager

        # 1. 跨境巴士物料成本同步
        async def kuajing84_material_cost_task(**kwargs):
            """跨境巴士物料成本同步定时任务"""
            from plugins.ef.system.sync_service.services.handler_registry import get_registry
            registry = get_registry()
            handler = registry.get_handler("kuajing84_material_cost")
            if handler:
                return await handler({})
            else:
                logger.warning("kuajing84_material_cost handler not found")
                return {}

        # 2. OZON财务费用同步
        async def ozon_finance_sync_task(**kwargs):
            """OZON财务费用同步定时任务"""
            from plugins.ef.system.sync_service.services.handler_registry import get_registry
            registry = get_registry()
            handler = registry.get_handler("ozon_finance_sync")
            if handler:
                return await handler({})
            else:
                logger.warning("ozon_finance_sync handler not found")
                return {}

        # 3. OZON财务交易同步
        async def ozon_finance_transactions_task(**kwargs):
            """OZON财务交易同步定时任务"""
            from plugins.ef.system.sync_service.services.handler_registry import get_registry
            registry = get_registry()
            handler = registry.get_handler("ozon_finance_transactions_daily")
            if handler:
                return await handler({})
            else:
                logger.warning("ozon_finance_transactions_daily handler not found")
                return {}

        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            # 注册跨境巴士任务（使用数据库配置）
            cron, enabled = await _get_task_schedule(db, "kuajing84_material_cost", "15 * * * *")
            if enabled and cron:
                await hooks.register_cron(
                    name="ef.ozon.kuajing84.material_cost",
                    cron=cron,
                    task=kuajing84_material_cost_task
                )

            # 注册财务费用同步（使用数据库配置）
            cron, enabled = await _get_task_schedule(db, "ozon_finance_sync", "0 3 * * *")
            if enabled and cron:
                await hooks.register_cron(
                    name="ef.ozon.finance.sync",
                    cron=cron,
                    task=ozon_finance_sync_task
                )

            # 注册财务交易同步（使用数据库配置）
            cron, enabled = await _get_task_schedule(db, "ozon_finance_transactions_daily", "0 22 * * *")
            if enabled and cron:
                await hooks.register_cron(
                    name="ef.ozon.finance.transactions",
                    cron=cron,
                    task=ozon_finance_transactions_task
                )

        logger.info("✓ Registered sync service tasks successfully")
    except Exception as e:
        logger.warning(f"Warning: Failed to register sync service tasks: {e}")
        import traceback
        traceback.print_exc()

    # 注册类目同步定时任务
    try:
        from ef_core.database import get_db_manager

        # 1. 类目树同步
        async def category_sync_task(**kwargs):
            """类目树同步定时任务"""
            from .tasks.scheduled_sync_task import _sync_all_shop_categories
            try:
                logger.info("Starting category tree sync task")
                result = await _sync_all_shop_categories()
                logger.info(f"Category tree sync completed: {result}")
                return result
            except Exception as e:
                logger.error(f"Category tree sync failed: {e}", exc_info=True)
                return {"success": False, "error": str(e)}

        # 2. 类目特征同步
        async def attributes_sync_task(**kwargs):
            """类目特征同步定时任务"""
            from .tasks.scheduled_sync_task import _sync_all_shop_attributes
            try:
                logger.info("Starting category attributes sync task")
                result = await _sync_all_shop_attributes()
                logger.info(f"Category attributes sync completed: {result}")
                return result
            except Exception as e:
                logger.error(f"Category attributes sync failed: {e}", exc_info=True)
                return {"success": False, "error": str(e)}

        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            # 注册类目树同步（使用数据库配置）
            cron, enabled = await _get_task_schedule(db, "ozon_scheduled_category_sync", "0 5 * * 2")
            if enabled and cron:
                await hooks.register_cron(
                    name="ef.ozon.category.sync",
                    cron=cron,
                    task=category_sync_task
                )

            # 注册类目特征同步（使用数据库配置）
            cron, enabled = await _get_task_schedule(db, "ozon_scheduled_attributes_sync", "30 5 * * 2")
            if enabled and cron:
                await hooks.register_cron(
                    name="ef.ozon.attributes.sync",
                    cron=cron,
                    task=attributes_sync_task
                )

        logger.info("✓ Registered category sync tasks successfully")
    except Exception as e:
        logger.warning(f"Warning: Failed to register category sync tasks: {e}")
        import traceback
        traceback.print_exc()

    # 配置信息已在上面打印


async def pull_orders_task(**kwargs) -> None:
    """
    拉取 Ozon 订单的定时任务
    使用 OrderSyncService 进行批量处理（避免 N+1 查询问题）
    """
    try:
        from ef_core.database import get_db_manager
        from .models import OzonShop
        from .api.client import OzonAPIClient
        from .services.order_sync import OrderSyncService
        from sqlalchemy import select

        current_time = datetime.now(UTC)
        logger.info(f"[{current_time.isoformat()}] Pulling orders from Ozon...")

        # 获取所有活跃店铺
        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active")
            )
            shops_orm = result.scalars().all()

            # 立即提取所有店铺信息到字典，避免懒加载
            shops = []
            for shop in shops_orm:
                shops.append({
                    'id': shop.id,
                    'shop_name': shop.shop_name,
                    'client_id': shop.client_id,
                    'api_key_enc': shop.api_key_enc
                })

        # 对每个店铺执行订单同步
        for shop_data in shops:
            shop_id = shop_data['id']
            shop_name = shop_data['shop_name']
            try:
                # 创建API客户端
                client = OzonAPIClient(
                    client_id=shop_data['client_id'],
                    api_key=shop_data['api_key_enc']
                )

                # 使用 OrderSyncService 执行批量同步
                sync_service = OrderSyncService(shop_id=shop_id, api_client=client)

                # 计算时间范围（最近24小时的订单）
                date_from = current_time - timedelta(days=1)
                date_to = current_time

                # 执行同步（批量处理，每批50条，无 N+1 问题）
                stats = await sync_service.sync_orders(
                    date_from=date_from,
                    date_to=date_to,
                    full_sync=False
                )

                logger.info(
                    f"[{shop_name}] Order sync completed",
                    extra={
                        "shop_id": shop_id,
                        "total_processed": stats["total_processed"],
                        "success": stats["success"],
                        "failed": stats["failed"]
                    }
                )

                await client.close()

            except Exception as e:
                logger.error(f"Error pulling orders for shop {shop_name}: {e}")

    except Exception as e:
        logger.error(f"Error pulling orders: {e}")


async def sync_inventory_task(**kwargs) -> None:
    """
    同步库存的定时任务
    """
    try:
        from ef_core.database import get_db_manager
        from .models import OzonShop, OzonProduct
        from .api.client import OzonAPIClient
        from sqlalchemy import select

        current_time = datetime.now(UTC)
        logger.info(f"[{current_time.isoformat()}] Syncing inventory to Ozon...")

        # 获取所有活跃店铺
        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active")
            )
            shops_orm = result.scalars().all()

            # 立即提取所有店铺信息到字典，避免懒加载
            shops = []
            for shop in shops_orm:
                shops.append({
                    'id': shop.id,
                    'shop_name': shop.shop_name,
                    'client_id': shop.client_id,
                    'api_key_enc': shop.api_key_enc
                })

            for shop_data in shops:
                shop_id = shop_data['id']
                shop_name = shop_data['shop_name']
                try:
                    # 创建API客户端
                    client = OzonAPIClient(
                        client_id=shop_data['client_id'],
                        api_key=shop_data['api_key_enc']
                    )

                    # 获取该店铺所有需要同步库存的商品
                    products_result = await db.execute(
                        select(OzonProduct).where(
                            OzonProduct.shop_id == shop_id,
                            OzonProduct.status == "active"
                        ).limit(100)  # 批量处理，每次最多100个
                    )
                    products_orm = products_result.scalars().all()

                    # 立即提取商品信息到字典，避免懒加载
                    products_data = []
                    product_ids = []
                    for product in products_orm:
                        offer_id = product.offer_id
                        stock = product.stock
                        ozon_product_id = product.ozon_product_id
                        if offer_id and stock is not None:
                            products_data.append({
                                "offer_id": offer_id,
                                "product_id": ozon_product_id,
                                "stock": int(stock),
                                "warehouse_id": 1  # 默认仓库ID
                            })
                            product_ids.append(product.id)

                    if products_data:
                        # 批量更新库存到Ozon
                        stock_update = {
                            "stocks": products_data
                        }

                        result = await client.update_stocks(stock_update)

                        if result.get("result"):
                            # 更新本地同步状态（重新查询以避免使用detached对象）
                            for product_id in product_ids:
                                product_update = await db.execute(
                                    select(OzonProduct).where(OzonProduct.id == product_id)
                                )
                                product = product_update.scalar_one_or_none()
                                if product:
                                    product.sync_status = "success"
                                    product.last_sync_at = current_time

                            await db.commit()
                            logger.info(f"[{shop_name}] Synced inventory for {len(products_data)} products")
                        else:
                            logger.info(f"[{shop_name}] Failed to sync inventory: {result}")

                    await client.close()

                except Exception as e:
                    logger.info(f"Error syncing inventory for shop {shop_name}: {e}")

    except Exception as e:
        logger.info(f"Error syncing inventory: {e}")


async def handle_shipment_request(payload: Dict[str, Any]) -> None:
    """
    处理发货请求事件

    Args:
        payload: 事件载荷，包含订单和发货信息
    """
    try:
        from ef_core.database import get_db_manager
        from .models import OzonShop, OzonOrder
        from .api.client import OzonAPIClient
        from sqlalchemy import select

        order_id = payload.get("order_id")
        tracking_number = payload.get("tracking_number")
        carrier = payload.get("carrier", "OTHER")

        if not order_id or not tracking_number:
            logger.info("Invalid shipment request: missing order_id or tracking_number")
            return

        logger.info(f"Processing shipment for order {order_id} with tracking {tracking_number}")

        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            # 查找订单（通过本地订单号或 Ozon 订单号）
            order_result = await db.execute(
                select(OzonOrder).where(
                    (OzonOrder.order_id == order_id) |
                    (OzonOrder.ozon_order_id == order_id) |
                    (OzonOrder.ozon_order_number == order_id)
                )
            )
            order = order_result.scalar_one_or_none()

            # 如果还没找到，尝试通过 posting_number 查找
            if not order:
                from plugins.ef.channels.ozon.models.orders import OzonPosting
                posting_result = await db.execute(
                    select(OzonPosting).where(OzonPosting.posting_number == order_id)
                )
                posting = posting_result.scalar_one_or_none()
                if posting:
                    order_result = await db.execute(
                        select(OzonOrder).where(OzonOrder.id == posting.order_id)
                    )
                    order = order_result.scalar_one_or_none()

            if not order:
                logger.info(f"Order {order_id} not found in database")
                return

            # 验证订单状态
            if order.status not in ["awaiting_packaging", "awaiting_deliver"]:
                logger.info(f"Order {order_id} is not ready for shipment. Status: {order.status}")
                return

            # 获取店铺信息
            shop_result = await db.execute(
                select(OzonShop).where(OzonShop.id == order.shop_id)
            )
            shop = shop_result.scalar_one_or_none()

            if not shop:
                logger.info(f"Shop {order.shop_id} not found")
                return

            # 创建API客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc
            )

            # 准备发货数据
            packages = []
            for item in order.items or []:
                packages.append({
                    "quantity": item.get("quantity", 1),
                    "sku": item.get("sku", "")
                })

            shipment_data = {
                "packages": [{
                    "products": packages
                }],
                "posting_number": order.posting_number,
                "tracking_number": tracking_number
            }

            # 调用Ozon API推送发货信息
            result = await client.ship_order(shipment_data)

            if result.get("result"):
                # 更新本地发货状态
                order.status = "delivering"
                order.tracking_number = tracking_number
                order.updated_at = datetime.now(UTC)
                await db.commit()

                logger.info(f"Successfully shipped order {order_id}")
            else:
                logger.info(f"Failed to ship order {order_id}: {result}")

            await client.close()

    except Exception as e:
        logger.info(f"Error handling shipment request: {e}")


async def handle_inventory_change(payload: Dict[str, Any]) -> None:
    """
    处理库存变更事件
    
    Args:
        payload: 事件载荷，包含 SKU 和库存变更信息
    """
    try:
        sku = payload.get("sku")
        quantity = payload.get("quantity")
        
        if not sku:
            logger.info("Invalid inventory change: missing sku")
            return
        
        from ef_core.database import get_db_manager
        from .models import OzonShop, OzonProduct
        from .api.client import OzonAPIClient
        from sqlalchemy import select

        logger.info(f"Processing inventory change for SKU {sku}: {quantity}")

        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            # 查找商品
            shop_id = payload.get("shop_id")  # 必须明确指定店铺ID
            if not shop_id:
                raise ValueError("shop_id is required")
            product_result = await db.execute(
                select(OzonProduct).where(
                    OzonProduct.shop_id == shop_id,
                    OzonProduct.sku == sku
                )
            )
            product = product_result.scalar_one_or_none()

            if not product:
                logger.info(f"Product with SKU {sku} not found")
                return

            # 获取店铺信息
            shop_result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop = shop_result.scalar_one_or_none()

            if not shop:
                logger.info(f"Shop {shop_id} not found")
                return

            # 创建API客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc
            )

            # 计算实际可售库存（可以根据业务逻辑调整）
            available_stock = max(0, int(quantity))  # 确保库存非负

            # 准备库存更新数据
            stock_data = {
                "stocks": [{
                    "offer_id": product.offer_id,
                    "product_id": product.ozon_product_id,
                    "stock": available_stock,
                    "warehouse_id": 1  # 默认仓库ID
                }]
            }

            # 调用Ozon API更新库存
            result = await client.update_stocks(stock_data)

            if result.get("result"):
                # 更新本地库存记录
                product.stock = available_stock
                product.available = available_stock
                product.sync_status = "success"
                product.last_sync_at = datetime.now(UTC)
                await db.commit()

                logger.info(f"Successfully updated inventory for SKU {sku} to {available_stock}")
            else:
                # 记录同步失败
                product.sync_status = "failed"
                product.sync_error = str(result)
                await db.commit()
                logger.info(f"Failed to update inventory for SKU {sku}: {result}")

            await client.close()
        
    except Exception as e:
        logger.info(f"Error handling inventory change: {e}")


async def teardown() -> None:
    """
    插件清理函数（可选）
    在插件关闭时调用
    """
    logger.info("Ozon plugin shutting down...")

    try:
        from ef_core.database import get_db_manager
        from .models import OzonShop
        from sqlalchemy import select, update, func

        # 关闭所有活跃的API客户端连接
        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            # 更新所有店铺的同步状态
            await db.execute(
                update(OzonShop)
                .where(OzonShop.status == "active")
                .values(
                    stats=func.jsonb_set(
                        OzonShop.stats,
                        '{sync_status}',
                        '"stopped"',
                        True
                    )
                )
            )
            await db.commit()
            logger.info("Updated all shops sync status to stopped")

        # 取消所有待处理的异步任务
        pending_tasks = asyncio.all_tasks()
        for task in pending_tasks:
            if not task.done() and task != asyncio.current_task():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        logger.info("Cancelled all pending tasks")

    except Exception as e:
        logger.info(f"Error during teardown: {e}")

    logger.info("Ozon plugin shutdown complete")