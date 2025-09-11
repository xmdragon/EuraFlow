"""
Ozon同步服务
处理商品和订单的同步逻辑
"""
import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
from decimal import Decimal
import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import OzonShop, OzonProduct, OzonOrder
from ..api.client import OzonAPIClient

logger = logging.getLogger(__name__)

# 内存中的任务状态存储（临时方案，生产环境应使用Redis）
SYNC_TASKS: Dict[str, Dict[str, Any]] = {}


class OzonSyncService:
    """Ozon同步服务"""
    
    @staticmethod
    async def sync_products(shop_id: int, db: AsyncSession, task_id: str) -> Dict[str, Any]:
        """同步商品"""
        try:
            # 更新任务状态
            SYNC_TASKS[task_id] = {
                "status": "running",
                "progress": 0,
                "message": "正在获取店铺信息...",
                "started_at": datetime.utcnow().isoformat(),
                "type": "products"
            }
            
            # 获取店铺
            result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop = result.scalar_one_or_none()
            
            if not shop:
                raise ValueError(f"Shop {shop_id} not found")
            
            # 创建API客户端
            client = OzonAPIClient(shop.client_id, shop.api_key_enc)
            
            # 更新进度
            SYNC_TASKS[task_id]["progress"] = 10
            SYNC_TASKS[task_id]["message"] = "正在连接Ozon API..."
            
            # 获取商品列表
            total_synced = 0
            page = 1
            last_id = ""
            
            while True:
                # 调用API获取商品
                SYNC_TASKS[task_id]["message"] = f"正在获取第{page}页商品..."
                
                try:
                    products_data = await client.get_products(
                        limit=100,
                        last_id=last_id
                    )
                except Exception as e:
                    logger.error(f"Failed to fetch products: {e}")
                    raise
                
                result = products_data.get("result", {})
                items = result.get("items", [])
                
                if not items:
                    break
                
                # 处理每个商品
                for idx, item in enumerate(items):
                    progress = 10 + (80 * (total_synced + idx + 1) / (total_synced + len(items)))
                    SYNC_TASKS[task_id]["progress"] = min(progress, 90)
                    SYNC_TASKS[task_id]["message"] = f"正在同步商品 {item.get('offer_id', 'unknown')}..."
                    
                    # 检查商品是否存在
                    existing = await db.execute(
                        select(OzonProduct).where(
                            OzonProduct.shop_id == shop_id,
                            OzonProduct.offer_id == item.get("offer_id")
                        )
                    )
                    product = existing.scalar_one_or_none()
                    
                    if product:
                        # 更新现有商品
                        product.title = item.get("name", "")
                        product.ozon_product_id = item.get("product_id")
                        product.ozon_sku = item.get("fbo_sku") or item.get("fbs_sku")
                        product.barcode = item.get("barcode", "")
                        product.category_id = item.get("category_id")
                        product.status = "active" if item.get("is_visible") else "inactive"
                        product.visibility = item.get("is_visible", False)
                        product.is_archived = item.get("is_archived", False)
                        
                        # 更新价格
                        if "price" in item:
                            product.price = Decimal(str(item["price"]))
                        if "old_price" in item:
                            product.old_price = Decimal(str(item["old_price"]))
                        
                        # 更新库存
                        stocks = item.get("stocks", {})
                        product.stock = stocks.get("present", 0) + stocks.get("reserved", 0)
                        product.reserved = stocks.get("reserved", 0)
                        product.available = stocks.get("present", 0)
                        
                        product.sync_status = "success"
                        product.last_sync_at = datetime.utcnow()
                        product.updated_at = datetime.utcnow()
                    else:
                        # 创建新商品
                        product = OzonProduct(
                            shop_id=shop_id,
                            sku=item.get("offer_id", ""),
                            offer_id=item.get("offer_id", ""),
                            ozon_product_id=item.get("product_id"),
                            ozon_sku=item.get("fbo_sku") or item.get("fbs_sku"),
                            title=item.get("name", ""),
                            barcode=item.get("barcode", ""),
                            category_id=item.get("category_id"),
                            status="active" if item.get("is_visible") else "inactive",
                            visibility=item.get("is_visible", False),
                            is_archived=item.get("is_archived", False),
                            price=Decimal(str(item["price"])) if "price" in item else Decimal("0"),
                            old_price=Decimal(str(item["old_price"])) if "old_price" in item else None,
                            stock=item.get("stocks", {}).get("present", 0) + item.get("stocks", {}).get("reserved", 0),
                            reserved=item.get("stocks", {}).get("reserved", 0),
                            available=item.get("stocks", {}).get("present", 0),
                            sync_status="success",
                            last_sync_at=datetime.utcnow()
                        )
                        db.add(product)
                
                # 提交当前批次
                await db.commit()
                total_synced += len(items)
                
                # 检查是否有更多页
                has_next = result.get("has_next", False)
                if not has_next or len(items) < 100:
                    break
                    
                # 使用API响应中的last_id用于下一页分页
                last_id = result.get("last_id", "")
                page += 1
                
                # 避免请求过快
                await asyncio.sleep(0.5)
            
            # 更新店铺最后同步时间
            shop.last_sync_at = datetime.utcnow()
            await db.commit()
            
            # 完成
            SYNC_TASKS[task_id] = {
                "status": "completed",
                "progress": 100,
                "message": f"同步完成，共同步{total_synced}个商品",
                "completed_at": datetime.utcnow().isoformat(),
                "type": "products",
                "result": {
                    "total_synced": total_synced
                }
            }
            
            return SYNC_TASKS[task_id]
            
        except Exception as e:
            logger.error(f"Sync products failed: {e}")
            SYNC_TASKS[task_id] = {
                "status": "failed",
                "progress": SYNC_TASKS.get(task_id, {}).get("progress", 0),
                "message": f"同步失败: {str(e)}",
                "error": str(e),
                "failed_at": datetime.utcnow().isoformat(),
                "type": "products"
            }
            raise
    
    @staticmethod
    async def sync_orders(shop_id: int, db: AsyncSession, task_id: str) -> Dict[str, Any]:
        """同步订单"""
        try:
            # 更新任务状态
            SYNC_TASKS[task_id] = {
                "status": "running",
                "progress": 0,
                "message": "正在获取店铺信息...",
                "started_at": datetime.utcnow().isoformat(),
                "type": "orders"
            }
            
            # 获取店铺
            result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop = result.scalar_one_or_none()
            
            if not shop:
                raise ValueError(f"Shop {shop_id} not found")
            
            # 创建API客户端
            client = OzonAPIClient(shop.client_id, shop.api_key_enc)
            
            # 更新进度
            SYNC_TASKS[task_id]["progress"] = 10
            SYNC_TASKS[task_id]["message"] = "正在连接Ozon API..."
            
            # 获取订单列表（最近30天）
            total_synced = 0
            # 使用UTC时间并格式化为RFC3339标准（Ozon API protobuf要求）
            date_from = (datetime.utcnow() - timedelta(days=30)).strftime('%Y-%m-%dT%H:%M:%SZ')
            date_to = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
            
            SYNC_TASKS[task_id]["message"] = "正在获取订单列表..."
            
            try:
                orders_data = await client.get_orders(
                    date_from=date_from,
                    date_to=date_to,
                    limit=100
                )
            except Exception as e:
                logger.error(f"Failed to fetch orders: {e}")
                raise
            
            items = orders_data.get("result", {}).get("postings", [])
            
            # 处理每个订单
            for idx, item in enumerate(items):
                progress = 10 + (80 * (idx + 1) / len(items)) if items else 90
                SYNC_TASKS[task_id]["progress"] = min(progress, 90)
                SYNC_TASKS[task_id]["message"] = f"正在同步订单 {item.get('posting_number', 'unknown')}..."
                
                # 检查订单是否存在
                existing = await db.execute(
                    select(OzonOrder).where(
                        OzonOrder.shop_id == shop_id,
                        OzonOrder.posting_number == item.get("posting_number")
                    )
                )
                order = existing.scalar_one_or_none()
                
                # 计算订单总额
                total_price = Decimal("0")
                products_price = Decimal("0")
                for product in item.get("products", []):
                    price = Decimal(str(product.get("price", 0)))
                    quantity = product.get("quantity", 1)
                    products_price += price * quantity
                
                # 获取财务数据
                financial_data = item.get("financial_data", {})
                if financial_data:
                    total_price = Decimal(str(financial_data.get("total_price", 0)))
                else:
                    total_price = products_price
                
                if order:
                    # 更新现有订单
                    order.status = item.get("status", "")
                    order.substatus = item.get("substatus")
                    order.total_price = total_price
                    order.products_price = products_price
                    order.items = item.get("products", [])
                    order.in_process_at = datetime.fromisoformat(item["in_process_at"].replace("Z", "+00:00")) if item.get("in_process_at") else None
                    order.shipment_date = datetime.fromisoformat(item["shipment_date"].replace("Z", "+00:00")) if item.get("shipment_date") else None
                    order.financial_data = financial_data
                    order.analytics_data = item.get("analytics_data")
                    order.sync_status = "success"
                    order.last_sync_at = datetime.utcnow()
                    order.updated_at = datetime.utcnow()
                else:
                    # 创建新订单
                    order = OzonOrder(
                        shop_id=shop_id,
                        order_id=str(item.get("order_id", "")),
                        order_number=item.get("order_number", ""),
                        posting_number=item.get("posting_number", ""),
                        status=item.get("status", ""),
                        substatus=item.get("substatus"),
                        delivery_type=item.get("delivery_method", {}).get("tpl_provider", "FBS"),
                        is_express=item.get("is_express", False),
                        is_premium=item.get("is_premium", False),
                        total_price=total_price,
                        products_price=products_price,
                        delivery_method=item.get("delivery_method", {}).get("name"),
                        tracking_number=item.get("tracking_number"),
                        items=item.get("products", []),
                        in_process_at=datetime.fromisoformat(item["in_process_at"].replace("Z", "+00:00")) if item.get("in_process_at") else None,
                        shipment_date=datetime.fromisoformat(item["shipment_date"].replace("Z", "+00:00")) if item.get("shipment_date") else None,
                        analytics_data=item.get("analytics_data"),
                        financial_data=financial_data,
                        sync_status="success",
                        last_sync_at=datetime.utcnow()
                    )
                    db.add(order)
                
                total_synced += 1
            
            # 提交所有更改
            await db.commit()
            
            # 更新店铺最后同步时间
            shop.last_sync_at = datetime.utcnow()
            await db.commit()
            
            # 完成
            SYNC_TASKS[task_id] = {
                "status": "completed",
                "progress": 100,
                "message": f"同步完成，共同步{total_synced}个订单",
                "completed_at": datetime.utcnow().isoformat(),
                "type": "orders",
                "result": {
                    "total_synced": total_synced
                }
            }
            
            return SYNC_TASKS[task_id]
            
        except Exception as e:
            logger.error(f"Sync orders failed: {e}")
            SYNC_TASKS[task_id] = {
                "status": "failed",
                "progress": SYNC_TASKS.get(task_id, {}).get("progress", 0),
                "message": f"同步失败: {str(e)}",
                "error": str(e),
                "failed_at": datetime.utcnow().isoformat(),
                "type": "orders"
            }
            raise
    
    @staticmethod
    def get_task_status(task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务状态"""
        return SYNC_TASKS.get(task_id)
    
    @staticmethod
    def clear_old_tasks():
        """清理旧任务（超过1小时的）"""
        now = datetime.utcnow()
        to_remove = []
        for task_id, task in SYNC_TASKS.items():
            if task.get("completed_at"):
                completed_at = datetime.fromisoformat(task["completed_at"])
                if now - completed_at > timedelta(hours=1):
                    to_remove.append(task_id)
            elif task.get("started_at"):
                started_at = datetime.fromisoformat(task["started_at"])
                if now - started_at > timedelta(hours=2):
                    to_remove.append(task_id)
        
        for task_id in to_remove:
            del SYNC_TASKS[task_id]