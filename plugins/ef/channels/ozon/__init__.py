"""
EuraFlow Ozon Channel Plugin
面向 Ozon 平台的订单拉取、发货推送、库存同步等功能
"""
import asyncio
from typing import Optional, Dict, Any
from datetime import datetime, UTC
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
    except ImportError:
        return None


async def setup(hooks) -> None:
    """插件初始化函数"""
    # 从数据库获取Ozon店铺配置
    try:
        from ef_core.database import get_async_session
        from .models import OzonShop
        from sqlalchemy import select
        
        async for db in get_async_session():
            # 获取第一个激活的Ozon店铺
            result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active").limit(1)
            )
            shop = result.scalar_one_or_none()
            
            if not shop:
                print("Warning: No active Ozon shop found, plugin running in standby mode")
                # 仍然注册任务，但会在执行时检查配置
                api_key = client_id = None
            else:
                # 从数据库字段获取API凭据
                api_key = shop.api_key_enc  # 注意：这里需要解密处理
                client_id = shop.client_id
                
                if not api_key or not client_id:
                    print(f"Warning: Shop {shop.shop_name} missing API credentials, plugin running in standby mode")
                    api_key = client_id = None
                else:
                    print(f"Ozon plugin initialized with shop: {shop.shop_name} (client_id: {client_id})")
            break
                    
    except Exception as e:
        print(f"Error loading Ozon shop configuration: {e}")
        print("Plugin running in standby mode")
        api_key = client_id = None
    
    # 配置拉取间隔（可以从shop.config读取，默认5分钟）
    pull_interval = 5
    
    # 注册定时任务：拉取订单
    await hooks.register_cron(
        name="ef.ozon.orders.pull",
        cron=f"*/{pull_interval} * * * *",  # 每 N 分钟执行
        task=pull_orders_task
    )
    
    # 注册定时任务：同步库存
    await hooks.register_cron(
        name="ef.ozon.inventory.sync",
        cron="*/30 * * * *",  # 每 30 分钟执行
        task=sync_inventory_task
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
    
    # 配置信息已在上面打印


async def pull_orders_task() -> None:
    """
    拉取 Ozon 订单的定时任务
    """
    try:
        from ef_core.database import get_async_session
        from .models import OzonShop, OzonOrder
        from .api.client import OzonAPIClient
        from sqlalchemy import select
        from decimal import Decimal

        current_time = datetime.now(UTC)
        print(f"[{current_time.isoformat()}] Pulling orders from Ozon...")

        # 获取所有活跃店铺
        async with get_async_session() as db:
            result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active")
            )
            shops = result.scalars().all()

            for shop in shops:
                try:
                    # 创建API客户端
                    client = OzonAPIClient(
                        client_id=shop.client_id,
                        api_key=shop.api_key_enc
                    )

                    # 计算时间范围（最近24小时的订单）
                    date_to = current_time
                    date_from = current_time - timedelta(days=1)

                    # 获取订单数据
                    orders_data = await client.get_orders(
                        date_from=date_from.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
                        date_to=date_to.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                    )

                    if orders_data.get("result"):
                        postings = orders_data["result"].get("postings", [])
                        new_orders = 0

                        for posting in postings:
                            # 检查订单是否已存在
                            existing = await db.execute(
                                select(OzonOrder).where(
                                    OzonOrder.shop_id == shop.id,
                                    OzonOrder.posting_number == posting.get("posting_number", "")
                                )
                            )

                            if not existing.scalar_one_or_none():
                                # 计算总价
                                total_price = Decimal("0")
                                items_data = []

                                for product in posting.get("products", []):
                                    price = Decimal(str(product.get("price", "0")))
                                    quantity = product.get("quantity", 0)
                                    total_price += price * quantity
                                    items_data.append({
                                        "sku": product.get("sku"),
                                        "name": product.get("name"),
                                        "quantity": quantity,
                                        "price": str(price)
                                    })

                                # 创建新订单
                                order = OzonOrder(
                                    shop_id=shop.id,
                                    order_id=posting.get("order_id", ""),
                                    order_number=posting.get("order_number", ""),
                                    posting_number=posting.get("posting_number", ""),
                                    status=posting.get("status", "pending"),
                                    substatus=posting.get("substatus"),
                                    delivery_type=posting.get("delivery_method", {}).get("tpl_provider", "FBS"),
                                    is_express=posting.get("is_express", False),
                                    is_premium=posting.get("is_premium", False),
                                    total_price=total_price,
                                    delivery_method=posting.get("delivery_method", {}).get("name"),
                                    tracking_number=posting.get("tracking_number"),
                                    items=items_data,
                                    in_process_at=datetime.fromisoformat(posting["in_process_at"].replace("Z", "+00:00")) if posting.get("in_process_at") else None,
                                    shipment_date=datetime.fromisoformat(posting["shipment_date"].replace("Z", "+00:00")) if posting.get("shipment_date") else None,
                                    analytics_data=posting.get("analytics_data"),
                                    financial_data=posting.get("financial_data"),
                                    sync_status="success",
                                    last_sync_at=current_time
                                )
                                db.add(order)
                                new_orders += 1

                        if new_orders > 0:
                            await db.commit()
                            print(f"[{shop.shop_name}] Pulled {new_orders} new orders")

                    await client.close()

                except Exception as e:
                    print(f"Error pulling orders for shop {shop.shop_name}: {e}")

    except Exception as e:
        print(f"Error pulling orders: {e}")


async def sync_inventory_task() -> None:
    """
    同步库存的定时任务
    """
    try:
        from ef_core.database import get_async_session
        from .models import OzonShop, OzonProduct
        from .api.client import OzonAPIClient
        from sqlalchemy import select

        current_time = datetime.now(UTC)
        print(f"[{current_time.isoformat()}] Syncing inventory to Ozon...")

        # 获取所有活跃店铺
        async with get_async_session() as db:
            result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active")
            )
            shops = result.scalars().all()

            for shop in shops:
                try:
                    # 创建API客户端
                    client = OzonAPIClient(
                        client_id=shop.client_id,
                        api_key=shop.api_key_enc
                    )

                    # 获取该店铺所有需要同步库存的商品
                    products_result = await db.execute(
                        select(OzonProduct).where(
                            OzonProduct.shop_id == shop.id,
                            OzonProduct.status == "active"
                        ).limit(100)  # 批量处理，每次最多100个
                    )
                    products = products_result.scalars().all()

                    if products:
                        # 准备批量库存更新数据
                        stocks_data = []
                        for product in products:
                            if product.offer_id and product.stock is not None:
                                stocks_data.append({
                                    "offer_id": product.offer_id,
                                    "product_id": product.ozon_product_id,
                                    "stock": int(product.stock),
                                    "warehouse_id": 1  # 默认仓库ID
                                })

                        if stocks_data:
                            # 批量更新库存到Ozon
                            stock_update = {
                                "stocks": stocks_data
                            }

                            result = await client.update_stocks(stock_update)

                            if result.get("result"):
                                # 更新本地同步状态
                                for product in products:
                                    product.sync_status = "success"
                                    product.last_sync_at = current_time

                                await db.commit()
                                print(f"[{shop.shop_name}] Synced inventory for {len(stocks_data)} products")
                            else:
                                print(f"[{shop.shop_name}] Failed to sync inventory: {result}")

                    await client.close()

                except Exception as e:
                    print(f"Error syncing inventory for shop {shop.shop_name}: {e}")

    except Exception as e:
        print(f"Error syncing inventory: {e}")


async def handle_shipment_request(payload: Dict[str, Any]) -> None:
    """
    处理发货请求事件

    Args:
        payload: 事件载荷，包含订单和发货信息
    """
    try:
        from ef_core.database import get_async_session
        from .models import OzonShop, OzonOrder
        from .api.client import OzonAPIClient
        from sqlalchemy import select

        order_id = payload.get("order_id")
        tracking_number = payload.get("tracking_number")
        carrier = payload.get("carrier", "OTHER")

        if not order_id or not tracking_number:
            print("Invalid shipment request: missing order_id or tracking_number")
            return

        print(f"Processing shipment for order {order_id} with tracking {tracking_number}")

        async with get_async_session() as db:
            # 查找订单
            order_result = await db.execute(
                select(OzonOrder).where(
                    (OzonOrder.order_id == order_id) |
                    (OzonOrder.posting_number == order_id)
                )
            )
            order = order_result.scalar_one_or_none()

            if not order:
                print(f"Order {order_id} not found in database")
                return

            # 验证订单状态
            if order.status not in ["awaiting_packaging", "awaiting_deliver"]:
                print(f"Order {order_id} is not ready for shipment. Status: {order.status}")
                return

            # 获取店铺信息
            shop_result = await db.execute(
                select(OzonShop).where(OzonShop.id == order.shop_id)
            )
            shop = shop_result.scalar_one_or_none()

            if not shop:
                print(f"Shop {order.shop_id} not found")
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

                print(f"Successfully shipped order {order_id}")
            else:
                print(f"Failed to ship order {order_id}: {result}")

            await client.close()

    except Exception as e:
        print(f"Error handling shipment request: {e}")


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
            print("Invalid inventory change: missing sku")
            return
        
        from ef_core.database import get_async_session
        from .models import OzonShop, OzonProduct
        from .api.client import OzonAPIClient
        from sqlalchemy import select

        print(f"Processing inventory change for SKU {sku}: {quantity}")

        async with get_async_session() as db:
            # 查找商品
            shop_id = payload.get("shop_id", 1)  # 默认使用第一个店铺
            product_result = await db.execute(
                select(OzonProduct).where(
                    OzonProduct.shop_id == shop_id,
                    OzonProduct.sku == sku
                )
            )
            product = product_result.scalar_one_or_none()

            if not product:
                print(f"Product with SKU {sku} not found")
                return

            # 获取店铺信息
            shop_result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop = shop_result.scalar_one_or_none()

            if not shop:
                print(f"Shop {shop_id} not found")
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

                print(f"Successfully updated inventory for SKU {sku} to {available_stock}")
            else:
                # 记录同步失败
                product.sync_status = "failed"
                product.sync_error = str(result)
                await db.commit()
                print(f"Failed to update inventory for SKU {sku}: {result}")

            await client.close()
        
    except Exception as e:
        print(f"Error handling inventory change: {e}")


async def teardown() -> None:
    """
    插件清理函数（可选）
    在插件关闭时调用
    """
    print("Ozon plugin shutting down...")

    try:
        from ef_core.database import get_async_session
        from .models import OzonShop
        from sqlalchemy import select, update, func

        # 关闭所有活跃的API客户端连接
        async with get_async_session() as db:
            # 更新所有店铺的同步状态
            await db.execute(
                update(OzonShop)
                .where(OzonShop.status == "active")
                .values(
                    stats=func.jsonb_set(
                        OzonShop.stats,
                        '{sync_status}',
                        '"stopped"',
                        create_missing=True
                    )
                )
            )
            await db.commit()
            print("Updated all shops sync status to stopped")

        # 取消所有待处理的异步任务
        pending_tasks = asyncio.all_tasks()
        for task in pending_tasks:
            if not task.done() and task != asyncio.current_task():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        print("Cancelled all pending tasks")

    except Exception as e:
        print(f"Error during teardown: {e}")

    print("Ozon plugin shutdown complete")