"""
OZON插件 - Handler注册（模块级别，import时自动执行）
"""
from typing import Dict, Any
import logging
logger = logging.getLogger(__name__)


def register_ozon_handlers():
    """注册OZON插件的所有sync service handlers到全局注册表"""
    try:
        from plugins.ef.system.sync_service.services.handler_registry import get_registry
        from .services.kuajing84_material_cost_sync_service import get_kuajing84_material_cost_sync_service
        from .services.ozon_sync import OzonSyncService
        from .services.ozon_finance_sync_service import get_ozon_finance_sync_service
        from .models import OzonShop
        from ef_core.database import get_db_manager
        from sqlalchemy import select
        import uuid

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

        # 3. 注册OZON商品订单增量同步服务（封装）
        async def ozon_sync_handler(config: Dict[str, Any]) -> Dict[str, Any]:
            """OZON商品订单增量同步处理函数"""
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

        # 4. 注册OZON类目树定时同步服务
        async def category_sync_handler(config: Dict[str, Any]) -> Dict[str, Any]:
            """OZON类目树同步处理函数"""
            from .tasks.scheduled_sync_task import _sync_all_shop_categories

            result = await _sync_all_shop_categories()

            if result.get("success"):
                return {
                    "records_processed": result.get("total_categories", 0),
                    "records_updated": result.get("updated_categories", 0) + result.get("new_categories", 0),
                    "message": f"类目同步完成：共{result.get('total_categories', 0)}个类目，新增{result.get('new_categories', 0)}个，更新{result.get('updated_categories', 0)}个，废弃{result.get('deprecated_categories', 0)}个"
                }
            else:
                raise Exception(result.get("error", "Unknown error"))

        registry.register(
            service_key="ozon_scheduled_category_sync",
            handler=category_sync_handler,
            name="OZON类目树定时同步",
            description="每天凌晨4:00自动同步类目树（使用第一家启用店铺，数据为平台级）",
            plugin="ef.channels.ozon",
            config_schema={}
        )
        logger.info("✓ Registered ozon_scheduled_category_sync service handler")

        # 5. 注册OZON类目特征定时同步服务
        async def attributes_sync_handler(config: Dict[str, Any]) -> Dict[str, Any]:
            """OZON类目特征同步处理函数"""
            from .tasks.scheduled_sync_task import _sync_all_shop_attributes

            result = await _sync_all_shop_attributes()

            if result.get("success"):
                return {
                    "records_processed": result.get("synced_categories", 0),
                    "records_updated": result.get("synced_attributes", 0),
                    "message": f"特征同步完成：{result.get('synced_categories', 0)}个类目，{result.get('synced_attributes', 0)}个特征，{result.get('synced_values', 0)}个字典值"
                }
            else:
                raise Exception(result.get("error", "Unknown error"))

        registry.register(
            service_key="ozon_scheduled_attributes_sync",
            handler=attributes_sync_handler,
            name="OZON类目特征定时同步",
            description="每周二凌晨4:10自动同步类目特征和字典值（使用第一家启用店铺，数据为平台级）",
            plugin="ef.channels.ozon",
            config_schema={}
        )
        logger.info("✓ Registered ozon_scheduled_attributes_sync service handler")

        logger.info(f"OZON plugin: Successfully registered 5 sync service handlers")

    except Exception as e:
        logger.info(f"OZON plugin: Warning - Failed to register sync service handlers: {e}")
        import traceback
        traceback.print_exc()


# 模块级别调用 - import时自动执行
register_ozon_handlers()
