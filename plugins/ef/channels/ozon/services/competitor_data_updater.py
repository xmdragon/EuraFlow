"""
竞争对手数据更新服务
定期更新选品商品的竞争对手信息
"""
import asyncio
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from sqlalchemy import select, and_, update, or_
from sqlalchemy.ext.asyncio import AsyncSession
from decimal import Decimal

from ef_core.config import get_settings
from ..models import ProductSelectionItem
from ..api.client import OzonAPIClient
from .ozon_shop_service import OzonShopService

logger = logging.getLogger(__name__)


class CompetitorDataUpdater:
    """竞争对手数据更新服务"""

    def __init__(self, db_session: AsyncSession):
        """
        初始化更新服务

        Args:
            db_session: 数据库会话
        """
        self.db = db_session
        self.shop_service = OzonShopService()
        self.batch_size = 50  # 每批处理的商品数量
        self.concurrent_requests = 3  # 并发请求数
        self.update_interval_hours = 24  # 更新间隔（小时）

    async def update_all_products(self, shop_id: int, force: bool = False) -> Dict[str, Any]:
        """
        更新所有商品的竞争对手数据

        Args:
            shop_id: 店铺ID
            force: 是否强制更新（忽略更新时间）

        Returns:
            更新结果统计
        """
        logger.info(f"Starting competitor data update for shop {shop_id}")

        # 获取需要更新的商品
        products = await self._get_products_to_update(shop_id, force)

        if not products:
            logger.info("No products need updating")
            return {"total": 0, "updated": 0, "failed": 0, "skipped": 0}

        logger.info(f"Found {len(products)} products to update")

        # 获取店铺API凭证
        shop = await self.shop_service.get_shop_by_id(self.db, shop_id)
        if not shop or not shop.client_id or not shop.api_key:
            logger.error(f"Shop {shop_id} not found or missing API credentials")
            return {"error": "Shop not found or missing API credentials"}

        # 创建API客户端
        async with OzonAPIClient(shop.client_id, shop.api_key, shop_id) as api_client:
            # 批量处理商品
            total = len(products)
            updated = 0
            failed = 0
            skipped = 0

            for i in range(0, len(products), self.batch_size):
                batch = products[i:i + self.batch_size]
                logger.info(f"Processing batch {i//self.batch_size + 1}/{(total + self.batch_size - 1)//self.batch_size}")

                # 并发处理批次中的商品
                tasks = []
                for j in range(0, len(batch), self.concurrent_requests):
                    sub_batch = batch[j:j + self.concurrent_requests]
                    tasks.append(self._update_product_batch(api_client, sub_batch))

                # 等待所有任务完成
                results = await asyncio.gather(*tasks, return_exceptions=True)

                # 统计结果
                for result in results:
                    if isinstance(result, Exception):
                        logger.error(f"Batch update failed: {result}")
                        failed += self.concurrent_requests
                    else:
                        updated += result.get("updated", 0)
                        failed += result.get("failed", 0)
                        skipped += result.get("skipped", 0)

        logger.info(f"Competitor data update completed: total={total}, updated={updated}, failed={failed}, skipped={skipped}")

        return {
            "total": total,
            "updated": updated,
            "failed": failed,
            "skipped": skipped,
            "timestamp": datetime.utcnow().isoformat()
        }

    async def update_specific_products(self, shop_id: int, product_ids: List[str]) -> Dict[str, Any]:
        """
        更新特定商品的竞争对手数据

        Args:
            shop_id: 店铺ID
            product_ids: 商品ID列表

        Returns:
            更新结果
        """
        logger.info(f"Updating competitor data for {len(product_ids)} specific products")

        # 获取指定的商品
        result = await self.db.execute(
            select(ProductSelectionItem).where(
                ProductSelectionItem.product_id.in_(product_ids)
            )
        )
        products = result.scalars().all()

        if not products:
            logger.warning("No products found with specified IDs")
            return {"error": "No products found"}

        # 获取店铺API凭证
        shop = await self.shop_service.get_shop_by_id(self.db, shop_id)
        if not shop or not shop.client_id or not shop.api_key:
            logger.error(f"Shop {shop_id} not found or missing API credentials")
            return {"error": "Shop not found or missing API credentials"}

        # 创建API客户端
        async with OzonAPIClient(shop.client_id, shop.api_key, shop_id) as api_client:
            result = await self._update_product_batch(api_client, products)

        return result

    async def _get_products_to_update(self, shop_id: int, force: bool = False) -> List[ProductSelectionItem]:
        """
        获取需要更新的商品列表

        Args:
            shop_id: 店铺ID
            force: 是否强制更新

        Returns:
            商品列表
        """
        # 计算更新时间阈值
        update_threshold = datetime.utcnow() - timedelta(hours=self.update_interval_hours)

        # 构建查询条件
        if force:
            # 强制更新所有商品
            stmt = select(ProductSelectionItem)
        else:
            # 只更新过期的或从未更新过的商品
            stmt = select(ProductSelectionItem).where(
                or_(
                    ProductSelectionItem.competitor_updated_at == None,
                    ProductSelectionItem.competitor_updated_at < update_threshold
                )
            )

        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def _update_product_batch(self, api_client: OzonAPIClient, products: List[ProductSelectionItem]) -> Dict[str, Any]:
        """
        更新一批商品的竞争对手数据

        Args:
            api_client: Ozon API客户端
            products: 商品列表

        Returns:
            更新结果
        """
        updated = 0
        failed = 0
        skipped = 0

        # 准备商品ID列表
        product_ids = [p.product_id for p in products]

        try:
            # 1. 获取价格信息（包含市场最低价和价格指数）
            logger.debug(f"Fetching price data for {len(product_ids)} products")
            price_response = await api_client.get_product_prices(offer_ids=product_ids)

            if price_response and "items" in price_response:
                price_data = {item["offer_id"]: item for item in price_response["items"]}
            else:
                price_data = {}
                logger.warning(f"No price data received for products: {product_ids}")

            # 2. 获取竞争对手列表（可选，如果API支持）
            try:
                competitor_response = await api_client.get_pricing_competitors(skus=product_ids)
                if competitor_response and "competitors" in competitor_response:
                    competitor_data = {comp["sku"]: comp for comp in competitor_response["competitors"]}
                else:
                    competitor_data = {}
            except Exception as e:
                logger.warning(f"Failed to fetch competitor data: {e}")
                competitor_data = {}

            # 3. 更新每个商品的数据
            for product in products:
                try:
                    update_data = {
                        "competitor_updated_at": datetime.utcnow()
                    }

                    # 从价格数据中提取信息
                    if product.product_id in price_data:
                        price_info = price_data[product.product_id]

                        # 提取价格指数信息
                        if "price_indexes" in price_info:
                            indexes = price_info["price_indexes"]

                            # 市场最低价（来自外部市场）
                            if "external_index_data" in indexes:
                                external_data = indexes["external_index_data"]
                                if "minimal_price" in external_data:
                                    update_data["market_min_price"] = Decimal(str(external_data["minimal_price"]))
                                if "price_index_value" in external_data:
                                    update_data["price_index"] = Decimal(str(external_data["price_index_value"]))

                            # Ozon平台最低价
                            if "ozon_index_data" in indexes:
                                ozon_data = indexes["ozon_index_data"]
                                if "minimal_price" in ozon_data:
                                    update_data["competitor_min_price"] = Decimal(str(ozon_data["minimal_price"]))

                            # 其他市场最低价
                            if "self_marketplaces_index_data" in indexes:
                                marketplace_data = indexes["self_marketplaces_index_data"]
                                if "minimal_price" in marketplace_data and "competitor_min_price" not in update_data:
                                    update_data["competitor_min_price"] = Decimal(str(marketplace_data["minimal_price"]))

                    # 从竞争对手数据中提取信息
                    if product.product_id in competitor_data:
                        comp_info = competitor_data[product.product_id]
                        if "competitors" in comp_info:
                            update_data["competitor_count"] = len(comp_info["competitors"])
                            update_data["competitor_data"] = comp_info["competitors"][:10]  # 只保存前10个竞争对手

                    # 更新数据库
                    await self.db.execute(
                        update(ProductSelectionItem)
                        .where(ProductSelectionItem.id == product.id)
                        .values(**update_data)
                    )
                    await self.db.commit()
                    updated += 1
                    logger.debug(f"Updated competitor data for product {product.product_id}")

                except Exception as e:
                    logger.error(f"Failed to update product {product.product_id}: {e}")
                    failed += 1
                    await self.db.rollback()

        except Exception as e:
            logger.error(f"Batch update failed: {e}")
            failed += len(products)

        return {
            "updated": updated,
            "failed": failed,
            "skipped": skipped
        }

    async def schedule_update(self, shop_id: int, delay_seconds: int = 0):
        """
        计划执行更新任务

        Args:
            shop_id: 店铺ID
            delay_seconds: 延迟执行的秒数

        Returns:
            任务ID
        """
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)

        return await self.update_all_products(shop_id)