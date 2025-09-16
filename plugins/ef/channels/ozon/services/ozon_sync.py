"""
Ozon同步服务
处理商品和订单的同步逻辑
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from decimal import Decimal
import logging

from sqlalchemy import select
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
                "type": "products",
            }

            # 获取店铺
            result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
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
                logger.info(f"Fetching page {page} with last_id: {last_id}")

                try:
                    products_data = await client.get_products(limit=100, last_id=last_id)
                except Exception as e:
                    logger.error(f"Failed to fetch products: {e}")
                    raise

                result = products_data.get("result", {})
                items = result.get("items", [])

                logger.info(
                    f"Page {page}: Got {len(items)} products, last_id in response: {result.get('last_id', 'None')}"
                )

                if not items:
                    break

                # 收集所有offer_id用于批量查询
                offer_ids = [item.get("offer_id") for item in items if item.get("offer_id")]

                # 批量获取商品详细信息（包含图片）
                products_detail_map = {}
                if offer_ids:
                    try:
                        # 分批处理，每批最多100个
                        batch_size = 100
                        for i in range(0, len(offer_ids), batch_size):
                            batch_ids = offer_ids[i : i + batch_size]
                            detail_response = await client.get_product_info_list(offer_ids=batch_ids)

                            if detail_response.get("items"):
                                for product_detail in detail_response["items"]:
                                    if product_detail.get("offer_id"):
                                        products_detail_map[product_detail["offer_id"]] = product_detail

                                        # 调试第一个商品的响应
                                        if i == 0 and product_detail == detail_response["items"][0]:
                                            logger.info(
                                                f"Product detail from v3 API keys: {list(product_detail.keys())}"
                                            )
                                            if product_detail.get("images"):
                                                logger.info(
                                                    f"Found images array with {len(product_detail['images'])} items"
                                                )
                                            if product_detail.get("primary_image"):
                                                logger.info(f"Found primary_image: {product_detail['primary_image']}")
                                            # 调试状态相关字段
                                            visibility_details = product_detail.get("visibility_details", {})
                                            logger.info(f"Visibility details: {visibility_details}")
                                            logger.info(
                                                f"is_archived: {product_detail.get('is_archived')}, is_autoarchived: {product_detail.get('is_autoarchived')}"
                                            )
                    except Exception as e:
                        logger.error(f"Failed to get products details batch: {e}")

                # 批量获取库存信息
                products_stock_map = {}
                if offer_ids:
                    try:
                        # 分批处理库存查询，每批最多1000个（API限制）
                        stock_batch_size = 1000
                        for i in range(0, len(offer_ids), stock_batch_size):
                            batch_ids = offer_ids[i : i + stock_batch_size]
                            stock_response = await client.get_product_stocks(offer_ids=batch_ids)

                            if stock_response.get("result", {}).get("items"):
                                for stock_item in stock_response["result"]["items"]:
                                    if stock_item.get("offer_id"):
                                        # 获取所有仓库的库存
                                        total_present = 0
                                        total_reserved = 0

                                        if stock_item.get("stocks"):
                                            for stock_info in stock_item["stocks"]:
                                                total_present += stock_info.get("present", 0)
                                                total_reserved += stock_info.get("reserved", 0)

                                        products_stock_map[stock_item["offer_id"]] = {
                                            "present": total_present,
                                            "reserved": total_reserved,
                                            "total": total_present + total_reserved
                                        }

                                        # 调试第一个库存信息
                                        if i == 0 and stock_item == stock_response["result"]["items"][0]:
                                            logger.info(f"Stock info from v4 API: offer_id={stock_item.get('offer_id')}, present={total_present}, reserved={total_reserved}")
                    except Exception as e:
                        logger.error(f"Failed to get products stock batch: {e}")

                # 处理每个商品
                for idx, item in enumerate(items):
                    progress = 10 + (80 * (total_synced + idx + 1) / (total_synced + len(items)))
                    SYNC_TASKS[task_id]["progress"] = min(progress, 90)
                    SYNC_TASKS[task_id]["message"] = f"正在同步商品 {item.get('offer_id', 'unknown')}..."

                    # 从批量查询结果中获取商品详情和库存信息
                    product_details = products_detail_map.get(item.get("offer_id")) if item.get("offer_id") else None
                    stock_info = products_stock_map.get(item.get("offer_id")) if item.get("offer_id") else None

                    # 检查商品是否存在
                    existing = await db.execute(
                        select(OzonProduct).where(
                            OzonProduct.shop_id == shop_id, OzonProduct.offer_id == item.get("offer_id")
                        )
                    )
                    product = existing.scalar_one_or_none()

                    # 处理图片信息
                    images_data = None

                    # 从v3 API响应中获取图片
                    if product_details:
                        # 优先使用primary_image字段
                        if product_details.get("primary_image") and isinstance(product_details["primary_image"], list):
                            primary_images = product_details["primary_image"]
                            # 使用images字段作为所有图片
                            all_images = product_details.get("images", [])

                            if primary_images and len(primary_images) > 0:
                                images_data = {
                                    "primary": primary_images[0],  # 使用primary_image的第一个
                                    "additional": all_images[1:] if len(all_images) > 1 else [],
                                    "count": len(all_images) if all_images else 1,
                                }
                                if idx == 0:
                                    logger.info(f"Using primary_image as main image, total {len(all_images)} images")
                        # 如果没有primary_image，使用images字段
                        elif product_details.get("images") and isinstance(product_details["images"], list):
                            images_list = product_details["images"]
                            if images_list and len(images_list) > 0:
                                images_data = {
                                    "primary": images_list[0],  # 第一张作为主图
                                    "additional": images_list[1:] if len(images_list) > 1 else [],
                                    "count": len(images_list),
                                }
                                if idx == 0:
                                    logger.info(f"Extracted {len(images_list)} image URLs from images field")

                    # 获取价格信息（优先使用详细信息中的价格）
                    price = None
                    old_price = None
                    if product_details:
                        # 从v3 API获取价格（v3返回的是字符串格式）
                        price = product_details.get("price")
                        old_price = product_details.get("old_price")

                    # 如果详细信息没有价格，使用列表中的价格
                    if not price and "price" in item:
                        price = item["price"]
                    if not old_price and "old_price" in item:
                        old_price = item["old_price"]

                    if product:
                        # 更新现有商品
                        product.title = item.get("name", "") or (product_details.get("name") if product_details else "")
                        product.ozon_product_id = item.get("product_id")
                        product.ozon_sku = item.get("fbo_sku") or item.get("fbs_sku")
                        product.barcode = item.get("barcode", "") or (
                            product_details.get("barcode") if product_details else ""
                        )
                        product.category_id = item.get("category_id") or (
                            product_details.get("category_id") if product_details else None
                        )
                        product.brand = product_details.get("brand") if product_details else None
                        product.description = product_details.get("description") if product_details else None

                        # 保存OZON原生状态字段
                        product.ozon_archived = item.get("archived", False)
                        product.ozon_has_fbo_stocks = item.get("has_fbo_stocks", False)
                        product.ozon_has_fbs_stocks = item.get("has_fbs_stocks", False)
                        product.ozon_is_discounted = item.get("is_discounted", False)

                        # 从product_details获取额外状态信息
                        if product_details:
                            visibility_details = product_details.get("visibility_details", {})
                            is_visible = visibility_details.get("visible", True)
                            product.visibility = is_visible
                            product.is_archived = product_details.get("is_archived", False) or product_details.get(
                                "is_autoarchived", False
                            )
                            # 更新OZON归档状态（详细信息中可能更准确）
                            if product_details.get("is_archived") or product_details.get("is_autoarchived"):
                                product.ozon_archived = True
                        else:
                            product.visibility = item.get("is_visible", True)
                            product.is_archived = item.get("is_archived", False)

                        # 基于OZON原生状态设置商品状态
                        if product.ozon_archived:
                            product.status = "archived"
                        elif not product.visibility:
                            product.status = "inactive"  # 不可见商品
                        elif product.ozon_has_fbo_stocks or product.ozon_has_fbs_stocks:
                            product.status = "active"    # 有FBO或FBS库存
                        else:
                            product.status = "inactive"  # 无任何库存

                        # 更新价格
                        if price:
                            product.price = Decimal(str(price))
                        if old_price:
                            product.old_price = Decimal(str(old_price))

                        # 更新库存 - 使用v4 API的真实库存数据
                        if stock_info:
                            product.stock = stock_info["total"]
                            product.reserved = stock_info["reserved"]
                            product.available = stock_info["present"]
                        else:
                            # 如果没有库存信息，使用原有的逻辑作为后备
                            stocks = item.get("stocks", {})
                            product.stock = stocks.get("present", 0) + stocks.get("reserved", 0)
                            product.reserved = stocks.get("reserved", 0)
                            product.available = stocks.get("present", 0)

                        # 更新图片
                        if images_data:
                            product.images = images_data

                        # 更新尺寸信息（如果有）
                        if product_details:
                            dimensions = product_details.get("dimensions", {})
                            if dimensions:
                                product.weight = dimensions.get("weight")
                                product.width = dimensions.get("width")
                                product.height = dimensions.get("height")
                                product.depth = dimensions.get("depth")

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
                            title=item.get("name", "") or (product_details.get("name") if product_details else ""),
                            description=product_details.get("description") if product_details else None,
                            barcode=item.get("barcode", "")
                            or (product_details.get("barcode") if product_details else ""),
                            category_id=item.get("category_id")
                            or (product_details.get("category_id") if product_details else None),
                            brand=product_details.get("brand") if product_details else None,
                            status="active",  # 默认设为active，后面会根据详情更新
                            visibility=True,  # 默认设为可见
                            is_archived=False,  # 默认未归档
                            # OZON原生状态字段
                            ozon_archived=item.get("archived", False),
                            ozon_has_fbo_stocks=item.get("has_fbo_stocks", False),
                            ozon_has_fbs_stocks=item.get("has_fbs_stocks", False),
                            ozon_is_discounted=item.get("is_discounted", False),
                            price=Decimal(str(price)) if price else Decimal("0"),
                            old_price=Decimal(str(old_price)) if old_price else None,
                            # 使用v4 API的库存数据
                            stock=stock_info["total"] if stock_info else item.get("stocks", {}).get("present", 0) + item.get("stocks", {}).get("reserved", 0),
                            reserved=stock_info["reserved"] if stock_info else item.get("stocks", {}).get("reserved", 0),
                            available=stock_info["present"] if stock_info else item.get("stocks", {}).get("present", 0),
                            images=images_data,
                            sync_status="success",
                            last_sync_at=datetime.utcnow(),
                        )

                        # 添加尺寸信息（如果有）
                        if product_details:
                            dimensions = product_details.get("dimensions", {})
                            if dimensions:
                                product.weight = dimensions.get("weight")
                                product.width = dimensions.get("width")
                                product.height = dimensions.get("height")
                                product.depth = dimensions.get("depth")

                            # 更新状态信息
                            visibility_details = product_details.get("visibility_details", {})
                            is_visible = visibility_details.get("visible", True)
                            product.visibility = is_visible
                            product.is_archived = product_details.get("is_archived", False) or product_details.get(
                                "is_autoarchived", False
                            )
                            # 更新OZON归档状态（详细信息中可能更准确）
                            if product_details.get("is_archived") or product_details.get("is_autoarchived"):
                                product.ozon_archived = True

                        # 基于OZON原生状态设置商品状态
                        if product.ozon_archived:
                            product.status = "archived"
                        elif not product.visibility:
                            product.status = "inactive"  # 不可见商品
                        elif product.ozon_has_fbo_stocks or product.ozon_has_fbs_stocks:
                            product.status = "active"    # 有FBO或FBS库存
                        else:
                            product.status = "inactive"  # 无任何库存

                        db.add(product)

                # 提交当前批次
                await db.commit()
                total_synced += len(items)

                # 检查是否有更多页
                # 如果返回的商品数量小于请求的数量，说明没有更多数据了
                if len(items) < 100:
                    logger.info(f"No more products to sync (got {len(items)} items)")
                    break

                # 获取下一页的last_id
                new_last_id = result.get("last_id", "")
                if not new_last_id or new_last_id == last_id:
                    # 如果没有新的last_id或者last_id没变化，说明没有更多数据
                    logger.info("No more pages available (no last_id)")
                    break

                last_id = new_last_id
                logger.info(f"Moving to next page with last_id: {last_id}")
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
                "result": {"total_synced": total_synced},
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
                "type": "products",
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
                "type": "orders",
            }

            # 获取店铺
            result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
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
            # 使用UTC时间，传递datetime对象
            date_from = datetime.utcnow() - timedelta(days=30)
            date_to = datetime.utcnow()

            SYNC_TASKS[task_id]["message"] = "正在获取订单列表..."

            try:
                orders_data = await client.get_orders(date_from=date_from, date_to=date_to, limit=100)
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
                        OzonOrder.shop_id == shop_id, OzonOrder.posting_number == item.get("posting_number")
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
                    order.in_process_at = (
                        datetime.fromisoformat(item["in_process_at"].replace("Z", "+00:00"))
                        if item.get("in_process_at")
                        else None
                    )
                    order.shipment_date = (
                        datetime.fromisoformat(item["shipment_date"].replace("Z", "+00:00"))
                        if item.get("shipment_date")
                        else None
                    )
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
                        in_process_at=(
                            datetime.fromisoformat(item["in_process_at"].replace("Z", "+00:00"))
                            if item.get("in_process_at")
                            else None
                        ),
                        shipment_date=(
                            datetime.fromisoformat(item["shipment_date"].replace("Z", "+00:00"))
                            if item.get("shipment_date")
                            else None
                        ),
                        analytics_data=item.get("analytics_data"),
                        financial_data=financial_data,
                        sync_status="success",
                        last_sync_at=datetime.utcnow(),
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
                "result": {"total_synced": total_synced},
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
                "type": "orders",
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
