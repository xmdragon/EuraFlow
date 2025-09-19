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
            total_products = 0  # 总商品数，用于准确计算进度
            estimated_total = 0  # 估计的总数
            inactive_count = 0  # 统计不活跃商品数量
            archived_count = 0  # 统计归档商品数量

            # 需要同步的不同状态
            visibility_filters = [
                ("VISIBLE", "可见商品"),
                ("INVISIBLE", "不可见商品"),  # 关键：单独同步不可见商品
            ]

            all_synced_products = []  # 存储所有同步的商品

            for visibility_type, description in visibility_filters:
                logger.info(f"\n=== 开始同步 {description} ({visibility_type}) ===")
                page = 1
                last_id = ""

                while True:
                    # 调用API获取商品
                    SYNC_TASKS[task_id]["message"] = f"正在获取{description}第{page}页..."
                    logger.info(f"Fetching {visibility_type} page {page} with last_id: {last_id}")

                    try:
                        products_data = await client.get_products(
                            limit=100,
                            last_id=last_id,
                            filter={"visibility": visibility_type}
                        )
                    except Exception as e:
                        logger.error(f"Failed to fetch {visibility_type} products: {e}")
                        # 继续下一个状态，不中断整个同步
                        break

                    result = products_data.get("result", {})
                    items = result.get("items", [])

                    # 第一页时，尝试获取总数（API可能返回total字段）
                    if page == 1:
                        visibility_total = result.get("total", 0)
                        if visibility_total == 0:
                            # 如果API没有返回总数，根据第一页数量估算
                            estimated_total = len(items) * 10 if len(items) == 100 else len(items)
                            visibility_total = estimated_total
                        total_products += visibility_total  # 累加到总数

                    logger.info(
                        f"{visibility_type} Page {page}: Got {len(items)} products, last_id: {result.get('last_id', 'None')}"
                    )

                    if not items:
                        break

                    # 收集所有offer_id用于批量查询
                    offer_ids = [item.get("offer_id") for item in items if item.get("offer_id")]

                    # 将商品添加到总列表，标记visibility状态
                    for item in items:
                        item["_sync_visibility_type"] = visibility_type  # 标记来源
                        all_synced_products.append(item)

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
                                            if i == 0 and product_detail == detail_response["items"][0] and visibility_type == "VISIBLE":
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
                            logger.error(f"Failed to get {visibility_type} products details batch: {e}")

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

                                            # 调试第一个库存信息（仅在VISIBLE时显示）
                                            if i == 0 and stock_item == stock_response["result"]["items"][0] and visibility_type == "VISIBLE":
                                                logger.info(f"Stock info from v4 API: offer_id={stock_item.get('offer_id')}, present={total_present}, reserved={total_reserved}")
                        except Exception as e:
                            logger.error(f"Failed to get {visibility_type} products stock batch: {e}")

                    # 处理每个商品
                    for idx, item in enumerate(items):
                        # 使用总商品数计算更准确的进度
                        if total_products > 0:
                            # 基于总数的准确进度计算
                            current_item_index = total_synced + idx + 1
                            progress = 10 + (80 * current_item_index / total_products)
                        else:
                            # 降级到原有的进度计算（但改进了公式）
                            # 假设最多有1000个商品，避免进度跳跃太快
                            max_expected = max(1000, total_synced + len(items))
                            progress = 10 + (80 * (total_synced + idx + 1) / max_expected)

                        SYNC_TASKS[task_id]["progress"] = min(progress, 90)
                        SYNC_TASKS[task_id]["message"] = f"正在同步商品 {item.get('offer_id', 'unknown')} ({total_synced + idx + 1}/{total_products if total_products else '?'})..."

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

                            # 更新OZON平台创建时间（如果之前没有）
                            if not product.ozon_created_at and product_details and product_details.get("created_at"):
                                try:
                                    product.ozon_created_at = datetime.fromisoformat(product_details["created_at"].replace("Z", "+00:00"))
                                except (ValueError, TypeError) as e:
                                    logger.warning(f"Failed to parse created_at for product {item.get('offer_id')}: {e}")

                            # 保存OZON原生状态字段
                            product.ozon_archived = item.get("archived", False)
                            product.ozon_has_fbo_stocks = item.get("has_fbo_stocks", False)
                            product.ozon_has_fbs_stocks = item.get("has_fbs_stocks", False)
                            product.ozon_is_discounted = item.get("is_discounted", False)

                            # 从product_details获取额外状态信息
                            if product_details:
                                visibility_details = product_details.get("visibility_details", {})
                                # 根据OZON API文档，visibility_details包含has_price和has_stock
                                # 商品可见的条件是：既有价格又有库存
                                has_price = visibility_details.get("has_price", True)
                                has_stock = visibility_details.get("has_stock", True)
                                is_visible = has_price and has_stock

                                # 调试日志：检查visibility_details的实际数据
                                if visibility_details or not is_visible:
                                    logger.info(f"Product {product.sku} visibility_details: {visibility_details}, has_price: {has_price}, has_stock: {has_stock}, is_visible: {is_visible}")

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

                            # 基于OZON原生状态和visibility类型设置商品状态
                            # 优先级：归档 > INVISIBLE > 价格异常 > 无库存 > 有库存
                            visibility_type = item.get("_sync_visibility_type", "UNKNOWN")

                            if product.ozon_archived or product.is_archived:
                                product.status = "archived"
                                archived_count += 1
                            elif visibility_type == "INVISIBLE":
                                # INVISIBLE商品设为不活跃（包括违规下架等）
                                product.status = "inactive"
                                product.visibility = False  # 确保visibility为False
                                inactive_count += 1
                            elif not product.visibility:
                                # visibility为False表示has_price=false或has_stock=false
                                product.status = "inactive"  # 不可见商品（无价格或无库存）
                                inactive_count += 1
                            elif not price or price == "0" or price == "0.0000":
                                product.status = "inactive"  # 价格为0或无价格的商品
                                inactive_count += 1
                            elif not product.ozon_has_fbo_stocks and not product.ozon_has_fbs_stocks:
                                product.status = "inactive"  # 无任何库存标志
                                inactive_count += 1
                            else:
                                product.status = "active"    # 其他情况为活跃

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
                            # 解析OZON平台创建时间
                            ozon_created_at = None
                            if product_details and product_details.get("created_at"):
                                try:
                                    # OZON API返回的时间格式: "2019-08-24T14:15:22Z"
                                    ozon_created_at = datetime.fromisoformat(product_details["created_at"].replace("Z", "+00:00"))
                                except (ValueError, TypeError) as e:
                                    logger.warning(f"Failed to parse created_at for product {item.get('offer_id')}: {e}")

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
                                ozon_created_at=ozon_created_at,  # OZON平台创建时间
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

                            # 基于OZON原生状态和visibility类型设置商品状态
                            # 优先级：归档 > INVISIBLE > 价格异常 > 无库存 > 有库存
                            visibility_type = item.get("_sync_visibility_type", "UNKNOWN")

                            if product.ozon_archived or product.is_archived:
                                product.status = "archived"
                                archived_count += 1
                            elif visibility_type == "INVISIBLE":
                                # INVISIBLE商品设为不活跃（包括违规下架等）
                                product.status = "inactive"
                                product.visibility = False  # 确保visibility为False
                                inactive_count += 1
                            elif not product.visibility:
                                # visibility为False表示has_price=false或has_stock=false
                                product.status = "inactive"  # 不可见商品（无价格或无库存）
                                inactive_count += 1
                            elif not price or price == "0" or price == "0.0000":
                                product.status = "inactive"  # 价格为0或无价格的商品
                                inactive_count += 1
                            elif not product.ozon_has_fbo_stocks and not product.ozon_has_fbs_stocks:
                                product.status = "inactive"  # 无任何库存标志
                                inactive_count += 1
                            else:
                                product.status = "active"    # 其他情况为活跃

                            db.add(product)

                    # 处理完这一页的商品，更新计数并检查下一页
                    total_synced += len(items)

                    # 检查是否有下一页
                    next_id = result.get("last_id")
                    if next_id:
                        last_id = next_id
                        page += 1
                        logger.info(f"{visibility_type} 第{page-1}页处理完成，继续第{page}页...")
                    else:
                        logger.info(f"{visibility_type} 同步完成，共处理了 {page} 页")
                        break

            # 提交所有商品的处理结果
                await db.commit()
            total_synced = len(all_synced_products)

            logger.info(f"\n=== 同步完成 ===")
            logger.info(f"总共同步商品: {total_synced}个")
            logger.info(f"活跃商品: {total_synced - inactive_count - archived_count}个")
            logger.info(f"不活跃商品: {inactive_count}个")
            logger.info(f"归档商品: {archived_count}个")

            # 更新店铺最后同步时间
            shop.last_sync_at = datetime.utcnow()
            await db.commit()

            # 记录最终统计
            logger.info(f"同步完成统计: 总计={total_synced}, 不活跃={inactive_count}, 归档={archived_count}, 活跃={total_synced - inactive_count - archived_count}")

            # 完成
            SYNC_TASKS[task_id] = {
                "status": "completed",
                "progress": 100,
                "message": f"同步完成，共同步{total_synced}个商品（不活跃: {inactive_count}, 归档: {archived_count}）",
                "completed_at": datetime.utcnow().isoformat(),
                "type": "products",
                "result": {
                    "total_synced": total_synced,
                    "inactive_count": inactive_count,
                    "archived_count": archived_count,
                    "active_count": total_synced - inactive_count - archived_count
                },
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
    async def sync_orders(shop_id: int, db: AsyncSession, task_id: str, mode: str = "incremental") -> Dict[str, Any]:
        """
        统一的订单同步入口
        Args:
            shop_id: 店铺ID
            db: 数据库会话
            task_id: 任务ID
            mode: 同步模式 'full' - 全量同步, 'incremental' - 增量同步
        """
        if mode == "full":
            return await OzonSyncService._sync_orders_full(shop_id, db, task_id)
        else:
            return await OzonSyncService._sync_orders_incremental(shop_id, db, task_id)

    @staticmethod
    async def _sync_orders_incremental(shop_id: int, db: AsyncSession, task_id: str) -> Dict[str, Any]:
        """增量同步订单 - 最近7天"""
        try:
            # 更新任务状态
            SYNC_TASKS[task_id] = {
                "status": "running",
                "progress": 0,
                "message": "正在获取店铺信息...",
                "started_at": datetime.utcnow().isoformat(),
                "type": "orders",
                "mode": "incremental",
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

            # 获取订单列表（最近7天）
            total_synced = 0
            # 使用UTC时间，传递datetime对象
            date_from = datetime.utcnow() - timedelta(days=7)
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

                # 计算订单金额
                total_price, products_price, delivery_price, commission_amount, delivery_address = \
                    OzonSyncService._calculate_order_amounts(item)

                # 映射完整字段
                order_data = OzonSyncService._map_order_fields(item, total_price, products_price,
                                                            delivery_price, commission_amount,
                                                            delivery_address, "incremental")

                if order:
                    # 更新现有订单
                    for key, value in order_data.items():
                        if hasattr(order, key):
                            setattr(order, key, value)
                    order.sync_status = "success"
                    order.last_sync_at = datetime.utcnow()
                    order.updated_at = datetime.utcnow()
                else:
                    # 创建新订单
                    order = OzonOrder(shop_id=shop_id, **order_data)
                    order.sync_status = "success"
                    order.last_sync_at = datetime.utcnow()
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
                "message": f"增量同步完成，共同步{total_synced}个订单",
                "completed_at": datetime.utcnow().isoformat(),
                "type": "orders",
                "mode": "incremental",
                "result": {"total_synced": total_synced},
            }

            return SYNC_TASKS[task_id]

        except Exception as e:
            logger.error(f"Incremental sync orders failed: {e}")
            SYNC_TASKS[task_id] = {
                "status": "failed",
                "progress": SYNC_TASKS.get(task_id, {}).get("progress", 0),
                "message": f"增量同步失败: {str(e)}",
                "error": str(e),
                "failed_at": datetime.utcnow().isoformat(),
                "type": "orders",
                "mode": "incremental",
            }
            raise

    @staticmethod
    async def _sync_orders_full(shop_id: int, db: AsyncSession, task_id: str) -> Dict[str, Any]:
        """全量同步订单 - 获取店铺所有历史订单"""
        try:
            # 更新任务状态
            SYNC_TASKS[task_id] = {
                "status": "running",
                "progress": 0,
                "message": "正在获取店铺信息...",
                "started_at": datetime.utcnow().isoformat(),
                "type": "orders",
                "mode": "full",
            }

            # 获取店铺
            result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
            shop = result.scalar_one_or_none()

            if not shop:
                raise ValueError(f"Shop {shop_id} not found")

            # 创建API客户端
            client = OzonAPIClient(shop.client_id, shop.api_key_enc)

            # 更新进度
            SYNC_TASKS[task_id]["progress"] = 5
            SYNC_TASKS[task_id]["message"] = "正在连接Ozon API..."

            total_synced = 0
            # 全量同步：从很久以前开始（比如1年前）
            date_from = datetime.utcnow() - timedelta(days=365)
            date_to = datetime.utcnow()

            SYNC_TASKS[task_id]["message"] = "正在获取所有历史订单..."
            SYNC_TASKS[task_id]["progress"] = 10

            # 分批获取订单，避免一次性加载太多数据
            batch_size = 100
            offset = 0
            has_more = True

            while has_more:
                try:
                    orders_data = await client.get_orders(
                        date_from=date_from,
                        date_to=date_to,
                        limit=batch_size,
                        offset=offset
                    )
                except Exception as e:
                    logger.error(f"Failed to fetch orders batch at offset {offset}: {e}")
                    break

                items = orders_data.get("result", {}).get("postings", [])

                if not items:
                    has_more = False
                    break

                # 更新进度
                progress = 10 + (80 * total_synced / max(1000, total_synced + len(items)))
                SYNC_TASKS[task_id]["progress"] = min(progress, 90)
                SYNC_TASKS[task_id]["message"] = f"正在同步第{offset + 1}-{offset + len(items)}个订单..."

                # 处理这一批订单
                for idx, item in enumerate(items):
                    # 检查订单是否存在
                    existing = await db.execute(
                        select(OzonOrder).where(
                            OzonOrder.shop_id == shop_id,
                            OzonOrder.posting_number == item.get("posting_number")
                        )
                    )
                    order = existing.scalar_one_or_none()

                    # 计算订单金额（复用增量同步的逻辑）
                    total_price, products_price, delivery_price, commission_amount, delivery_address = \
                        OzonSyncService._calculate_order_amounts(item)

                    # 映射完整字段
                    order_data = OzonSyncService._map_order_fields(
                        item, total_price, products_price,
                        delivery_price, commission_amount,
                        delivery_address, "full"
                    )

                    if order:
                        # 更新现有订单
                        for key, value in order_data.items():
                            if hasattr(order, key):
                                setattr(order, key, value)
                        order.sync_status = "success"
                        order.last_sync_at = datetime.utcnow()
                        order.updated_at = datetime.utcnow()
                    else:
                        # 创建新订单
                        order = OzonOrder(shop_id=shop_id, **order_data)
                        order.sync_status = "success"
                        order.last_sync_at = datetime.utcnow()
                        db.add(order)

                    total_synced += 1

                # 每批次提交一次，避免事务过大
                await db.commit()

                offset += batch_size

                # 如果返回的数量小于批次大小，说明没有更多数据了
                if len(items) < batch_size:
                    has_more = False

            # 更新店铺最后同步时间
            shop.last_sync_at = datetime.utcnow()
            await db.commit()

            # 完成
            SYNC_TASKS[task_id] = {
                "status": "completed",
                "progress": 100,
                "message": f"全量同步完成，共同步{total_synced}个订单",
                "completed_at": datetime.utcnow().isoformat(),
                "type": "orders",
                "mode": "full",
                "result": {"total_synced": total_synced},
            }

            return SYNC_TASKS[task_id]

        except Exception as e:
            logger.error(f"Full sync orders failed: {e}")
            SYNC_TASKS[task_id] = {
                "status": "failed",
                "progress": SYNC_TASKS.get(task_id, {}).get("progress", 0),
                "message": f"全量同步失败: {str(e)}",
                "error": str(e),
                "failed_at": datetime.utcnow().isoformat(),
                "type": "orders",
                "mode": "full",
            }
            raise

    @staticmethod
    def _calculate_order_amounts(item: Dict[str, Any]) -> tuple:
        """计算订单金额信息"""
        total_price = None
        products_price = Decimal("0")
        delivery_price = None
        commission_amount = None

        # 计算商品总价
        for product in item.get("products", []):
            price = Decimal(str(product.get("price", 0)))
            quantity = product.get("quantity", 1)
            products_price += price * quantity

        # 获取财务数据
        financial_data = item.get("financial_data", {})
        if financial_data:
            # 从财务数据中提取总价
            if financial_data.get("total_price") is not None:
                total_price = Decimal(str(financial_data["total_price"]))

            # 提取运费
            if financial_data.get("delivery_price") is not None:
                delivery_price = Decimal(str(financial_data["delivery_price"]))

            # 从产品财务数据中提取佣金
            products_financial = financial_data.get("products", [])
            if products_financial:
                commission_total = Decimal("0")
                for product_fin in products_financial:
                    if product_fin.get("commission_amount"):
                        commission_total += Decimal(str(product_fin["commission_amount"]))
                if commission_total > 0:
                    commission_amount = commission_total

        # 如果没有财务数据中的总价，使用商品价格
        if total_price is None:
            total_price = products_price

        # 从analytics_data提取地址信息
        delivery_address = None
        analytics_data = item.get("analytics_data", {})
        if analytics_data:
            address_components = {}
            if analytics_data.get("region"):
                address_components["region"] = analytics_data["region"]
            if analytics_data.get("city"):
                address_components["city"] = analytics_data["city"]
            if analytics_data.get("delivery_type"):
                address_components["delivery_type"] = analytics_data["delivery_type"]

            if address_components:
                delivery_address = address_components

        return total_price, products_price, delivery_price, commission_amount, delivery_address

    @staticmethod
    def _map_order_fields(item: Dict[str, Any], total_price, products_price,
                         delivery_price, commission_amount, delivery_address,
                         sync_mode: str) -> Dict[str, Any]:
        """映射订单字段到数据库模型"""

        def parse_datetime(dt_str):
            if dt_str:
                return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
            return None

        # 基础字段
        order_data = {
            "order_id": str(item.get("order_id", "")),
            "order_number": item.get("order_number", ""),
            "posting_number": item.get("posting_number", ""),
            "status": item.get("status", ""),
            "substatus": item.get("substatus"),
            "previous_substatus": item.get("previous_substatus"),
            "delivery_type": item.get("delivery_method", {}).get("tpl_provider", "FBS"),
            "is_express": item.get("is_express", False),
            "is_premium": item.get("is_premium", False),
            "total_price": total_price,
            "products_price": products_price,
            "delivery_price": delivery_price,
            "commission_amount": commission_amount,
            "delivery_address": delivery_address,
            "delivery_method": item.get("delivery_method", {}).get("name"),
            "tracking_number": item.get("tracking_number"),
            "tpl_integration_type": item.get("tpl_integration_type"),
            "provider_status": item.get("provider_status"),
        }

        # 配送详情字段
        delivery_method = item.get("delivery_method", {})
        if delivery_method:
            order_data.update({
                "warehouse_id": delivery_method.get("warehouse_id"),
                "warehouse_name": delivery_method.get("warehouse"),
                "tpl_provider_id": delivery_method.get("tpl_provider_id"),
                "tpl_provider_name": delivery_method.get("tpl_provider"),
                "delivery_method_detail": delivery_method,
            })

        # 条形码字段
        barcodes = item.get("barcodes", {})
        if barcodes:
            order_data.update({
                "upper_barcode": barcodes.get("upper_barcode"),
                "lower_barcode": barcodes.get("lower_barcode"),
                "barcodes": barcodes,
            })

        # 取消详情字段
        cancellation = item.get("cancellation", {})
        if cancellation:
            order_data.update({
                "cancel_reason_id": cancellation.get("cancel_reason_id"),
                "cancellation_type": cancellation.get("cancellation_type"),
                "cancelled_after_ship": cancellation.get("cancelled_after_ship", False),
                "affect_cancellation_rating": cancellation.get("affect_cancellation_rating", False),
                "cancellation_initiator": cancellation.get("cancellation_initiator"),
                "cancellation_detail": cancellation,
            })

        # 分析数据字段
        analytics_data = item.get("analytics_data", {})
        if analytics_data:
            order_data.update({
                "payment_type": analytics_data.get("payment_type_group_name"),
                "is_legal": analytics_data.get("is_legal", False),
                "delivery_date_begin": parse_datetime(analytics_data.get("delivery_date_begin")),
                "delivery_date_end": parse_datetime(analytics_data.get("delivery_date_end")),
                "analytics_data": analytics_data,
            })

        # 时间字段
        order_data.update({
            "in_process_at": parse_datetime(item.get("in_process_at")),
            "shipment_date": parse_datetime(item.get("shipment_date")),
            "delivering_date": parse_datetime(item.get("delivering_date")),
            "delivered_at": parse_datetime(item.get("delivered_at")),
            "cancelled_at": parse_datetime(item.get("cancelled_at")),
        })

        # JSON字段
        order_data.update({
            "items": item.get("products", []),
            "financial_data": item.get("financial_data"),
            "requirements": item.get("requirements"),
            "optional_info": item.get("optional"),
            "related_postings": item.get("related_postings"),
            "product_exemplars": item.get("product_exemplars"),
            "legal_info": item.get("legal_info"),
            "translit": item.get("translit"),
            "addressee": item.get("addressee"),
        })

        # 同步控制字段
        order_data.update({
            "sync_mode": sync_mode,
            "sync_version": 1,
        })

        # 其他字段
        order_data.update({
            "cancel_reason": item.get("cancel_reason"),
        })

        return order_data

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
