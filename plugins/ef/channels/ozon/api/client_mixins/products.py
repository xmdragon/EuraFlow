"""
Ozon API 商品相关方法
"""

from typing import Any, Dict, List, Optional

from ef_core.utils.logger import get_logger

logger = get_logger(__name__)


class ProductsMixin:
    """商品相关 API 方法"""

    async def get_products(
        self, limit: int = 100, last_id: Optional[str] = None, filter: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        获取商品列表

        Args:
            limit: 每页数量
            last_id: 上一页最后一个商品ID（用于分页）
            filter: 筛选条件

        Returns:
            商品列表数据
        """
        data = {"limit": limit, "filter": filter or {"visibility": "ALL"}}  # 获取所有商品，包括不可见的

        if last_id:
            data["last_id"] = last_id

        return await self._request("POST", "/v3/product/list", data=data, resource_type="products")

    async def get_product_info(self, offer_id: str = None, product_id: int = None) -> Dict[str, Any]:
        """
        获取商品详细信息（包含图片）

        Args:
            offer_id: 商品的offer_id
            product_id: 商品的product_id

        Returns:
            商品详情数据
        """
        payload = {}
        if offer_id:
            payload["offer_id"] = offer_id
        elif product_id:
            payload["product_id"] = product_id
        else:
            raise ValueError("Either offer_id or product_id must be provided")

        return await self._request("POST", "/v2/product/info", data=payload, resource_type="products")

    async def get_product_info_list(
        self,
        offer_ids: Optional[List[str]] = None,
        product_ids: Optional[List[int]] = None,
        skus: Optional[List[int]] = None,
    ) -> Dict[str, Any]:
        """
        批量获取商品详细信息（包含图片）
        使用 /v3/product/info/list 接口

        Args:
            offer_ids: 商品的offer_id列表（最多1000个）
            product_ids: 商品的product_id列表（最多1000个）
            skus: 商品的SKU列表（最多1000个）

        Returns:
            商品详情数据，包含images字段
        """
        payload = {}

        if offer_ids:
            payload["offer_id"] = offer_ids
        elif product_ids:
            payload["product_id"] = product_ids
        elif skus:
            payload["sku"] = skus
        else:
            raise ValueError("At least one of offer_ids, product_ids or skus must be provided")

        return await self._request("POST", "/v3/product/info/list", data=payload, resource_type="products")

    async def get_product_info_attributes(
        self,
        offer_ids: Optional[List[str]] = None,
        product_ids: Optional[List[int]] = None,
        skus: Optional[List[int]] = None,
        limit: int = 100,
        last_id: Optional[str] = None,
        visibility: str = "ALL",
        sort_by: Optional[str] = None,
        sort_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        获取商品详细属性信息（包含attributes, barcode, dimensions等）
        使用 /v4/product/info/attributes 接口

        Args:
            offer_ids: 商品的offer_id列表（最多1000个）
            product_ids: 商品的product_id列表（最多1000个）
            skus: 商品的SKU列表（最多1000个）
            limit: 每页数量（1-1000）
            last_id: 上一页最后一个商品ID（用于分页）
            visibility: 商品可见性过滤（ALL/VISIBLE/INVISIBLE/ARCHIVED等）
            sort_by: 排序字段（sku/offer_id/id/title）
            sort_dir: 排序方向（asc/desc）

        Returns:
            商品详细属性数据
        """
        # 构建过滤器
        filter_data = {"visibility": visibility}

        # 添加商品ID过滤
        if offer_ids:
            filter_data["offer_id"] = offer_ids
        elif product_ids:
            filter_data["product_id"] = [str(pid) for pid in product_ids]
        elif skus:
            filter_data["sku"] = [str(sku) for sku in skus]

        # 构建请求体
        payload = {
            "filter": filter_data,
            "limit": min(limit, 1000),  # 最大1000
        }

        if last_id:
            payload["last_id"] = last_id

        if sort_by:
            payload["sort_by"] = sort_by

        if sort_dir:
            payload["sort_dir"] = sort_dir

        return await self._request("POST", "/v4/product/info/attributes", data=payload, resource_type="products")

    async def update_prices(self, prices: List[Dict]) -> Dict[str, Any]:
        """
        批量更新商品价格

        Args:
            prices: 价格更新列表
                [{
                    "product_id": 123,
                    "offer_id": "SKU123",
                    "price": "1000",
                    "old_price": "1200",
                    "net_price": "800",  # 成本价（可选）
                    "min_price_for_auto_actions_enabled": True  # 启用自动定价最低价（可选）
                }]
        """
        prices_data = []
        for price in prices:
            price_item = {}

            # 必须有product_id或offer_id之一
            if price.get("product_id"):
                price_item["product_id"] = price["product_id"]
            if price.get("offer_id"):
                price_item["offer_id"] = price["offer_id"]

            # 价格字段（转换为字符串格式）
            price_item["price"] = str(price.get("price", 0))

            # 货币代码（必需，必须由调用方提供，不能更改）
            if "currency_code" in price:
                price_item["currency_code"] = price["currency_code"]
            else:
                # 如果没有提供，使用CNY作为默认值（仅用于新商品）
                price_item["currency_code"] = "CNY"

            # 自动定价开关（默认禁用，避免手动价格被自动改价覆盖）
            price_item["auto_action_enabled"] = price.get("auto_action_enabled", "DISABLED")

            # 价格策略开关（默认禁用，确保手动价格生效）
            price_item["price_strategy_enabled"] = price.get("price_strategy_enabled", "DISABLED")

            # 原价（可选）- 只有当存在且不为空时才添加
            if price.get("old_price"):
                price_item["old_price"] = str(price["old_price"])

            # 成本价（可选，新增字段）
            if price.get("net_price"):
                price_item["net_price"] = str(price["net_price"])

            # 启用自动定价最低价（可选，新增字段）
            if "min_price_for_auto_actions_enabled" in price:
                price_item["min_price_for_auto_actions_enabled"] = price["min_price_for_auto_actions_enabled"]

            prices_data.append(price_item)

        return await self._request(
            "POST", "/v1/product/import/prices", data={"prices": prices_data}, resource_type="products"
        )

    async def update_stocks(self, stocks: List[Dict]) -> Dict[str, Any]:
        """
        批量更新库存
        使用 /v2/products/stocks API

        Args:
            stocks: 库存更新列表
                [{"product_id": 123, "offer_id": "SKU123", "stock": 100, "warehouse_id": 1}]
        """
        # 确保每个库存项都有warehouse_id
        stocks_data = []
        for stock in stocks:
            stock_item = {
                "offer_id": stock.get("offer_id"),
                "product_id": stock.get("product_id"),
                "stock": stock.get("stock", 0),
                "warehouse_id": stock.get("warehouse_id", 1),  # 默认仓库ID为1
            }
            stocks_data.append(stock_item)

        return await self._request(
            "POST", "/v2/products/stocks", data={"stocks": stocks_data}, resource_type="products"
        )

    async def get_product_stocks(
        self, offer_ids: List[str] = None, product_ids: List[int] = None, limit: int = 1000, cursor: str = ""
    ) -> Dict[str, Any]:
        """
        获取商品库存信息
        使用 /v4/product/info/stocks API

        Args:
            offer_ids: 商品offer_id列表
            product_ids: 商品product_id列表
            limit: 每页商品数量，最大1000
            cursor: 分页游标

        Returns:
            库存信息响应
        """
        data = {
            "limit": min(limit, 1000),
            "filter": {}
        }

        if cursor:
            data["cursor"] = cursor

        # 设置筛选条件
        if offer_ids:
            data["filter"]["offer_id"] = offer_ids[:1000]  # 限制最多1000个
        elif product_ids:
            data["filter"]["product_id"] = product_ids[:1000]  # 限制最多1000个
        else:
            # 如果都没有提供，获取所有商品
            data["filter"] = {}

        return await self._request(
            "POST", "/v4/product/info/stocks", data=data, resource_type="products"
        )

    async def archive_products(self, product_ids: List[int]) -> Dict[str, Any]:
        """
        将商品归档

        Args:
            product_ids: 要归档的商品ID列表

        Returns:
            归档结果
        """
        return await self._request(
            "POST", "/v1/product/archive", data={"product_ids": product_ids}, resource_type="products"
        )

    async def unarchive_products(self, product_ids: List[int]) -> Dict[str, Any]:
        """
        从归档中恢复商品

        Args:
            product_ids: 要恢复的商品ID列表

        Returns:
            恢复结果
        """
        return await self._request(
            "POST", "/v1/product/unarchive", data={"product_id": product_ids}, resource_type="products"
        )

    async def delete_products(self, product_ids: List[int]) -> Dict[str, Any]:
        """
        删除商品（仅限未通过审核的商品）

        Args:
            product_ids: 要删除的商品ID列表

        Returns:
            删除结果
        """
        return await self._request(
            "POST", "/v2/products/delete", data={"product_ids": product_ids}, resource_type="products"
        )

    async def update_product_media(self, products: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        更新商品媒体（图片）
        注意：OZON API一次只能更新一个商品的图片

        Args:
            products: 商品媒体更新列表（目前只处理第一个）
                [{
                    "product_id": OZON商品ID,
                    "offer_id": "商品SKU",
                    "images": ["图片URL1", "图片URL2", ...]  # 最多15张
                }]

        Returns:
            更新结果
        """
        if not products:
            return {"success": False, "error": "No products provided"}

        # OZON API只支持单个商品更新，取第一个
        product = products[0]

        # 构建请求数据 - 根据API文档，是单个对象而不是items数组
        request_data = {
            "product_id": product.get("product_id", 0),  # OZON商品ID（必须大于0）
            "images": product["images"][:15],  # OZON限制最多15张
            "images360": [],  # 360度图片，暂不支持
            "color_image": ""  # 颜色图片，暂不支持
        }

        # 调试日志
        logger.info(
            f"[OZON API] Updating product media - product_id: {request_data['product_id']}, "
            f"image_count: {len(request_data['images'])}"
        )
        logger.info(f"[OZON API] Full request data: {request_data}")

        return await self._request(
            "POST", "/v1/product/pictures/import",
            data=request_data,
            resource_type="products"
        )

    async def get_product_prices(
        self,
        offer_ids: Optional[List[str]] = None,
        product_ids: Optional[List[int]] = None,
        skus: Optional[List[int]] = None
    ) -> Dict[str, Any]:
        """
        获取商品价格信息（包含市场最低价和价格指数）
        使用 /v5/product/info/prices 接口

        Args:
            offer_ids: 商品offer_id列表
            product_ids: 商品product_id列表
            skus: 商品SKU列表

        Returns:
            价格信息，包含price_indexes字段
        """
        # 构造请求数据，使用filter字段
        filter_data = {}

        if offer_ids:
            filter_data["offer_id"] = offer_ids
        elif product_ids:
            filter_data["product_id"] = [str(pid) for pid in product_ids]
        elif skus:
            filter_data["sku"] = [str(sku) for sku in skus]
        else:
            raise ValueError("At least one of offer_ids, product_ids or skus must be provided")

        # 计算实际请求的商品数量，并限制在API允许范围内
        if offer_ids:
            item_count = len(offer_ids)
        elif product_ids:
            item_count = len(product_ids)
        elif skus:
            item_count = len(skus)
        else:
            item_count = 0

        data = {
            "filter": filter_data,
            "limit": min(max(item_count, 1), 1000)  # API limit is 1000, minimum is 1
        }

        return await self._request(
            "POST",
            "/v5/product/info/prices",
            data=data,
            resource_type="products"
        )

    async def get_product_analytics(
        self,
        date_from: str,
        date_to: str,
        dimension: str = "sku",
        filters: Optional[List[Dict]] = None,
        metrics: Optional[List[str]] = None,
        sort: Optional[List[Dict]] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        获取商品分析数据
        使用 /v1/analytics/data 接口

        Args:
            date_from: 开始日期 (YYYY-MM-DD)
            date_to: 结束日期 (YYYY-MM-DD)
            dimension: 分组维度，如 "sku"
            filters: 筛选条件
            metrics: 要获取的指标列表
            sort: 排序条件
            limit: 返回数量限制
            offset: 偏移量

        Returns:
            分析数据
        """
        data = {
            "date_from": date_from,
            "date_to": date_to,
            "dimension": dimension,
            "limit": limit,
            "offset": offset
        }

        if filters:
            data["filters"] = filters

        if metrics:
            data["metrics"] = metrics
        else:
            # 默认获取基础指标
            data["metrics"] = [
                "revenue",
                "ordered_units",
                "hits_view",
                "hits_tocart",
                "conv_tocart_pdp"
            ]

        if sort:
            data["sort"] = sort

        return await self._request(
            "POST",
            "/v1/analytics/data",
            data=data,
            resource_type="analytics"
        )

    async def get_pricing_competitors(
        self, skus: Optional[List[str]] = None, page: int = 1, limit: int = 50
    ) -> Dict[str, Any]:
        """
        获取竞争对手列表 - 在其他在线商店和电商平台上拥有类似商品的卖家

        Args:
            skus: 商品SKU列表（可选）
            page: 页码（必须大于0）
            limit: 每页数量（默认50，最大50）

        Returns:
            竞争对手数据
        """
        data = {
            "page": page,
            "limit": limit
        }

        if skus:
            data["competitors"] = [{"sku": sku} for sku in skus]

        return await self._request(
            "POST",
            "/v1/pricing-strategy/competitors/list",
            data=data,
            resource_type="products"
        )

    async def get_pricing_strategy_product_info(
        self,
        product_id: int
    ) -> Dict[str, Any]:
        """
        获取商品的定价策略信息（包含竞争对手/跟卖者数据）
        使用 /v1/pricing-strategy/product/info 接口

        Args:
            product_id: 商品ID（单个）

        Returns:
            包含竞争对手数量和价格信息的响应
        """
        data = {
            "product_id": product_id
        }

        return await self._request(
            "POST",
            "/v1/pricing-strategy/product/info",
            data=data,
            resource_type="products"
        )

    async def get_other_sellers_info(
        self,
        product_id: str
    ) -> Dict[str, Any]:
        """
        获取其他卖家报价信息（跟卖者数据）
        使用Ozon内部API /api/entrypoint-api.bx/page/json/v2

        Args:
            product_id: 商品ID（字符串格式）

        Returns:
            包含跟卖者数量和价格信息的响应
        """
        import json
        import uuid

        import httpx

        # 构建内部API的URL
        url = "https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2"
        params = {
            "url": f"/modal/otherOffersFromSellers?product_id={product_id}&page_changed=true"
        }

        # 生成随机的request ID和view ID
        parent_request_id = uuid.uuid4().hex
        page_view_id = str(uuid.uuid4())

        headers = {
            # 标准浏览器headers
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
            "Referer": f"https://www.ozon.ru/product/qiaokusu-ryukzak-{product_id}/",
            "DNT": "1",

            # Chrome特定headers
            "sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',

            # Ozon特定headers（关键）
            "x-o3-app-name": "dweb_client",
            "x-o3-app-version": "release_25-8-2025_c6d5b320",
            "x-o3-manifest-version": "frontend-ozon-ru:c6d5b3205ea9adaa4ca34493051e957faffe77a9,fav-render-api:93f251ad7ca32b41934e73845a1ac014383d3f95,sf-render-api:537287ee45b8d0188f66bdcc3d37fffd5cf9f9f9,pdp-render-api:49f8e29714c596de49f896cb40e9986fc476ce0f,checkout-render-api:17014812dc2374eaa72bf07892c92c383e87b704",
            "x-o3-parent-requestid": parent_request_id,
            "x-page-view-id": page_view_id,
        }

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=headers) as client:
            try:
                response = await client.get(url, params=params)
                response.raise_for_status()

                data = response.json()

                # 解析响应提取跟卖者信息
                result = {
                    "success": True,
                    "product_id": product_id,
                    "seller_count": 0,
                    "min_price": None,
                    "sellers": [],
                    "raw_data": None  # 暂时不返回原始数据，避免日志过大
                }

                # 尝试从widgetStates中提取数据
                if "widgetStates" in data:
                    widget_states = data["widgetStates"]

                    # 遍历widgetStates寻找跟卖者信息
                    for key, value in widget_states.items():
                        if isinstance(value, str):
                            try:
                                # 尝试解析JSON字符串
                                widget_data = json.loads(value)

                                # 查找包含卖家信息的字段
                                if "sellers" in widget_data or "items" in widget_data:
                                    sellers_list = widget_data.get("sellers", widget_data.get("items", []))
                                    result["seller_count"] = len(sellers_list)
                                    result["sellers"] = sellers_list[:10]  # 只保存前10个

                                    # 提取最低价格
                                    if sellers_list:
                                        prices = []
                                        for seller in sellers_list:
                                            if "price" in seller:
                                                try:
                                                    price = float(seller["price"])
                                                    prices.append(price)
                                                except (ValueError, TypeError):
                                                    pass
                                        if prices:
                                            result["min_price"] = min(prices)

                                # 检查是否有总数信息
                                if "totalCount" in widget_data:
                                    result["seller_count"] = widget_data["totalCount"]
                                elif "total" in widget_data:
                                    result["seller_count"] = widget_data["total"]

                            except json.JSONDecodeError:
                                continue

                return result

            except httpx.HTTPStatusError as e:
                logger.error(f"Failed to get other sellers info: {e}")
                return {
                    "success": False,
                    "error": f"HTTP {e.response.status_code}",
                    "message": str(e)
                }
            except Exception as e:
                logger.error(f"Unexpected error getting other sellers info: {e}")
                return {
                    "success": False,
                    "error": str(e)
                }
