"""
Ozon同步服务
处理商品和订单的同步逻辑
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from decimal import Decimal
import logging

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import OzonShop, OzonProduct, OzonOrder, OzonOrderItem, OzonPosting, OzonShipmentPackage
from ..models.products import OzonProductSyncError
from ..api.client import OzonAPIClient
from ..utils.datetime_utils import parse_datetime, utcnow

logger = logging.getLogger(__name__)

# 内存中的任务状态存储（临时方案，生产环境应使用Redis）
SYNC_TASKS: Dict[str, Dict[str, Any]] = {}


def safe_int_conversion(value) -> Optional[int]:
    """安全地将值转换为整数，失败时返回None"""
    if value is None:
        return None
    try:
        # 处理字符串和数字类型
        str_value = str(value).strip()
        if str_value.isdigit():
            return int(str_value)
        return None
    except (ValueError, TypeError, AttributeError):
        return None


def safe_decimal_conversion(value) -> Optional[Decimal]:
    """安全地将值转换为Decimal，失败时返回None"""
    if value is None:
        return None
    try:
        # 处理空字符串
        str_value = str(value).strip()
        if not str_value or str_value == "":
            return None
        # 转换为Decimal
        return Decimal(str_value)
    except (ValueError, TypeError, AttributeError, Exception):
        logger.warning(f"Failed to convert value to Decimal: {value}")
        return None


class OzonSyncService:
    """Ozon同步服务"""

    @staticmethod
    async def _save_product_sync_error(
        db: AsyncSession,
        shop_id: int,
        product_id: Optional[int],
        offer_id: str,
        task_id: Optional[int],
        status: Optional[str],
        errors: list
    ) -> None:
        """保存商品错误信息（OZON平台返回的商品审核错误）

        Args:
            db: 数据库会话
            shop_id: 店铺ID
            product_id: 商品ID（可能为None，如果是新商品）
            offer_id: 商品offer_id
            task_id: 任务ID（可选）
            status: 商品状态
            errors: OZON返回的错误列表
        """
        if not errors:
            return

        try:
            # 查找现有错误记录
            existing_error_result = await db.execute(
                select(OzonProductSyncError).where(
                    and_(
                        OzonProductSyncError.shop_id == shop_id,
                        OzonProductSyncError.offer_id == offer_id
                    )
                ).order_by(OzonProductSyncError.created_at.desc()).limit(1)
            )
            existing_error = existing_error_result.scalar_one_or_none()

            if existing_error:
                # 更新现有错误记录
                existing_error.product_id = product_id
                existing_error.task_id = task_id
                existing_error.status = status
                existing_error.errors = errors
                existing_error.updated_at = utcnow()
                logger.info(f"Updated product error for {offer_id}: {len(errors)} errors")
            else:
                # 创建新错误记录
                sync_error = OzonProductSyncError(
                    shop_id=shop_id,
                    product_id=product_id,
                    offer_id=offer_id,
                    task_id=task_id,
                    status=status,
                    errors=errors,
                    created_at=utcnow(),
                    updated_at=utcnow()
                )
                db.add(sync_error)
                logger.info(f"Created product error record for {offer_id}: {len(errors)} errors")

        except Exception as e:
            logger.error(f"Failed to save product error for {offer_id}: {e}")

    @staticmethod
    async def _clear_product_sync_error(
        db: AsyncSession,
        shop_id: int,
        offer_id: str
    ) -> None:
        """清除商品错误信息（当商品错误已修复时）

        Args:
            db: 数据库会话
            shop_id: 店铺ID
            offer_id: 商品offer_id
        """
        try:
            # 查找并删除现有错误记录
            existing_error_result = await db.execute(
                select(OzonProductSyncError).where(
                    and_(
                        OzonProductSyncError.shop_id == shop_id,
                        OzonProductSyncError.offer_id == offer_id
                    )
                )
            )
            existing_errors = existing_error_result.scalars().all()

            if existing_errors:
                for error in existing_errors:
                    await db.delete(error)
                logger.info(f"Cleared {len(existing_errors)} product error(s) for {offer_id}")

        except Exception as e:
            logger.error(f"Failed to clear product error for {offer_id}: {e}")

    @staticmethod
    async def sync_products(shop_id: int, db: AsyncSession, task_id: str, mode: str = "incremental") -> Dict[str, Any]:
        """同步商品

        Args:
            shop_id: 店铺ID
            db: 数据库会话
            task_id: 任务ID
            mode: 同步模式 - 'full' 全量同步, 'incremental' 增量同步
        """
        try:
            # 更新任务状态
            SYNC_TASKS[task_id] = {
                "status": "running",
                "progress": 0,
                "message": "正在获取店铺信息...",
                "started_at": utcnow().isoformat(),
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
            SYNC_TASKS[task_id]["message"] = f"正在连接Ozon API... (模式: {mode})"

            # 获取商品列表
            total_synced = 0
            page = 1
            last_id = ""
            total_products = 0  # 总商品数，用于准确计算进度
            estimated_total = 0  # 估计的总数

            # 状态统计计数器
            on_sale_count = 0  # 销售中
            ready_to_sell_count = 0  # 准备销售
            error_count = 0  # 错误
            pending_modification_count = 0  # 待修改
            inactive_count = 0  # 已下架
            archived_count = 0  # 已归档

            # 增量同步：设置时间过滤
            filter_params = {}
            if mode == "incremental":
                # 获取最后同步时间或默认48小时前（2天）
                last_sync_time = utcnow() - timedelta(hours=48)
                filter_params["last_changed_since"] = last_sync_time.strftime("%Y-%m-%dT%H:%M:%S.000Z")
                logger.info(f"Incremental sync: fetching products changed since {last_sync_time}")

            # 需要同步的不同状态
            # OZON API的visibility参数支持：VISIBLE(可见)、INVISIBLE(不可见)、ARCHIVED(归档)
            # ALL表示所有商品但不包括归档商品，ARCHIVED专门用于获取归档商品
            visibility_filters = [
                ({"visibility": "VISIBLE"}, "可见商品"),
                ({"visibility": "INVISIBLE"}, "不可见商品"),
                ({"visibility": "ARCHIVED"}, "归档商品"),
            ]

            all_synced_products = []  # 存储所有同步的商品

            for filter_config, description in visibility_filters:
                # 为了保持日志可读性，提取visibility类型描述
                visibility_desc = filter_config.get("visibility", "UNKNOWN")
                is_archived = filter_config.get("archived", False)
                filter_label = f"{visibility_desc}{'(archived)' if is_archived else ''}"

                logger.info(f"\n=== 开始同步 {description} ({filter_label}) ===")
                page = 1
                last_id = ""

                while True:
                    # 调用API获取商品
                    SYNC_TASKS[task_id]["message"] = f"正在获取{description}第{page}页..."
                    logger.info(f"Fetching {filter_label} page {page} with last_id: {last_id}")

                    try:
                        # 构建过滤器：合并基础filter和时间过滤
                        product_filter = {**filter_config, **filter_params}

                        products_data = await client.get_products(
                            limit=100,
                            last_id=last_id,
                            filter=product_filter
                        )
                    except Exception as e:
                        logger.error(f"Failed to fetch {filter_label} products: {e}")
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
                        f"{filter_label} Page {page}: Got {len(items)} products, last_id: {result.get('last_id', 'None')}"
                    )

                    if not items:
                        break

                    # 收集所有offer_id用于批量查询
                    offer_ids = [item.get("offer_id") for item in items if item.get("offer_id")]

                    # 将商品添加到总列表，标记来源
                    for item in items:
                        # 标记商品来源：存储visibility类型和archived状态
                        item["_sync_visibility_type"] = visibility_desc
                        item["_sync_is_archived"] = is_archived
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
                                    for idx, product_detail in enumerate(detail_response["items"]):

                                        if product_detail.get("offer_id"):
                                            products_detail_map[product_detail["offer_id"]] = product_detail
                        except Exception as e:
                            logger.error(f"Failed to get {filter_label} products details batch: {e}")

                    # 批量获取价格信息（使用专门的价格API获取最新价格）
                    products_price_map = {}
                    if offer_ids:
                        try:
                            # 分批处理价格查询，每批最多1000个
                            price_batch_size = 1000
                            for i in range(0, len(offer_ids), price_batch_size):
                                batch_ids = offer_ids[i : i + price_batch_size]
                                price_response = await client.get_product_prices(offer_ids=batch_ids)

                                if price_response.get("result", {}).get("items"):
                                    for price_item in price_response["result"]["items"]:
                                        if price_item.get("offer_id"):
                                            products_price_map[price_item["offer_id"]] = {
                                                "price": price_item.get("price"),
                                                "old_price": price_item.get("old_price"),
                                                "min_price": price_item.get("min_price"),
                                                "price_index": price_item.get("price_index")
                                            }
                        except Exception as e:
                            logger.error(f"Failed to get {filter_label} products prices batch: {e}")

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
                                            if i == 0 and stock_item == stock_response["result"]["items"][0] and visibility_desc == "VISIBLE":
                                                logger.info(f"Stock info from v4 API: offer_id={stock_item.get('offer_id')}, present={total_present}, reserved={total_reserved}")
                        except Exception as e:
                            logger.error(f"Failed to get {filter_label} products stock batch: {e}")

                    # 批量获取商品详细属性（v4 attributes API）
                    products_attributes_map = {}
                    if offer_ids:
                        try:
                            # 分批处理属性查询，每批最多100个
                            attr_batch_size = 100
                            for i in range(0, len(offer_ids), attr_batch_size):
                                batch_ids = offer_ids[i : i + attr_batch_size]
                                attr_response = await client.get_product_info_attributes(
                                    offer_ids=batch_ids,
                                    visibility=filter_config.get("visibility", "ALL")
                                )

                                if attr_response.get("result", {}).get("items"):
                                    for idx, attr_item in enumerate(attr_response["result"]["items"]):
                                        # 类型检查：确保 attr_item 是字典
                                        if not isinstance(attr_item, dict):
                                            logger.warning(
                                                f"Unexpected item type in attributes response: "
                                                f"{type(attr_item).__name__}, skipping item {idx}"
                                            )
                                            continue

                                        if attr_item.get("offer_id"):
                                            products_attributes_map[attr_item["offer_id"]] = attr_item

                                            # 调试：输出第一个商品的所有字段
                                            if idx == 0:
                                                logger.info(f"📋 v4/product/info/attributes API返回的字段: {list(attr_item.keys())}")
                                                logger.info(f"📦 第一个商品完整数据示例: {attr_item}")
                        except Exception as e:
                            logger.error(f"Failed to get {filter_label} products attributes batch: {e}")

                    # === 性能优化：批量查询现有商品，避免 N+1 查询 ===
                    existing_products_result = await db.execute(
                        select(OzonProduct).where(
                            and_(
                                OzonProduct.shop_id == shop_id,
                                OzonProduct.offer_id.in_(offer_ids)
                            )
                        )
                    )
                    existing_products_map = {
                        p.offer_id: p for p in existing_products_result.scalars().all()
                    }
                    logger.debug(
                        f"Batch query: found {len(existing_products_map)} existing products "
                        f"out of {len(offer_ids)} items"
                    )

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

                        # 从批量查询结果中获取商品详情、价格、库存和属性信息
                        product_details = products_detail_map.get(item.get("offer_id")) if item.get("offer_id") else None
                        price_info = products_price_map.get(item.get("offer_id")) if item.get("offer_id") else None
                        stock_info = products_stock_map.get(item.get("offer_id")) if item.get("offer_id") else None
                        attr_info = products_attributes_map.get(item.get("offer_id")) if item.get("offer_id") else None

                        # 从批量查询结果中获取现有商品
                        product = existing_products_map.get(item.get("offer_id"))

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

                        # 获取价格信息（优先级：价格API > 商品详情 > 列表）
                        price = None
                        old_price = None
                        currency_code = None

                        # 第一优先级：使用价格API的数据（最新、最准确）
                        if price_info:
                            price = price_info.get("price")
                            old_price = price_info.get("old_price")
                            if idx == 0 and visibility_desc == "VISIBLE":
                                logger.info(f"Using price from price API: price={price}, old_price={old_price}")

                        # 第二优先级：从v3 API获取价格和货币代码
                        if not price and product_details:
                            price = product_details.get("price")
                            old_price = product_details.get("old_price")

                        # 获取货币代码（始终从详情中获取）
                        if product_details:
                            currency_code = product_details.get("currency_code")

                        # 第三优先级：使用列表中的价格
                        if not price and "price" in item:
                            price = item["price"]
                        if not old_price and "old_price" in item:
                            old_price = item["old_price"]

                        if product:
                            # 更新现有商品
                            product.title = item.get("name", "") or (product_details.get("name") if product_details else "")
                            product.ozon_product_id = item.get("product_id")
                            # 从商品详情获取OZON SKU
                            if product_details:
                                # 尝试从多个可能的字段获取SKU
                                sku_value = product_details.get("sku") or product_details.get("fbs_sku") or product_details.get("fbo_sku")
                                product.ozon_sku = safe_int_conversion(sku_value)
                            else:
                                product.ozon_sku = None
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
                                    product.ozon_created_at = parse_datetime(product_details["created_at"])
                                except (ValueError, TypeError) as e:
                                    logger.warning(f"Failed to parse created_at for product {item.get('offer_id')}: {e}")

                            # 保存OZON原生状态字段
                            product.ozon_archived = item.get("archived", False)
                            product.ozon_has_fbo_stocks = item.get("has_fbo_stocks", False)
                            product.ozon_has_fbs_stocks = item.get("has_fbs_stocks", False)
                            product.ozon_is_discounted = item.get("is_discounted", False)

                            # 从product_details获取额外状态信息
                            visibility_details = {}
                            if product_details:
                                visibility_details = product_details.get("visibility_details", {})
                                # 根据OZON API文档，visibility_details包含has_price和has_stock
                                # 商品可见的条件是：既有价格又有库存
                                has_price = visibility_details.get("has_price", True)
                                has_stock = visibility_details.get("has_stock", True)
                                is_visible = has_price and has_stock

                                # 调试日志：检查visibility_details的实际数据
                                if visibility_details or not is_visible:
                                    logger.info(f"Product {product.offer_id} visibility_details: {visibility_details}, has_price: {has_price}, has_stock: {has_stock}, is_visible: {is_visible}")

                                product.visibility = is_visible
                                product.is_archived = product_details.get("is_archived", False) or product_details.get(
                                    "is_autoarchived", False
                                )
                                # 更新OZON归档状态（详细信息中可能更准确）
                                if product_details.get("is_archived") or product_details.get("is_autoarchived"):
                                    product.ozon_archived = True

                                # 保存visibility_details到数据库
                                product.ozon_visibility_details = visibility_details
                            else:
                                product.visibility = item.get("is_visible", True)
                                product.is_archived = item.get("is_archived", False)
                                has_price = True
                                has_stock = True

                            # 新的5种状态映射逻辑 - 优先级修复版
                            visibility_type = item.get("_sync_visibility_type", "UNKNOWN")
                            sync_is_archived = item.get("_sync_is_archived", False)  # 从filter标记中获取

                            # 判断状态原因
                            status_reason = None

                            # ===== 优先级1: 归档状态（最高优先级）=====
                            # 检查多个归档字段，任一为真即判定为归档
                            is_archived = (
                                sync_is_archived or  # 优先检查filter标记（归档商品专用过滤器）
                                product.ozon_archived or
                                product.is_archived or
                                (product_details and (
                                    product_details.get("is_archived", False) or
                                    product_details.get("is_autoarchived", False)
                                ))
                            )

                            if is_archived:
                                product.status = "archived"
                                product.ozon_status = "archived"
                                status_reason = "商品已归档"
                                archived_count += 1

                            # ===== 优先级2: INVISIBLE商品细分 =====
                            elif visibility_type == "INVISIBLE":
                                # INVISIBLE商品需要进一步区分
                                # 检查是否有错误信息（如违规、审核不通过）
                                if product_details and (product_details.get("errors") or product_details.get("warnings")):
                                    product.status = "error"
                                    product.ozon_status = "error"
                                    status_reason = "商品信息有误或违规"
                                    error_count += 1

                                    # 保存OZON返回的错误信息到数据库
                                    error_list = []
                                    if product_details.get("errors"):
                                        error_list.extend(product_details["errors"])
                                    if product_details.get("warnings"):
                                        error_list.extend(product_details["warnings"])

                                    await OzonSyncService._save_product_sync_error(
                                        db=db,
                                        shop_id=shop_id,
                                        product_id=product.id,
                                        offer_id=product.offer_id,
                                        task_id=None,
                                        status="error",
                                        errors=error_list
                                    )
                                # 检查是否需要修改（如待审核、待补充信息）
                                elif product_details and product_details.get("moderation_status") == "PENDING":
                                    product.status = "pending_modification"
                                    product.ozon_status = "pending_modification"
                                    status_reason = "商品待修改或审核中"
                                    pending_modification_count += 1
                                else:
                                    product.status = "inactive"
                                    product.ozon_status = "inactive"
                                    status_reason = "商品已下架"
                                    inactive_count += 1
                                product.visibility = False  # 确保visibility为False

                            # ===== 优先级3: VISIBLE商品细分 =====
                            elif visibility_details.get("has_price", True) and visibility_details.get("has_stock", True):
                                # 既有价格又有库存，商品在售
                                product.status = "on_sale"
                                product.ozon_status = "on_sale"
                                status_reason = "商品正常销售中"
                                on_sale_count += 1
                            elif not visibility_details.get("has_price", True) or not visibility_details.get("has_stock", True):
                                # 缺少价格或库存，准备销售状态
                                product.status = "ready_to_sell"
                                product.ozon_status = "ready_to_sell"
                                if not visibility_details.get("has_price", True):
                                    status_reason = "商品缺少价格信息"
                                else:
                                    status_reason = "商品缺少库存"
                                ready_to_sell_count += 1
                            elif not price or price == "0" or price == "0.0000":
                                product.status = "ready_to_sell"
                                product.ozon_status = "ready_to_sell"
                                status_reason = "商品价格为0"
                                ready_to_sell_count += 1
                            elif not product.ozon_has_fbo_stocks and not product.ozon_has_fbs_stocks:
                                product.status = "ready_to_sell"
                                product.ozon_status = "ready_to_sell"
                                status_reason = "商品无任何库存"
                                ready_to_sell_count += 1
                            else:
                                product.status = "inactive"
                                product.ozon_status = "inactive"
                                status_reason = "商品状态未知"
                                inactive_count += 1

                            # 保存状态原因
                            product.status_reason = status_reason

                            # 如果商品不是error状态，清除旧的错误记录
                            if product.status != "error":
                                await OzonSyncService._clear_product_sync_error(
                                    db=db,
                                    shop_id=shop_id,
                                    offer_id=product.offer_id
                                )

                            # 更新价格（使用安全转换，自动处理空字符串等无效值）
                            price_decimal = safe_decimal_conversion(price)
                            if price_decimal is not None:
                                product.price = price_decimal
                            old_price_decimal = safe_decimal_conversion(old_price)
                            if old_price_decimal is not None:
                                product.old_price = old_price_decimal

                            # 更新货币代码
                            if currency_code:
                                product.currency_code = currency_code

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

                            # 更新图片（无条件更新，允许None清空）
                            product.images = images_data

                            # 更新尺寸信息（无条件更新，允许None清空）
                            if product_details:
                                dimensions = product_details.get("dimensions", {})
                                product.weight = dimensions.get("weight") if dimensions else None
                                product.width = dimensions.get("width") if dimensions else None
                                product.height = dimensions.get("height") if dimensions else None
                                product.depth = dimensions.get("depth") if dimensions else None
                            else:
                                # 如果没有product_details，清空尺寸信息
                                product.weight = None
                                product.width = None
                                product.height = None
                                product.depth = None

                            # 更新详细属性信息（从v4 attributes API）
                            if attr_info:
                                # 基础条形码数组
                                product.barcodes = attr_info.get("barcodes")
                                # 商品特征数组
                                product.ozon_attributes = attr_info.get("attributes")
                                # 嵌套特征列表
                                product.complex_attributes = attr_info.get("complex_attributes")
                                # 类目标识符
                                product.description_category_id = attr_info.get("description_category_id")
                                # 商品类型标识符
                                product.type_id = attr_info.get("type_id")
                                # 市场营销色彩
                                product.color_image = attr_info.get("color_image")
                                # 主图链接
                                product.primary_image = attr_info.get("primary_image")
                                # 尺寸和重量单位
                                product.dimension_unit = attr_info.get("dimension_unit")
                                product.weight_unit = attr_info.get("weight_unit")
                                # 型号信息
                                product.model_info = attr_info.get("model_info")
                                # PDF文件列表
                                product.pdf_list = attr_info.get("pdf_list")
                                # 具有默认值的特征ID列表
                                product.attributes_with_defaults = attr_info.get("attributes_with_defaults")

                                # 重量和尺寸信息（从v4 attributes API优先获取）
                                if attr_info.get("weight") is not None:
                                    product.weight = safe_decimal_conversion(attr_info.get("weight"))
                                if attr_info.get("width") is not None:
                                    product.width = safe_decimal_conversion(attr_info.get("width"))
                                if attr_info.get("height") is not None:
                                    product.height = safe_decimal_conversion(attr_info.get("height"))
                                if attr_info.get("depth") is not None:
                                    product.depth = safe_decimal_conversion(attr_info.get("depth"))

                            product.sync_status = "success"
                            product.last_sync_at = utcnow()
                            product.updated_at = utcnow()
                        else:
                            # 创建新商品
                            # 解析OZON平台创建时间
                            ozon_created_at = None
                            if product_details and product_details.get("created_at"):
                                try:
                                    # OZON API返回的时间格式: "2019-08-24T14:15:22Z"
                                    ozon_created_at = parse_datetime(product_details["created_at"])
                                except (ValueError, TypeError) as e:
                                    logger.warning(f"Failed to parse created_at for product {item.get('offer_id')}: {e}")

                            product = OzonProduct(
                                shop_id=shop_id,
                                offer_id=item.get("offer_id", ""),
                                ozon_product_id=item.get("product_id"),
                                ozon_sku=safe_int_conversion(
                                    product_details.get("sku") or product_details.get("fbs_sku") or product_details.get("fbo_sku")
                                ) if product_details else None,
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
                                price=safe_decimal_conversion(price) or Decimal("0"),
                                old_price=safe_decimal_conversion(old_price),
                                currency_code=currency_code,  # 货币代码
                                # 使用v4 API的库存数据
                                stock=stock_info["total"] if stock_info else item.get("stocks", {}).get("present", 0) + item.get("stocks", {}).get("reserved", 0),
                                reserved=stock_info["reserved"] if stock_info else item.get("stocks", {}).get("reserved", 0),
                                available=stock_info["present"] if stock_info else item.get("stocks", {}).get("present", 0),
                                images=images_data,
                                sync_status="success",
                                last_sync_at=utcnow(),
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

                            # 新建商品也使用5种状态映射 - 优先级修复版
                            visibility_type = item.get("_sync_visibility_type", "UNKNOWN")
                            sync_is_archived = item.get("_sync_is_archived", False)  # 从filter标记中获取
                            visibility_details = product_details.get("visibility_details", {}) if product_details else {}
                            product.ozon_visibility_details = visibility_details if visibility_details else None

                            # 判断状态原因
                            status_reason = None

                            # ===== 优先级1: 归档状态（最高优先级）=====
                            # 检查多个归档字段，任一为真即判定为归档
                            is_archived = (
                                sync_is_archived or  # 优先检查filter标记（归档商品专用过滤器）
                                product.ozon_archived or
                                product.is_archived or
                                (product_details and (
                                    product_details.get("is_archived", False) or
                                    product_details.get("is_autoarchived", False)
                                ))
                            )

                            if is_archived:
                                product.status = "archived"
                                product.ozon_status = "archived"
                                status_reason = "商品已归档"
                                archived_count += 1

                            # ===== 优先级2: INVISIBLE商品细分 =====
                            elif visibility_type == "INVISIBLE":
                                # INVISIBLE商品需要进一步区分
                                # 检查是否有错误信息
                                if product_details and (product_details.get("errors") or product_details.get("warnings")):
                                    product.status = "error"
                                    product.ozon_status = "error"
                                    status_reason = "商品信息有误或违规"
                                    error_count += 1

                                    # 标记需要保存OZON返回的错误信息（在add之后处理）
                                    product._has_sync_errors = True
                                    product._sync_error_details = {
                                        "errors": product_details.get("errors", []),
                                        "warnings": product_details.get("warnings", [])
                                    }
                                # 检查是否需要修改
                                elif product_details and product_details.get("moderation_status") == "PENDING":
                                    product.status = "pending_modification"
                                    product.ozon_status = "pending_modification"
                                    status_reason = "商品待修改或审核中"
                                    pending_modification_count += 1
                                else:
                                    product.status = "inactive"
                                    product.ozon_status = "inactive"
                                    status_reason = "商品已下架"
                                    inactive_count += 1
                                product.visibility = False

                            # ===== 优先级3: VISIBLE商品细分 =====
                            elif visibility_details.get("has_price", True) and visibility_details.get("has_stock", True):
                                # 既有价格又有库存，商品在售
                                product.status = "on_sale"
                                product.ozon_status = "on_sale"
                                status_reason = "商品正常销售中"
                                on_sale_count += 1
                            elif not visibility_details.get("has_price", True) or not visibility_details.get("has_stock", True):
                                # 缺少价格或库存，准备销售状态
                                product.status = "ready_to_sell"
                                product.ozon_status = "ready_to_sell"
                                if not visibility_details.get("has_price", True):
                                    status_reason = "商品缺少价格信息"
                                else:
                                    status_reason = "商品缺少库存"
                                ready_to_sell_count += 1
                            elif not price or price == "0" or price == "0.0000":
                                product.status = "ready_to_sell"
                                product.ozon_status = "ready_to_sell"
                                status_reason = "商品价格为0"
                                ready_to_sell_count += 1
                            elif not product.ozon_has_fbo_stocks and not product.ozon_has_fbs_stocks:
                                product.status = "ready_to_sell"
                                product.ozon_status = "ready_to_sell"
                                status_reason = "商品无任何库存"
                                ready_to_sell_count += 1
                            else:
                                product.status = "on_sale"
                                product.ozon_status = "on_sale"
                                status_reason = "商品正常销售中"
                                on_sale_count += 1

                            # 保存状态原因
                            product.status_reason = status_reason

                            # 添加详细属性信息（从v4 attributes API）
                            if attr_info:
                                # 基础条形码数组
                                product.barcodes = attr_info.get("barcodes")
                                # 商品特征数组
                                product.ozon_attributes = attr_info.get("attributes")
                                # 嵌套特征列表
                                product.complex_attributes = attr_info.get("complex_attributes")
                                # 类目标识符
                                product.description_category_id = attr_info.get("description_category_id")
                                # 商品类型标识符
                                product.type_id = attr_info.get("type_id")
                                # 市场营销色彩
                                product.color_image = attr_info.get("color_image")
                                # 主图链接
                                product.primary_image = attr_info.get("primary_image")
                                # 尺寸和重量单位
                                product.dimension_unit = attr_info.get("dimension_unit")
                                product.weight_unit = attr_info.get("weight_unit")
                                # 型号信息
                                product.model_info = attr_info.get("model_info")
                                # PDF文件列表
                                product.pdf_list = attr_info.get("pdf_list")
                                # 具有默认值的特征ID列表
                                product.attributes_with_defaults = attr_info.get("attributes_with_defaults")

                                # 重量和尺寸信息（从v4 attributes API优先获取）
                                if attr_info.get("weight") is not None:
                                    product.weight = safe_decimal_conversion(attr_info.get("weight"))
                                if attr_info.get("width") is not None:
                                    product.width = safe_decimal_conversion(attr_info.get("width"))
                                if attr_info.get("height") is not None:
                                    product.height = safe_decimal_conversion(attr_info.get("height"))
                                if attr_info.get("depth") is not None:
                                    product.depth = safe_decimal_conversion(attr_info.get("depth"))

                            db.add(product)

                            # 如果新商品有错误信息，先flush获取product.id，然后保存错误
                            if hasattr(product, '_has_sync_errors') and product._has_sync_errors:
                                await db.flush()

                                error_list = []
                                if product._sync_error_details.get("errors"):
                                    error_list.extend(product._sync_error_details["errors"])
                                if product._sync_error_details.get("warnings"):
                                    error_list.extend(product._sync_error_details["warnings"])

                                await OzonSyncService._save_product_sync_error(
                                    db=db,
                                    shop_id=shop_id,
                                    product_id=product.id,
                                    offer_id=product.offer_id,
                                    task_id=None,
                                    status="error",
                                    errors=error_list
                                )

                    # 处理完这一页的商品，更新计数并检查下一页
                    total_synced += len(items)

                    # === 性能优化：分批提交，避免长事务 ===
                    # 每处理一页（约100个商品）提交一次，减少事务大小
                    await db.commit()
                    logger.debug(f"Committed batch of {len(items)} products for {filter_label}")

                    # 检查是否有下一页
                    next_id = result.get("last_id")
                    if next_id:
                        last_id = next_id
                        page += 1
                        logger.info(f"{filter_label} 第{page-1}页处理完成，继续第{page}页...")
                    else:
                        logger.info(f"{filter_label} 同步完成，共处理了 {page} 页")
                        break
            total_synced = len(all_synced_products)

            logger.info(f"\n=== 同步完成 ===")
            logger.info(f"总共同步商品: {total_synced}个")
            logger.info(f"\n状态分布统计：")
            logger.info(f"  • 销售中 (on_sale): {on_sale_count}个")
            logger.info(f"  • 准备销售 (ready_to_sell): {ready_to_sell_count}个")
            logger.info(f"  • 错误 (error): {error_count}个")
            logger.info(f"  • 待修改 (pending_modification): {pending_modification_count}个")
            logger.info(f"  • 已下架 (inactive): {inactive_count}个")
            logger.info(f"  • 已归档 (archived): {archived_count}个")

            # 更新店铺最后同步时间
            shop.last_sync_at = utcnow()
            await db.commit()

            # 记录最终统计
            logger.info(f"同步完成统计: 总计={total_synced}, 销售中={on_sale_count}, 准备销售={ready_to_sell_count}, 错误={error_count}, 待修改={pending_modification_count}, 已下架={inactive_count}, 已归档={archived_count}")

            # 完成
            SYNC_TASKS[task_id] = {
                "status": "completed",
                "progress": 100,
                "message": f"同步完成，共同步{total_synced}个商品（销售中: {on_sale_count}, 准备销售: {ready_to_sell_count}, 已归档: {archived_count}）",
                "completed_at": utcnow().isoformat(),
                "type": "products",
                "result": {
                    "total_synced": total_synced,
                    "on_sale_count": on_sale_count,
                    "ready_to_sell_count": ready_to_sell_count,
                    "error_count": error_count,
                    "pending_modification_count": pending_modification_count,
                    "inactive_count": inactive_count,
                    "archived_count": archived_count,
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
                "failed_at": utcnow().isoformat(),
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
        """增量同步订单 - 最近48小时（按状态分页）"""
        try:
            # 更新任务状态
            SYNC_TASKS[task_id] = {
                "status": "running",
                "progress": 0,
                "message": "正在获取店铺信息...",
                "started_at": utcnow().isoformat(),
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
            SYNC_TASKS[task_id]["progress"] = 5
            SYNC_TASKS[task_id]["message"] = "正在连接Ozon API..."

            # 时间范围：最近48小时（2天）
            date_from = utcnow() - timedelta(hours=48)
            date_to = utcnow()

            # 需要同步的订单状态（OZON FBS 订单状态）
            statuses_to_sync = [
                "awaiting_packaging",  # 待打包（待备货）- 最重要
                "awaiting_deliver",    # 待发货
                "delivering",          # 配送中
                "cancelled",           # 已取消
                "awaiting_registration", # 等待登记
                "acceptance_in_progress", # 验收中
                "awaiting_approve",    # 等待审批
                "arbitration",         # 仲裁中
                "client_arbitration",  # 客户仲裁
                "driver_pickup",       # 司机取件
                "not_accepted",        # 未接受
                "delivered",           # 已交付
            ]

            total_synced = 0
            synced_order_ids = set()  # 用于去重（同一订单可能在不同状态出现）

            # 按状态循环同步
            for status_idx, status in enumerate(statuses_to_sync):
                # 计算当前状态的进度基准
                status_progress_base = 5 + (85 * status_idx / len(statuses_to_sync))
                status_progress_range = 85 / len(statuses_to_sync)

                SYNC_TASKS[task_id]["message"] = f"正在同步 {status} 状态的订单..."
                logger.info(f"Syncing orders with status: {status}")

                # 对每个状态进行分页
                offset = 0
                batch_size = 100
                has_more = True
                status_order_count = 0

                while has_more:
                    try:
                        orders_data = await client.get_orders(
                            date_from=date_from,
                            date_to=date_to,
                            status=status,
                            limit=batch_size,
                            offset=offset
                        )
                    except Exception as e:
                        logger.error(f"Failed to fetch {status} orders at offset {offset}: {e}")
                        # 继续下一个状态，不中断整个同步
                        break

                    result_data = orders_data.get("result", {})
                    items = result_data.get("postings", [])
                    has_next = result_data.get("has_next", False)

                    if not items:
                        has_more = False
                        break

                    logger.info(f"Status {status} at offset {offset}: got {len(items)} orders, has_next={has_next}")

                    # 处理这一批订单
                    for item in items:
                        order_id = str(item.get("order_id", ""))

                        # 去重检查
                        if order_id in synced_order_ids:
                            logger.debug(f"Order {order_id} already synced, skipping")
                            continue

                        synced_order_ids.add(order_id)
                        status_order_count += 1

                        # 更新进度
                        progress = status_progress_base + (status_progress_range * 0.9 * status_order_count / max(len(items), 1))
                        SYNC_TASKS[task_id]["progress"] = min(progress, 90)
                        SYNC_TASKS[task_id]["message"] = f"正在同步 {status} 订单 {item.get('posting_number', 'unknown')}..."

                        # 检查订单是否存在
                        existing = await db.execute(
                            select(OzonOrder).where(
                                OzonOrder.shop_id == shop_id,
                                OzonOrder.ozon_order_id == order_id
                            ).limit(1)
                        )
                        order = existing.scalar_one_or_none()

                        # 计算订单金额
                        total_price, products_price, delivery_price, commission_amount, delivery_address = \
                            OzonSyncService._calculate_order_amounts(item)

                        # 映射完整字段
                        order_data = OzonSyncService._map_order_fields(
                            item, total_price, products_price,
                            delivery_price, commission_amount,
                            delivery_address, "incremental"
                        )

                        if order:
                            # 更新现有订单
                            for key, value in order_data.items():
                                if hasattr(order, key):
                                    setattr(order, key, value)
                            order.sync_status = "success"
                            order.last_sync_at = utcnow()
                            order.updated_at = utcnow()
                        else:
                            # 创建新订单
                            order = OzonOrder(shop_id=shop_id, **order_data)
                            order.sync_status = "success"
                            order.last_sync_at = utcnow()
                            db.add(order)

                        # Flush确保order获得id
                        await db.flush()

                        # 同步订单商品明细
                        products_data = item.get("products", [])
                        await OzonSyncService._sync_order_items(db, order, products_data)

                        # 同步posting信息
                        await OzonSyncService._sync_posting(db, order, item, shop_id)

                        total_synced += 1

                    # 每批次提交一次
                    await db.commit()

                    # 判断是否继续
                    if not has_next or len(items) < batch_size:
                        has_more = False
                        logger.info(f"Status {status} completed: synced {status_order_count} orders")
                    else:
                        offset += batch_size

            # 更新店铺最后同步时间
            shop.last_sync_at = utcnow()
            await db.commit()

            # 完成
            SYNC_TASKS[task_id] = {
                "status": "completed",
                "progress": 100,
                "message": f"增量同步完成，共同步{total_synced}个订单",
                "completed_at": utcnow().isoformat(),
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
                "failed_at": utcnow().isoformat(),
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
                "started_at": utcnow().isoformat(),
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
            # 全量同步：OZON API限制最大364天，设置为360天（约1年）更安全
            date_from = utcnow() - timedelta(days=360)
            date_to = utcnow()

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
                    raise  # 重新抛出异常，让任务状态变为failed而不是completed

                result = orders_data.get("result", {})
                items = result.get("postings", [])
                has_next = result.get("has_next", False)

                if not items:
                    has_more = False
                    break

                # 记录分页信息
                logger.info(f"Batch at offset {offset}: got {len(items)} orders, has_next={has_next}")

                # 处理这一批订单
                for idx, item in enumerate(items):
                    # 更新进度和消息 - 与增量同步保持一致
                    current_count = total_synced + idx + 1
                    # 使用估算进度（假设最多500个订单，让进度增长更明显）
                    # 如果订单数超过500，动态调整估算值避免超过90%
                    estimated_total = max(500, current_count * 1.1) if current_count > 500 else 500
                    progress = 10 + (80 * current_count / estimated_total)
                    SYNC_TASKS[task_id]["progress"] = min(progress, 90)
                    SYNC_TASKS[task_id]["message"] = f"正在同步订单 {item.get('posting_number', 'unknown')}..."

                    # 检查订单是否存在（使用 ozon_order_id）
                    # 注意：使用first()而不是scalar_one_or_none()，因为可能存在历史重复数据
                    existing = await db.execute(
                        select(OzonOrder).where(
                            OzonOrder.shop_id == shop_id,
                            OzonOrder.ozon_order_id == str(item.get("order_id", ""))
                        ).limit(1)
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
                        order.last_sync_at = utcnow()
                        order.updated_at = utcnow()
                    else:
                        # 创建新订单
                        order = OzonOrder(shop_id=shop_id, **order_data)
                        order.sync_status = "success"
                        order.last_sync_at = utcnow()
                        db.add(order)

                    # Flush确保order获得id，然后同步订单明细和posting
                    await db.flush()

                    # 同步订单商品明细
                    products_data = item.get("products", [])
                    await OzonSyncService._sync_order_items(db, order, products_data)

                    # 同步posting信息（OZON API返回的是posting维度的数据）
                    await OzonSyncService._sync_posting(db, order, item, shop_id)

                    total_synced += 1

                # 每批次提交一次，避免事务过大
                await db.commit()

                # 根据API返回的has_next判断是否继续
                # 如果API没有返回has_next，则通过items数量判断
                if not has_next or len(items) < batch_size:
                    has_more = False
                    logger.info(f"No more orders to fetch: has_next={has_next}, items_count={len(items)}")
                else:
                    offset += batch_size

            # 更新店铺最后同步时间
            shop.last_sync_at = utcnow()
            await db.commit()

            # 完成
            SYNC_TASKS[task_id] = {
                "status": "completed",
                "progress": 100,
                "message": f"全量同步完成，共同步{total_synced}个订单",
                "completed_at": utcnow().isoformat(),
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
                "failed_at": utcnow().isoformat(),
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

        # 基础字段（映射到 OzonOrder 模型）
        order_data = {
            # 订单号映射（修复：使用OZON order_id而非posting_number）
            "order_id": str(item.get("order_id", "")),  # 本地订单号（使用OZON order_id）
            "ozon_order_id": str(item.get("order_id", "")),  # Ozon订单号
            "ozon_order_number": item.get("order_number", ""),  # Ozon订单编号

            # 订单状态
            "status": item.get("status", ""),  # 映射后的标准状态
            "ozon_status": item.get("status", ""),  # Ozon原始状态

            # 订单类型
            "order_type": item.get("delivery_method", {}).get("tpl_provider", "FBS"),  # FBS/FBO
            "is_express": item.get("is_express", False),
            "is_premium": item.get("is_premium", False),

            # 金额信息
            "total_price": total_price,
            "products_price": products_price,
            "delivery_price": delivery_price,
            "commission_amount": commission_amount,

            # 地址和配送
            "delivery_address": delivery_address,
            "delivery_method": item.get("delivery_method", {}).get("name"),

            # 原始数据
            "raw_payload": item,
        }

        # 时间字段（只映射 OzonOrder 模型中存在的字段）
        analytics_data = item.get("analytics_data", {})
        if analytics_data:
            order_data.update({
                "delivery_date": parse_datetime(analytics_data.get("delivery_date_begin")),
            })

        # 其他时间字段
        order_data.update({
            "ordered_at": parse_datetime(item.get("in_process_at")) or utcnow(),  # 必填字段
            "confirmed_at": parse_datetime(item.get("in_process_at")),
            "shipped_at": parse_datetime(item.get("shipment_date")),
            "delivered_at": parse_datetime(item.get("delivered_at")),
            "cancelled_at": parse_datetime(item.get("cancelled_at")),
        })

        return order_data

    @staticmethod
    async def _sync_posting(db: AsyncSession, order: OzonOrder, posting_data: Dict[str, Any], shop_id: int) -> None:
        """同步订单的posting信息

        Args:
            db: 数据库会话
            order: 订单对象
            posting_data: OZON API返回的posting数据
            shop_id: 店铺ID
        """
        posting_number = posting_data.get("posting_number")
        if not posting_number:
            logger.warning(f"Posting without posting_number for order {order.order_id}")
            return

        # 查找或创建Posting
        existing_posting_result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = existing_posting_result.scalar_one_or_none()

        if not posting:
            # 创建新posting
            posting = OzonPosting(
                order_id=order.id,
                shop_id=shop_id,
                posting_number=posting_number,
                ozon_posting_number=posting_data.get("posting_number"),
                status=posting_data.get("status", ""),
            )
            db.add(posting)
            logger.info(f"[DEBUG] Created new posting {posting_number}, status={posting_data.get('status', '')}")
        else:
            # 更新现有posting
            old_status = posting.status
            new_status = posting_data.get("status", "")
            posting.status = new_status
            logger.info(f"[DEBUG] Updating posting {posting_number}: old_status='{old_status}' → new_status='{new_status}'")

        # 更新posting的详细信息
        posting.substatus = posting_data.get("substatus")
        posting.shipment_date = parse_datetime(posting_data.get("shipment_date"))
        posting.in_process_at = parse_datetime(posting_data.get("in_process_at"))
        posting.shipped_at = parse_datetime(posting_data.get("shipment_date"))
        posting.delivered_at = parse_datetime(posting_data.get("delivering_date"))

        # 配送方式信息
        delivery_method = posting_data.get("delivery_method", {})
        if delivery_method:
            posting.delivery_method_id = delivery_method.get("id")
            posting.delivery_method_name = delivery_method.get("name")
            posting.warehouse_id = delivery_method.get("warehouse_id")
            posting.warehouse_name = delivery_method.get("warehouse")

        # 取消信息
        cancellation = posting_data.get("cancellation")
        if cancellation:
            posting.is_cancelled = True
            posting.cancel_reason_id = cancellation.get("cancel_reason_id")
            posting.cancel_reason = cancellation.get("cancel_reason")
            posting.cancelled_at = parse_datetime(cancellation.get("cancelled_at"))
        else:
            posting.is_cancelled = False

        # 保存原始数据
        posting.raw_payload = posting_data

        # 查询shop信息（为_sync_packages提供，避免嵌套异步查询）
        shop_result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
        shop = shop_result.scalar_one_or_none()

        # 同步包裹信息（如果有）
        await OzonSyncService._sync_packages(db, posting, posting_data, shop)

        # ========== 使用统一的状态管理器更新operation_status ==========
        from .posting_status_manager import PostingStatusManager

        # 初始状态设置：如果operation_status为空，先设置一个初始值
        if not posting.operation_status:
            ozon_status = posting_data.get("status", "")
            # 使用状态管理器计算初始状态（不保留手动状态，因为是新posting）
            await db.flush()  # 确保packages已写入
            new_status, _ = PostingStatusManager.calculate_operation_status(
                posting=posting,
                ozon_status=ozon_status,
                preserve_manual=False  # 新posting不需要保留手动状态
            )
            posting.operation_status = new_status
            logger.info(f"Set initial operation_status for posting {posting_number}: {new_status} (OZON status: {ozon_status})")

        # 状态同步：使用统一的状态管理器更新
        await PostingStatusManager.update_posting_status(
            posting=posting,
            ozon_status=posting.status,
            db=db,
            source="sync",  # 来源：同步（全量或增量）
            preserve_manual=True  # 保留用户手动标记的printed状态
        )

        logger.info(
            f"Synced posting {posting_number} for order {order.order_id}",
            extra={"posting_number": posting_number, "order_id": order.order_id, "status": posting.status, "operation_status": posting.operation_status}
        )

    @staticmethod
    async def _sync_order_items(db: AsyncSession, order: OzonOrder, products_data: list) -> None:
        """同步订单商品明细

        Args:
            db: 数据库会话
            order: 订单对象
            products_data: API返回的商品数组
        """
        if not products_data:
            return

        # 获取现有明细（用于更新/删除）
        existing_items_result = await db.execute(
            select(OzonOrderItem).where(OzonOrderItem.order_id == order.id)
        )
        existing_items = {item.offer_id: item for item in existing_items_result.scalars().all()}

        synced_offer_ids = set()

        # 遍历API返回的商品
        for product in products_data:
            # offer_id也可能是整数，转换为字符串
            offer_id = str(product.get("offer_id", "")) if product.get("offer_id") else ""
            if not offer_id:
                logger.warning(f"Product without offer_id in order {order.order_id}: {product}")
                continue

            synced_offer_ids.add(offer_id)

            # 解析商品数据
            quantity = product.get("quantity", 1)
            price = safe_decimal_conversion(product.get("price", 0)) or Decimal("0")

            # OZON平台SKU
            ozon_sku = product.get("sku")
            name = product.get("name", "")

            # 计算总价
            total_amount = price * quantity

            # 检查是否已存在
            if offer_id in existing_items:
                # 更新现有明细
                item = existing_items[offer_id]
                item.quantity = quantity
                item.price = price
                item.total_amount = total_amount
                item.name = name
                item.ozon_sku = ozon_sku
                # 状态继承订单状态
                item.status = order.status
            else:
                # 创建新明细
                item = OzonOrderItem(
                    order_id=order.id,
                    offer_id=offer_id,
                    ozon_sku=ozon_sku,
                    name=name,
                    quantity=quantity,
                    price=price,
                    discount=Decimal("0"),  # OZON API暂不返回单品折扣
                    total_amount=total_amount,
                    status=order.status,
                )
                db.add(item)

        # 删除不再存在的明细（订单更新时商品被移除）
        for offer_id, item in existing_items.items():
            if offer_id not in synced_offer_ids:
                await db.delete(item)

        logger.info(
            f"Synced {len(synced_offer_ids)} items for order {order.order_id}",
            extra={"order_id": order.order_id, "items_count": len(synced_offer_ids)}
        )

    @staticmethod
    async def _sync_packages(db: AsyncSession, posting: OzonPosting, posting_data: Dict[str, Any], shop: Optional[OzonShop]) -> None:
        """同步包裹信息

        Args:
            db: 数据库会话
            posting: Posting对象
            posting_data: OZON API返回的posting数据
            shop: 店铺对象（由调用方提前查询，避免嵌套异步查询）
        """
        # 检查posting状态是否需要包裹信息
        posting_status = posting_data.get("status")
        needs_tracking = posting_status in ["awaiting_deliver", "delivering", "delivered"]

        logger.error(f"[DEBUG _sync_packages] posting_number={posting.posting_number}, status={posting_status}, needs_tracking={needs_tracking}")

        # 检查列表API返回的packages是否包含有效的tracking_number
        packages_from_list = posting_data.get("packages", [])
        has_valid_tracking = False

        if packages_from_list:
            # 检查是否至少有一个包裹有tracking_number（且不等于posting_number）
            for pkg in packages_from_list:
                tracking = pkg.get("tracking_number")
                if tracking and tracking != posting.posting_number:
                    has_valid_tracking = True
                    break

        # 决定是否使用列表API的packages或调用详情接口
        if packages_from_list and (has_valid_tracking or not needs_tracking):
            # 列表API有packages且有有效tracking，或者不需要tracking，直接使用
            packages_list = packages_from_list
            logger.error(f"[DEBUG] Using {len(packages_list)} packages from list API for posting {posting.posting_number} (has_valid_tracking={has_valid_tracking})")
            logger.info(f"Using {len(packages_list)} packages from list API for posting {posting.posting_number}")
        elif needs_tracking:
            # 需要追踪号码但列表接口未返回，调用详情接口
            logger.error(f"[DEBUG] Calling detail API for posting {posting.posting_number}")
            try:
                # 使用调用方传入的shop对象（避免嵌套异步查询）
                if not shop:
                    logger.error(f"[DEBUG] Shop not provided for posting {posting.posting_number}")
                    logger.warning(f"Shop not provided for posting {posting.posting_number}")
                    return

                # 创建API客户端
                client = OzonAPIClient(shop.client_id, shop.api_key_enc)
                logger.error(f"[DEBUG] Created API client, calling get_posting_details...")

                # 调用详情接口
                detail_response = await client.get_posting_details(posting.posting_number)
                detail_data = detail_response.get("result", {})
                logger.error(f"[DEBUG] Detail API response: has_packages={bool(detail_data.get('packages'))}, posting={posting.posting_number}")

                if detail_data.get("packages"):
                    packages_list = detail_data["packages"]
                    logger.error(f"[DEBUG] Fetched {len(packages_list)} packages from detail API")
                    logger.info(f"Fetched {len(packages_list)} packages from detail API for posting {posting.posting_number}")
                else:
                    logger.error(f"[DEBUG] No packages in detail API response for posting {posting.posting_number}")
                    logger.info(f"No packages found in detail API for posting {posting.posting_number}")
                    return

            except Exception as e:
                logger.error(f"[DEBUG] Exception calling detail API: {e}")
                logger.warning(f"Failed to fetch package details for posting {posting.posting_number}: {e}")
                return
        else:
            # 不需要追踪号码，跳过
            return

        # 处理包裹信息
        for package_data in packages_list:
            package_number = package_data.get("package_number") or package_data.get("id")
            if not package_number:
                logger.warning(f"Package without package_number for posting {posting.posting_number}")
                continue

            # 查找或创建包裹
            existing_package_result = await db.execute(
                select(OzonShipmentPackage).where(
                    and_(
                        OzonShipmentPackage.posting_id == posting.id,
                        OzonShipmentPackage.package_number == package_number
                    )
                )
            )
            package = existing_package_result.scalar_one_or_none()

            if not package:
                package = OzonShipmentPackage(
                    posting_id=posting.id,
                    package_number=package_number
                )
                db.add(package)

            # 更新包裹信息
            raw_tracking_number = package_data.get("tracking_number")
            # 验证tracking_number:如果等于posting_number,说明是错误数据,设为None
            if raw_tracking_number and raw_tracking_number == posting.posting_number:
                logger.warning(f"Ignoring invalid tracking_number (same as posting_number) for package {package_number} in posting {posting.posting_number}")
                package.tracking_number = None
            else:
                package.tracking_number = raw_tracking_number

            package.carrier_name = package_data.get("carrier_name")
            package.carrier_code = package_data.get("carrier_code")
            package.status = package_data.get("status")

            # 更新时间戳
            if package_data.get("status_updated_at"):
                package.status_updated_at = parse_datetime(package_data["status_updated_at"])

    @staticmethod
    def get_task_status(task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务状态"""
        return SYNC_TASKS.get(task_id)

    @staticmethod
    def clear_old_tasks():
        """清理旧任务（超过1小时的）"""
        now = utcnow()
        to_remove = []
        for task_id, task in SYNC_TASKS.items():
            if task.get("completed_at"):
                completed_at = parse_datetime(task["completed_at"])
                if completed_at and now - completed_at > timedelta(hours=1):
                    to_remove.append(task_id)
            elif task.get("started_at"):
                started_at = parse_datetime(task["started_at"])
                if started_at and now - started_at > timedelta(hours=2):
                    to_remove.append(task_id)

        for task_id in to_remove:
            del SYNC_TASKS[task_id]
