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
        logger.error(f"OZON ROUTER IMPORT ERROR: {e}", exc_info=True)

        if 'plugins.ef.channels.ozon.api.routes' in sys.modules:
            try:
                from .api.routes import router
                logger.info("Successfully recovered router from sys.modules")
                return router
            except Exception as recovery_error:
                logger.error(f"Failed to recover router: {recovery_error}")

        return None
    except Exception as e:
        logger.error(f"OZON ROUTER UNEXPECTED ERROR: {e}", exc_info=True)
        return None


async def category_sync_task(**kwargs):
    """类目树同步定时任务"""
    from .models.ozon_shops import OzonShop
    from .api.client import OzonAPIClient
    from .services.catalog_service import CatalogService
    from ef_core.database import get_task_db_manager
    from sqlalchemy import select

    logger.info("Starting category tree sync task")

    try:
        db_manager = get_task_db_manager()
        async with db_manager.get_session() as db:
            # 获取第一家启用的店铺
            result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active").limit(1)
            )
            shop = result.scalar_one_or_none()

            if not shop:
                logger.warning("No active shop found for category sync")
                return {"success": False, "error": "No active shop available"}

            logger.info(f"Using shop {shop.id} ({shop.shop_name}) for category sync")

            # 创建 API 客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            # 创建目录服务
            catalog_service = CatalogService(client, db)

            # 同步类目树（强制刷新）
            sync_result = await catalog_service.sync_category_tree(force_refresh=True)

            # 关闭客户端
            await client.close()

            if sync_result.get("success"):
                logger.info(
                    f"Category sync completed: "
                    f"{sync_result.get('total_categories')} total, "
                    f"{sync_result.get('new_categories')} new, "
                    f"{sync_result.get('updated_categories')} updated"
                )
                return sync_result
            else:
                error = sync_result.get("error", "Unknown error")
                logger.error(f"Category sync failed: {error}")
                return {"success": False, "error": error}

    except Exception as e:
        logger.error(f"Category tree sync failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def attributes_sync_task(**kwargs):
    """类目特征同步定时任务"""
    from .models.ozon_shops import OzonShop
    from .api.client import OzonAPIClient
    from .services.catalog_service import CatalogService
    from ef_core.database import get_task_db_manager
    from sqlalchemy import select

    logger.info("Starting category attributes sync task")

    try:
        db_manager = get_task_db_manager()
        async with db_manager.get_session() as db:
            # 获取第一家启用的店铺
            result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active").limit(1)
            )
            shop = result.scalar_one_or_none()

            if not shop:
                logger.warning("No active shop found for attributes sync")
                return {"success": False, "error": "No active shop available"}

            logger.info(f"Using shop {shop.id} ({shop.shop_name}) for attributes sync")

            # 创建 API 客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            # 创建目录服务
            catalog_service = CatalogService(client, db)

            # 同步所有叶子类目的特征（包括字典值）
            # 注意：强制串行执行，避免并发导致的数据库锁竞争问题
            sync_result = await catalog_service.batch_sync_category_attributes(
                category_ids=None,
                sync_all_leaf=True,
                sync_dictionary_values=True,
                language="ZH_HANS"
            )

            # 关闭客户端
            await client.close()

            if sync_result.get("success"):
                logger.info(
                    f"Attributes sync completed: "
                    f"{sync_result.get('synced_categories')} categories, "
                    f"{sync_result.get('synced_attributes')} attributes"
                )
                return sync_result
            else:
                error = sync_result.get("error", "Unknown error")
                logger.error(f"Attributes sync failed: {error}")
                return {"success": False, "error": error}

    except Exception as e:
        logger.error(f"Category attributes sync failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def setup(hooks) -> None:
    """插件初始化函数"""

    # 注册定时任务：拉取订单（每小时第15分钟，同步最近6小时）
    await hooks.register_cron(
        name="ef.ozon.orders.pull",
        cron="15 * * * *",
        task=pull_orders_task,
        display_name="OZON 订单同步",
        description="从 OZON 平台拉取最近6小时的订单数据"
    )

    # 注册定时任务：同步商品（每小时第50分钟，同步最近6小时）
    await hooks.register_cron(
        name="ef.ozon.products.pull",
        cron="50 * * * *",
        task=pull_products_task,
        display_name="OZON 商品同步",
        description="从 OZON 平台拉取最近6小时更新的商品数据"
    )

    # 注册定时任务：同步库存（每小时第20和50分钟）
    await hooks.register_cron(
        name="ef.ozon.inventory.sync",
        cron="20,50 * * * *",
        task=sync_inventory_task,
        display_name="OZON 库存同步",
        description="从 OZON 平台同步商品库存数据"
    )

    # 注册定时任务：标签预缓存（每5分钟）
    # 预先下载待打印订单的标签PDF，打印时直接读取本地文件
    # 注意：传入异步函数，由 register_cron 统一包装为 Celery Task
    from .tasks.label_prefetch_task import prefetch_labels_async, cleanup_labels_async
    await hooks.register_cron(
        name="ef.ozon.labels.prefetch",
        cron="*/5 * * * *",
        task=prefetch_labels_async,
        display_name="标签预缓存",
        description="预先下载待打印订单的标签 PDF"
    )

    # 注册定时任务：标签缓存清理（每天凌晨4点执行）
    # 清理超过7天的标签PDF文件，释放磁盘空间
    await hooks.register_cron(
        name="ef.ozon.labels.cleanup",
        cron="0 4 * * *",
        task=cleanup_labels_async,
        display_name="标签缓存清理",
        description="清理超过7天的标签 PDF 文件"
    )

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
            from ef_core.database import get_task_db_manager
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

            db_manager = get_task_db_manager()

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
            from ef_core.database import get_task_db_manager
            from .models import OzonShop
            from sqlalchemy import select

            # 获取所有活跃店铺
            total_products = 0
            total_orders = 0
            shops_synced = []

            db_manager = get_task_db_manager()
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
        logger.warning(f"Failed to register sync service handlers: {e}", exc_info=True)

    # 注册OZON取消和退货申请同步服务（独立try块避免被其他错误影响）
    try:
        from plugins.ef.system.sync_service.services.handler_registry import get_registry
        from .services.cancel_return_service import CancelReturnService

        registry = get_registry()
        cancel_return_service = CancelReturnService()

        # 6. 注册OZON取消申请同步服务
        registry.register(
            service_key="ozon_cancellations_sync",
            handler=cancel_return_service.sync_cancellations,
            name="OZON取消申请同步",
            description="同步所有店铺的取消申请数据（每小时执行）",
            plugin="ef.channels.ozon",
            config_schema={}
        )
        logger.info("✓ Registered ozon_cancellations_sync service handler")

        # 7. 注册OZON退货申请同步服务
        registry.register(
            service_key="ozon_returns_sync",
            handler=cancel_return_service.sync_returns,
            name="OZON退货申请同步",
            description="同步所有店铺的退货申请数据（每小时执行）",
            plugin="ef.channels.ozon",
            config_schema={}
        )
        logger.info("✓ Registered ozon_returns_sync service handler")

    except Exception as e:
        logger.warning(f"Failed to register cancel/return service handlers: {e}", exc_info=True)

    # 注册促销相关定时任务
    try:
        from .tasks.promotion_sync_task import sync_all_promotions, promotion_health_check

        # 注册促销同步任务（每小时第25和55分钟）
        await hooks.register_cron(
            name="ef.ozon.promotions.sync",
            cron="25,55 * * * *",
            task=sync_all_promotions,
            display_name="OZON 促销同步",
            description="同步 OZON 平台的促销活动数据"
        )

        # 注册健康检查任务（每小时第2分钟）
        await hooks.register_cron(
            name="ef.ozon.promotions.health_check",
            cron="2 * * * *",
            task=promotion_health_check,
            display_name="促销系统健康检查",
            description="检查促销同步系统的运行状态"
        )

        logger.info("Registered promotion tasks successfully")
    except Exception as e:
        logger.warning(f"Failed to register promotion tasks: {e}", exc_info=True)

    # 注册其他同步服务的定时任务（统一使用 Celery Beat）
    try:
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

        # 注册跨境巴士任务（每小时第15分钟执行）
        await hooks.register_cron(
            name="ef.ozon.kuajing84.material_cost",
            cron="15 * * * *",
            task=kuajing84_material_cost_task,
            display_name="跨境巴士物料成本同步",
            description="从跨境巴士查询并更新已打包订单的物料成本"
        )

        # 注册财务费用同步（每天凌晨3:15）
        await hooks.register_cron(
            name="ef.ozon.finance.sync",
            cron="15 3 * * *",
            task=ozon_finance_sync_task,
            display_name="OZON 财务费用同步",
            description="同步已完成订单的财务费用明细（佣金、物流等）"
        )

        # 注册财务交易同步（每天UTC 22:00 = 北京时间06:00）
        await hooks.register_cron(
            name="ef.ozon.finance.transactions",
            cron="0 22 * * *",
            task=ozon_finance_transactions_task,
            display_name="OZON 财务交易同步",
            description="同步 OZON 平台的财务交易记录"
        )

        logger.info("Registered sync service tasks successfully")
    except Exception as e:
        logger.warning(f"Failed to register sync service tasks: {e}", exc_info=True)

    # 注册类目同步定时任务
    try:
        # 注册类目树同步（每周二凌晨5:00北京时间 = 每周一晚上21:00 UTC）
        await hooks.register_cron(
            name="ef.ozon.category.sync",
            cron="0 21 * * 1",
            task=category_sync_task,
            display_name="OZON 类目树同步",
            description="同步 OZON 平台的商品类目树结构"
        )

        # 注册类目特征同步（每周二凌晨5:30北京时间 = 每周一晚上21:30 UTC）
        await hooks.register_cron(
            name="ef.ozon.attributes.sync",
            cron="30 21 * * 1",
            task=attributes_sync_task,
            display_name="OZON 类目特征同步",
            description="同步 OZON 平台的类目属性和特征"
        )

        logger.info("Registered category sync tasks successfully")
    except Exception as e:
        logger.warning(f"Failed to register category sync tasks: {e}", exc_info=True)

    # 注册草稿清理定时任务
    try:
        async def cleanup_drafts_task(**kwargs):
            """清理过期草稿定时任务（30天未更新）"""
            from ef_core.database import get_task_db_manager
            from .services.draft_template_service import DraftTemplateService

            logger.info("Starting draft cleanup task")
            try:
                db_manager = get_task_db_manager()
                async with db_manager.get_session() as db:
                    deleted_count = await DraftTemplateService.cleanup_old_drafts(db, days=30)
                    logger.info(f"Draft cleanup completed: deleted {deleted_count} old drafts")
                    return {"success": True, "deleted_count": deleted_count}
            except Exception as e:
                logger.error(f"Draft cleanup failed: {e}", exc_info=True)
                return {"success": False, "error": str(e)}

        # 注册草稿清理任务（每天凌晨2:10执行）
        await hooks.register_cron(
            name="ef.ozon.drafts.cleanup",
            cron="10 2 * * *",
            task=cleanup_drafts_task,
            display_name="草稿清理",
            description="清理超过30天未更新的商品草稿"
        )

        logger.info("Registered draft cleanup task successfully")
    except Exception as e:
        logger.warning(f"Failed to register draft cleanup task: {e}", exc_info=True)

    # 注册采集记录上架状态轮询任务
    try:
        from .tasks.collection_listing_tasks import poll_listing_status_async

        # 注册轮询任务（每10分钟执行一次）
        await hooks.register_cron(
            name="ef.ozon.collection.poll_listing_status",
            cron="*/10 * * * *",
            task=poll_listing_status_async,
            display_name="采集记录上架状态轮询",
            description="轮询检查采集商品在 OZON 的上架状态"
        )

        logger.info("Registered collection listing status polling task successfully")
    except Exception as e:
        logger.warning(f"Failed to register collection listing polling task: {e}", exc_info=True)

    # 注册取消和退货申请同步任务
    try:
        from .services.cancel_return_service import CancelReturnService

        # 创建取消申请同步任务
        async def cancellations_sync_task(**kwargs):
            """取消申请同步定时任务"""
            service = CancelReturnService()
            try:
                logger.info("Starting cancellations sync task")
                result = await service.sync_cancellations({})
                logger.info(f"Cancellations sync completed: {result.get('message', '')}")
                return result
            except Exception as e:
                logger.error(f"Cancellations sync failed: {e}", exc_info=True)
                return {"success": False, "error": str(e)}

        # 创建退货申请同步任务
        async def returns_sync_task(**kwargs):
            """退货申请同步定时任务"""
            service = CancelReturnService()
            try:
                logger.info("Starting returns sync task")
                result = await service.sync_returns({})
                logger.info(f"Returns sync completed: {result.get('message', '')}")
                return result
            except Exception as e:
                logger.error(f"Returns sync failed: {e}", exc_info=True)
                return {"success": False, "error": str(e)}

        # 注册取消申请同步任务（每小时第7分钟执行）
        await hooks.register_cron(
            name="ef.ozon.cancellations.sync",
            cron="7 * * * *",
            task=cancellations_sync_task,
            display_name="取消申请同步",
            description="同步 OZON 平台的订单取消申请"
        )

        # 注册退货申请同步任务（每小时第12分钟执行）
        await hooks.register_cron(
            name="ef.ozon.returns.sync",
            cron="12 * * * *",
            task=returns_sync_task,
            display_name="退货申请同步",
            description="同步 OZON 平台的订单退货申请"
        )

        logger.info("Registered cancel and return sync tasks successfully")
    except Exception as e:
        logger.warning(f"Failed to register cancel and return sync tasks: {e}", exc_info=True)

    # 注册每日统计聚合任务
    try:
        from .tasks.stats_aggregation_task import _aggregate_stats

        # 创建异步包装任务
        async def daily_stats_aggregation_task(**kwargs):
            """每日统计聚合定时任务"""
            logger.info("Starting daily stats aggregation task")
            try:
                # 直接调用异步聚合函数（不通过 Celery 子任务，避免 result.get() 问题）
                task_result = await _aggregate_stats()
                logger.info(f"Daily stats aggregation completed: {task_result}")
                return task_result
            except Exception as e:
                logger.error(f"Daily stats aggregation failed: {e}", exc_info=True)
                return {"success": False, "error": str(e)}

        # 注册每日统计聚合任务（UTC 14:00 = 北京时间 22:00）
        await hooks.register_cron(
            name="ef.ozon.stats.daily_aggregation",
            cron="0 14 * * *",
            task=daily_stats_aggregation_task,
            display_name="每日统计聚合",
            description="聚合计算 OZON 订单的每日统计数据"
        )

        logger.info("Registered daily stats aggregation task successfully")
    except Exception as e:
        logger.warning(f"Failed to register daily stats aggregation task: {e}", exc_info=True)

    # 配置信息已在上面打印


async def pull_products_task(**kwargs) -> None:
    """
    拉取 Ozon 商品的定时任务（每小时第50分钟，同步最近6小时）
    """
    try:
        from ef_core.database import get_task_db_manager
        from .models import OzonShop
        from .services.ozon_sync import OzonSyncService
        from sqlalchemy import select
        import uuid

        current_time = datetime.now(UTC)
        logger.info(f"[{current_time.isoformat()}] Starting OZON product sync task...")

        db_manager = get_task_db_manager()

        async with db_manager.get_session() as db:
            # 获取所有活跃店铺
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
                })

        logger.info(f"Product sync: {len(shops)} shops")

        # 统计
        total_products_synced = 0

        # 对每个店铺执行同步
        for shop_data in shops:
            shop_id = shop_data['id']
            shop_name = shop_data['shop_name']

            try:
                async with db_manager.get_session() as db:
                    task_id = f"product_sync_{shop_id}_{uuid.uuid4().hex[:8]}"
                    result = await OzonSyncService.sync_products(
                        shop_id=shop_id,
                        db=db,
                        task_id=task_id,
                        mode="incremental"
                    )
                    sync_result = result.get("result", {})
                    products_synced = sync_result.get("total_synced", 0)
                    total_products_synced += products_synced
                    logger.info(
                        f"[{shop_name}] Product sync completed",
                        extra={
                            "shop_id": shop_id,
                            "products_synced": products_synced
                        }
                    )
            except Exception as e:
                logger.error(f"Error syncing products for shop {shop_name}: {e}")

        logger.info(f"OZON product sync task completed: {total_products_synced} products synced")

    except Exception as e:
        logger.error(f"Error in OZON product sync task: {e}")


async def pull_orders_task(**kwargs) -> None:
    """
    拉取 Ozon 订单的定时任务（每小时第15分钟，同步最近6小时）
    """
    try:
        from ef_core.database import get_task_db_manager
        from .models import OzonShop
        from .services.sync.order_sync import OrderSyncService
        from sqlalchemy import select
        import uuid

        current_time = datetime.now(UTC)
        logger.info(f"[{current_time.isoformat()}] Starting OZON order sync task...")

        db_manager = get_task_db_manager()

        async with db_manager.get_session() as db:
            # 获取所有活跃店铺
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
                })

        logger.info(f"Order sync: {len(shops)} shops")

        # 统计
        total_orders_synced = 0

        # 对每个店铺执行同步
        for shop_data in shops:
            shop_id = shop_data['id']
            shop_name = shop_data['shop_name']

            try:
                async with db_manager.get_session() as db:
                    task_id = f"order_sync_{shop_id}_{uuid.uuid4().hex[:8]}"
                    sync_service = OrderSyncService()
                    result = await sync_service.sync_orders(
                        shop_id=shop_id,
                        db=db,
                        task_id=task_id,
                        mode="incremental"
                    )

                    sync_result = result.get("result", {})
                    orders_synced = sync_result.get("total_synced", 0)
                    total_orders_synced += orders_synced
                    logger.info(
                        f"[{shop_name}] Order sync completed",
                        extra={
                            "shop_id": shop_id,
                            "orders_synced": orders_synced
                        }
                    )

            except Exception as e:
                logger.error(f"Error pulling orders for shop {shop_name}: {e}")

        logger.info(f"OZON order sync task completed: {total_orders_synced} orders synced")

    except Exception as e:
        logger.error(f"Error in OZON order sync task: {e}")


async def sync_inventory_task(**kwargs) -> None:
    """
    同步库存的定时任务
    """
    try:
        from ef_core.database import get_task_db_manager
        from .models import OzonShop, OzonProduct
        from .api.client import OzonAPIClient
        from sqlalchemy import select

        current_time = datetime.now(UTC)
        logger.info(f"[{current_time.isoformat()}] Syncing inventory to Ozon...")

        # 获取所有活跃店铺
        db_manager = get_task_db_manager()
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
                            logger.warning(f"[{shop_name}] Failed to sync inventory: {result}")

                    await client.close()

                except Exception as e:
                    logger.error(f"Error syncing inventory for shop {shop_name}: {e}", exc_info=True)

    except Exception as e:
        logger.error(f"Error syncing inventory: {e}", exc_info=True)


async def handle_shipment_request(payload: Dict[str, Any]) -> None:
    """
    处理发货请求事件

    Args:
        payload: 事件载荷，包含订单和发货信息
    """
    try:
        from ef_core.database import get_task_db_manager
        from .models import OzonShop
        from .models.orders import OzonPosting
        from .api.client import OzonAPIClient
        from sqlalchemy import select, or_

        order_id = payload.get("order_id")
        tracking_number = payload.get("tracking_number")
        carrier = payload.get("carrier", "OTHER")

        if not order_id or not tracking_number:
            logger.warning("Invalid shipment request: missing order_id or tracking_number")
            return

        logger.info(f"Processing shipment for order {order_id} with tracking {tracking_number}")

        db_manager = get_task_db_manager()
        async with db_manager.get_session() as db:
            # 查找发货单（通过 posting_number 或 ozon_order_id）
            posting_result = await db.execute(
                select(OzonPosting).where(
                    or_(
                        OzonPosting.posting_number == order_id,
                        OzonPosting.ozon_order_id == order_id
                    )
                )
            )
            posting = posting_result.scalar_one_or_none()

            if not posting:
                logger.warning(f"Posting {order_id} not found in database")
                return

            # 验证发货单状态
            if posting.status not in ["awaiting_packaging", "awaiting_deliver"]:
                logger.warning(f"Posting {order_id} is not ready for shipment. Status: {posting.status}")
                return

            # 获取店铺信息
            shop_result = await db.execute(
                select(OzonShop).where(OzonShop.id == posting.shop_id)
            )
            shop = shop_result.scalar_one_or_none()

            if not shop:
                logger.warning(f"Shop {posting.shop_id} not found")
                return

            # 创建API客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc
            )

            # 准备发货数据（从 raw_payload 获取商品信息）
            packages = []
            raw_products = posting.raw_payload.get("products", []) if posting.raw_payload else []
            for item in raw_products:
                packages.append({
                    "quantity": item.get("quantity", 1),
                    "sku": item.get("sku", "")
                })

            shipment_data = {
                "packages": [{
                    "products": packages
                }],
                "posting_number": posting.posting_number,
                "tracking_number": tracking_number
            }

            # 调用Ozon API推送发货信息
            result = await client.ship_order(shipment_data)

            if result.get("result"):
                # 更新本地发货状态
                posting.status = "delivering"
                posting.updated_at = datetime.now(UTC)
                await db.commit()

                logger.info(f"Successfully shipped posting {posting.posting_number}")
            else:
                logger.warning(f"Failed to ship posting {posting.posting_number}: {result}")

            await client.close()

    except Exception as e:
        logger.error(f"Error handling shipment request: {e}", exc_info=True)


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
            logger.warning("Invalid inventory change: missing sku")
            return
        
        from ef_core.database import get_task_db_manager
        from .models import OzonShop, OzonProduct
        from .api.client import OzonAPIClient
        from sqlalchemy import select

        logger.info(f"Processing inventory change for SKU {sku}: {quantity}")

        db_manager = get_task_db_manager()
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
                logger.warning(f"Product with SKU {sku} not found")
                return

            # 获取店铺信息
            shop_result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop = shop_result.scalar_one_or_none()

            if not shop:
                logger.warning(f"Shop {shop_id} not found")
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
                logger.warning(f"Failed to update inventory for SKU {sku}: {result}")

            await client.close()

    except Exception as e:
        logger.error(f"Error handling inventory change: {e}", exc_info=True)


async def teardown() -> None:
    """
    插件清理函数（可选）
    在插件关闭时调用
    """
    logger.info("Ozon plugin shutting down...")

    try:
        from ef_core.database import get_task_db_manager
        from .models import OzonShop
        from sqlalchemy import select, update, func

        # 关闭所有活跃的API客户端连接
        db_manager = get_task_db_manager()
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
        logger.error(f"Error during teardown: {e}", exc_info=True)

    logger.info("Ozon plugin shutdown complete")