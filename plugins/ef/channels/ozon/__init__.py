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
        # TODO: 实现订单拉取逻辑
        # 1. 调用 Ozon API 获取新订单
        # 2. 转换为内部订单格式
        # 3. 通过 orders service 保存
        # 4. 发布订单创建事件
        
        current_time = datetime.now(UTC).isoformat()
        print(f"[{current_time}] Pulling orders from Ozon...")
        
        # 模拟拉取订单
        await asyncio.sleep(0.1)
        
    except Exception as e:
        print(f"Error pulling orders: {e}")


async def sync_inventory_task() -> None:
    """
    同步库存的定时任务
    """
    try:
        # TODO: 实现库存同步逻辑
        # 1. 从 inventory service 获取当前库存
        # 2. 调用 Ozon API 更新库存
        # 3. 记录同步结果
        
        current_time = datetime.now(UTC).isoformat()
        print(f"[{current_time}] Syncing inventory to Ozon...")
        
        # 模拟库存同步
        await asyncio.sleep(0.1)
        
    except Exception as e:
        print(f"Error syncing inventory: {e}")


async def handle_shipment_request(payload: Dict[str, Any]) -> None:
    """
    处理发货请求事件
    
    Args:
        payload: 事件载荷，包含订单和发货信息
    """
    try:
        order_id = payload.get("order_id")
        tracking_number = payload.get("tracking_number")
        
        if not order_id or not tracking_number:
            print("Invalid shipment request: missing order_id or tracking_number")
            return
        
        # TODO: 实现发货推送逻辑
        # 1. 验证订单状态
        # 2. 调用 Ozon API 推送发货信息
        # 3. 更新本地发货状态
        # 4. 发布发货完成事件
        
        print(f"Processing shipment for order {order_id} with tracking {tracking_number}")
        
        # 模拟发货处理
        await asyncio.sleep(0.1)
        
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
        
        # TODO: 实现库存变更处理逻辑
        # 1. 验证 SKU 映射关系
        # 2. 计算实际可售库存
        # 3. 调用 Ozon API 更新库存
        # 4. 记录更新结果
        
        print(f"Processing inventory change for SKU {sku}: {quantity}")
        
        # 模拟库存更新
        await asyncio.sleep(0.1)
        
    except Exception as e:
        print(f"Error handling inventory change: {e}")


async def teardown() -> None:
    """
    插件清理函数（可选）
    在插件关闭时调用
    """
    print("Ozon plugin shutting down...")
    # TODO: 清理资源，关闭连接等