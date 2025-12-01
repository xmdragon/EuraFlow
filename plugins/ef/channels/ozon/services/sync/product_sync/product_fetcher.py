"""
商品数据获取器

负责从 OZON API 批量获取商品数据，包括：
- 商品列表（分页）
- 商品详情
- 价格信息
- 库存信息
- 属性信息
"""

from typing import Dict, List, Optional, Any, AsyncIterator
import logging

from ....api.client import OzonAPIClient

logger = logging.getLogger(__name__)


class ProductFetcher:
    """商品数据获取器"""

    async def fetch_products_paginated(
        self,
        client: OzonAPIClient,
        visibility: str,
        filter_params: Optional[Dict[str, Any]] = None,
        batch_size: int = 100,
    ) -> AsyncIterator[tuple[List[Dict], str, int]]:
        """
        分页获取商品列表

        Args:
            client: OZON API 客户端
            visibility: 可见性过滤器（VISIBLE, INVISIBLE, ARCHIVED）
            filter_params: 额外的过滤参数
            batch_size: 每批获取数量

        Yields:
            (items, last_id, total) - 商品列表、下一页ID、总数
        """
        last_id = ""
        page = 1
        total = 0

        while True:
            # 构建过滤器
            product_filter = {"visibility": visibility}
            if filter_params:
                product_filter.update(filter_params)

            try:
                products_data = await client.get_products(
                    limit=batch_size,
                    last_id=last_id,
                    filter=product_filter
                )
            except Exception as e:
                logger.error(f"Failed to fetch {visibility} products: {e}")
                break

            result = products_data.get("result", {})
            items = result.get("items", [])

            # 第一页时获取总数
            if page == 1:
                total = result.get("total", 0)
                if total == 0:
                    total = len(items) * 10 if len(items) == batch_size else len(items)

            logger.info(
                f"{visibility} Page {page}: Got {len(items)} products, "
                f"last_id: {result.get('last_id', 'None')}"
            )

            if not items:
                break

            yield items, last_id, total

            # 检查是否有下一页
            next_id = result.get("last_id")
            if next_id:
                last_id = next_id
                page += 1
            else:
                break

    async def fetch_product_details_batch(
        self,
        client: OzonAPIClient,
        offer_ids: List[str],
        batch_size: int = 100,
    ) -> Dict[str, Dict]:
        """
        批量获取商品详情

        Args:
            client: OZON API 客户端
            offer_ids: 商品 offer_id 列表
            batch_size: 每批获取数量

        Returns:
            {offer_id: product_detail} 映射
        """
        products_detail_map: Dict[str, Dict] = {}

        if not offer_ids:
            return products_detail_map

        try:
            for i in range(0, len(offer_ids), batch_size):
                batch_ids = offer_ids[i:i + batch_size]
                detail_response = await client.get_product_info_list(offer_ids=batch_ids)

                if detail_response.get("items"):
                    for product_detail in detail_response["items"]:
                        if product_detail.get("offer_id"):
                            products_detail_map[product_detail["offer_id"]] = product_detail
        except Exception as e:
            logger.error(f"Failed to get products details batch: {e}")

        return products_detail_map

    async def fetch_prices_batch(
        self,
        client: OzonAPIClient,
        offer_ids: List[str],
        batch_size: int = 1000,
    ) -> Dict[str, Dict]:
        """
        批量获取价格信息

        Args:
            client: OZON API 客户端
            offer_ids: 商品 offer_id 列表
            batch_size: 每批获取数量

        Returns:
            {offer_id: price_info} 映射
        """
        products_price_map: Dict[str, Dict] = {}

        if not offer_ids:
            return products_price_map

        try:
            for i in range(0, len(offer_ids), batch_size):
                batch_ids = offer_ids[i:i + batch_size]
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
            logger.error(f"Failed to get products prices batch: {e}")

        return products_price_map

    async def fetch_stocks_batch(
        self,
        client: OzonAPIClient,
        products_detail_map: Dict[str, Dict],
        batch_size: int = 500,
    ) -> Dict[str, Dict]:
        """
        批量获取库存信息（使用 /v1/product/info/stocks-by-warehouse/fbs API）

        此 API 直接返回 warehouse_id 和 warehouse_name，比旧 API 更准确

        Args:
            client: OZON API 客户端
            products_detail_map: {offer_id: product_detail} 映射，用于获取 SKU
            batch_size: 每批获取数量（API 限制 500）

        Returns:
            {offer_id: stock_info} 映射
        """
        products_stock_map: Dict[str, Dict] = {}

        if not products_detail_map:
            return products_stock_map

        # 构建 SKU 到 offer_id 的映射
        sku_to_offer_id: Dict[int, str] = {}
        for offer_id, detail in products_detail_map.items():
            sku = detail.get("sku")
            if sku:
                sku_to_offer_id[int(sku)] = offer_id

        if not sku_to_offer_id:
            logger.warning("No SKU found in products_detail_map, skipping stock fetch")
            return products_stock_map

        skus = list(sku_to_offer_id.keys())

        try:
            for i in range(0, len(skus), batch_size):
                batch_skus = skus[i:i + batch_size]
                stock_response = await client.get_fbs_stocks_by_warehouse(skus=batch_skus)

                # 按 offer_id 聚合库存数据
                offer_stocks: Dict[str, List[Dict]] = {}

                for stock_item in stock_response.get("result", []):
                    offer_id = stock_item.get("offer_id")
                    if not offer_id:
                        continue

                    if offer_id not in offer_stocks:
                        offer_stocks[offer_id] = []

                    offer_stocks[offer_id].append({
                        "warehouse_id": stock_item.get("warehouse_id"),
                        "warehouse_name": stock_item.get("warehouse_name"),
                        "present": stock_item.get("present", 0),
                        "reserved": stock_item.get("reserved", 0)
                    })

                # 汇总每个商品的库存
                for offer_id, stocks in offer_stocks.items():
                    total_present = sum(s["present"] for s in stocks)
                    total_reserved = sum(s["reserved"] for s in stocks)

                    products_stock_map[offer_id] = {
                        "present": total_present,
                        "reserved": total_reserved,
                        "total": total_present + total_reserved,
                        "warehouse_stocks": stocks
                    }

        except Exception as e:
            logger.error(f"Failed to get products stock batch: {e}")

        return products_stock_map

    async def fetch_attributes_batch(
        self,
        client: OzonAPIClient,
        offer_ids: List[str],
        visibility: str = "ALL",
        batch_size: int = 100,
    ) -> Dict[str, Dict]:
        """
        批量获取属性信息

        Args:
            client: OZON API 客户端
            offer_ids: 商品 offer_id 列表
            visibility: 可见性过滤器
            batch_size: 每批获取数量

        Returns:
            {offer_id: attr_info} 映射
        """
        products_attributes_map: Dict[str, Dict] = {}

        if not offer_ids:
            return products_attributes_map

        try:
            for i in range(0, len(offer_ids), batch_size):
                batch_ids = offer_ids[i:i + batch_size]
                attr_response = await client.get_product_info_attributes(
                    offer_ids=batch_ids,
                    visibility=visibility
                )

                # /v4/product/info/attributes 返回的 result 是数组，不是 {"items": [...]}
                result = attr_response.get("result")
                if result:
                    # result 可能是数组或字典
                    items = result if isinstance(result, list) else result.get("items", [])
                    for idx, attr_item in enumerate(items):
                        # 类型检查
                        if not isinstance(attr_item, dict):
                            logger.warning(
                                f"Unexpected item type in attributes response: "
                                f"{type(attr_item).__name__}, skipping item {idx}"
                            )
                            continue

                        if attr_item.get("offer_id"):
                            products_attributes_map[attr_item["offer_id"]] = attr_item
        except Exception as e:
            logger.error(f"Failed to get products attributes batch: {e}")

        return products_attributes_map
