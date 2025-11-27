"""
商品同步服务

商品同步的主入口，负责协调各个组件完成同步流程。
"""

from datetime import timedelta
from typing import Dict, Any, List
import logging

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ....models import OzonShop, OzonProduct
from ....models import OzonWarehouse
from ....api.client import OzonAPIClient
from ....utils.datetime_utils import utcnow

from ..task_state_manager import get_task_state_manager
from .product_fetcher import ProductFetcher
from .product_mapper import ProductMapper
from .product_status_calculator import ProductStatusCalculator
from .product_error_handler import ProductErrorHandler

logger = logging.getLogger(__name__)


class ProductSyncService:
    """商品同步服务"""

    def __init__(self):
        self.fetcher = ProductFetcher()
        self.mapper = ProductMapper()
        self.status_calculator = ProductStatusCalculator()
        self.error_handler = ProductErrorHandler()
        self.task_manager = get_task_state_manager()

    async def sync_products(
        self,
        shop_id: int,
        db: AsyncSession,
        task_id: str,
        mode: str = "incremental"
    ) -> Dict[str, Any]:
        """
        同步商品主入口

        Args:
            shop_id: 店铺ID
            db: 数据库会话
            task_id: 任务ID
            mode: 同步模式 - 'full' 全量同步, 'incremental' 增量同步

        Returns:
            任务状态字典
        """
        try:
            # 初始化任务状态
            self.task_manager.create_task(
                task_id=task_id,
                task_type="products",
                mode=mode,
                message="正在获取店铺信息..."
            )

            # 获取店铺
            result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
            shop = result.scalar_one_or_none()

            if not shop:
                raise ValueError(f"Shop {shop_id} not found")

            # 创建API客户端
            client = OzonAPIClient(shop.client_id, shop.api_key_enc)

            # 更新进度
            self.task_manager.update_progress(
                task_id, 10, f"正在连接Ozon API... (模式: {mode})"
            )

            # 增量同步：设置时间过滤
            filter_params = {}
            if mode == "incremental":
                last_sync_time = utcnow() - timedelta(hours=48)
                filter_params["last_changed_since"] = last_sync_time.strftime("%Y-%m-%dT%H:%M:%S.000Z")
                logger.info(f"Incremental sync: fetching products changed since {last_sync_time}")

            # 预加载仓库信息
            warehouse_map = await self._load_warehouse_map(db, shop_id)

            # 状态统计计数器
            counters = {
                "on_sale": 0,
                "ready_to_sell": 0,
                "error": 0,
                "pending_modification": 0,
                "inactive": 0,
                "archived": 0,
            }

            total_synced = 0
            total_products = 0

            # 同步不同状态的商品
            visibility_filters = [
                ("VISIBLE", "可见商品", False),
                ("INVISIBLE", "不可见商品", False),
                ("ARCHIVED", "归档商品", True),
            ]

            for visibility, description, is_archived in visibility_filters:
                logger.info(f"\n=== 开始同步 {description} ({visibility}) ===")

                synced, total = await self._sync_visibility_products(
                    db=db,
                    client=client,
                    shop_id=shop_id,
                    task_id=task_id,
                    visibility=visibility,
                    visibility_desc=description,
                    is_archived=is_archived,
                    filter_params=filter_params,
                    warehouse_map=warehouse_map,
                    counters=counters,
                    total_synced=total_synced,
                )

                total_synced = synced
                total_products += total

            # 更新店铺最后同步时间
            shop.last_sync_at = utcnow()
            await db.commit()

            # 记录最终统计
            logger.info("\n=== 同步完成 ===")
            logger.info(f"总共同步商品: {total_synced}个")
            logger.info("\n状态分布统计：")
            logger.info(f"  • 销售中 (on_sale): {counters['on_sale']}个")
            logger.info(f"  • 准备销售 (ready_to_sell): {counters['ready_to_sell']}个")
            logger.info(f"  • 错误 (error): {counters['error']}个")
            logger.info(f"  • 待修改 (pending_modification): {counters['pending_modification']}个")
            logger.info(f"  • 已下架 (inactive): {counters['inactive']}个")
            logger.info(f"  • 已归档 (archived): {counters['archived']}个")

            # 完成任务
            result_data = {
                "total_synced": total_synced,
                "on_sale_count": counters["on_sale"],
                "ready_to_sell_count": counters["ready_to_sell"],
                "error_count": counters["error"],
                "pending_modification_count": counters["pending_modification"],
                "inactive_count": counters["inactive"],
                "archived_count": counters["archived"],
            }

            message = (
                f"同步完成，共同步{total_synced}个商品（销售中: {counters['on_sale']}, "
                f"准备销售: {counters['ready_to_sell']}, 已归档: {counters['archived']}）"
            )

            self.task_manager.complete_task(task_id, result_data, message)
            return self.task_manager.get_task_dict(task_id)

        except Exception as e:
            logger.error(f"Sync products failed: {e}")
            self.task_manager.fail_task(task_id, str(e))
            raise

    async def _load_warehouse_map(
        self,
        db: AsyncSession,
        shop_id: int
    ) -> Dict[int, str]:
        """加载仓库 ID 到名称的映射"""
        warehouse_map = {}
        warehouses_result = await db.execute(
            select(OzonWarehouse).where(OzonWarehouse.shop_id == shop_id)
        )
        for warehouse in warehouses_result.scalars().all():
            warehouse_map[warehouse.warehouse_id] = warehouse.name
        return warehouse_map

    async def _sync_visibility_products(
        self,
        db: AsyncSession,
        client: OzonAPIClient,
        shop_id: int,
        task_id: str,
        visibility: str,
        visibility_desc: str,
        is_archived: bool,
        filter_params: Dict[str, Any],
        warehouse_map: Dict[int, str],
        counters: Dict[str, int],
        total_synced: int,
    ) -> tuple[int, int]:
        """
        同步指定可见性的商品

        Returns:
            (total_synced, visibility_total) - 累计同步数, 该类型总数
        """
        visibility_total = 0

        async for items, last_id, total in self.fetcher.fetch_products_paginated(
            client, visibility, filter_params
        ):
            if visibility_total == 0:
                visibility_total = total

            # 收集所有 offer_id
            offer_ids = [item.get("offer_id") for item in items if item.get("offer_id")]

            # 批量获取各种信息
            products_detail_map = await self.fetcher.fetch_product_details_batch(client, offer_ids)
            products_price_map = await self.fetcher.fetch_prices_batch(client, offer_ids)
            products_stock_map = await self.fetcher.fetch_stocks_batch(client, offer_ids, warehouse_map)
            products_attributes_map = await self.fetcher.fetch_attributes_batch(
                client, offer_ids, visibility
            )

            # 批量查询现有商品
            existing_products_map = await self._batch_query_products(db, shop_id, offer_ids)

            # 处理每个商品
            for idx, item in enumerate(items):
                # 更新进度
                current_item_index = total_synced + idx + 1
                if visibility_total > 0:
                    progress = 10 + (80 * current_item_index / max(visibility_total, 1))
                else:
                    progress = 10 + (80 * current_item_index / max(1000, current_item_index))

                self.task_manager.update_progress(
                    task_id,
                    min(int(progress), 90),
                    f"正在同步商品 {item.get('offer_id', 'unknown')} ({current_item_index}/{visibility_total or '?'})..."
                )

                # 标记商品来源
                item["_sync_visibility_type"] = visibility
                item["_sync_is_archived"] = is_archived

                # 获取关联数据
                offer_id = item.get("offer_id")
                product_details = products_detail_map.get(offer_id) if offer_id else None
                price_info = products_price_map.get(offer_id) if offer_id else None
                stock_info = products_stock_map.get(offer_id) if offer_id else None
                attr_info = products_attributes_map.get(offer_id) if offer_id else None

                # 获取或创建商品
                product = existing_products_map.get(offer_id)
                is_new = product is None

                if is_new:
                    product = OzonProduct(
                        shop_id=shop_id,
                        offer_id=offer_id or "",
                    )
                    db.add(product)

                # 映射数据
                product_data = self.mapper.map_to_product_data(
                    item, product_details, price_info, stock_info, attr_info
                )

                # 应用映射数据
                self.mapper.apply_to_product(product, product_data, is_new)

                # 计算状态
                visibility_details = product_data.ozon_visibility_details or {}
                status, ozon_status, status_reason = self.status_calculator.calculate_status(
                    visibility_type=visibility,
                    sync_is_archived=is_archived,
                    ozon_archived=product.ozon_archived,
                    is_archived=product.is_archived,
                    product_details=product_details,
                    visibility_details=visibility_details,
                    price=product.price,
                    has_fbo_stocks=product.ozon_has_fbo_stocks,
                    has_fbs_stocks=product.ozon_has_fbs_stocks,
                )

                product.status = status
                product.ozon_status = ozon_status
                product.status_reason = status_reason

                # 更新计数器
                counters[status] = counters.get(status, 0) + 1

                # 处理错误记录
                if status == "error":
                    error_list = self.status_calculator.get_error_list(product_details)
                    if is_new:
                        await db.flush()  # 获取 product.id
                    await self.error_handler.save_error(
                        db=db,
                        shop_id=shop_id,
                        product_id=product.id,
                        offer_id=product.offer_id,
                        task_id=None,
                        status="error",
                        errors=error_list
                    )
                else:
                    await self.error_handler.clear_error(db, shop_id, product.offer_id)

                # INVISIBLE 商品的可见性
                if visibility == "INVISIBLE":
                    product.visibility = False

                # 更新同步状态
                product.sync_status = "success"
                product.last_sync_at = utcnow()
                product.updated_at = utcnow()

            total_synced += len(items)

            # 分批提交
            await db.commit()
            logger.debug(f"Committed batch of {len(items)} products for {visibility}")

        return total_synced, visibility_total

    async def _batch_query_products(
        self,
        db: AsyncSession,
        shop_id: int,
        offer_ids: List[str]
    ) -> Dict[str, OzonProduct]:
        """批量查询现有商品"""
        if not offer_ids:
            return {}

        result = await db.execute(
            select(OzonProduct).where(
                and_(
                    OzonProduct.shop_id == shop_id,
                    OzonProduct.offer_id.in_(offer_ids)
                )
            )
        )
        return {p.offer_id: p for p in result.scalars().all()}
