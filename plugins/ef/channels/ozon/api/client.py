"""
Ozon API 客户端
处理与 Ozon API 的所有交互
"""

import asyncio
from typing import Dict, Any, Optional, List
from datetime import datetime
import hashlib
import hmac

import httpx

from ef_core.utils.logger import get_logger
from .rate_limiter import RateLimiter

logger = get_logger(__name__)


class OzonAPIClient:
    """Ozon API 客户端"""

    BASE_URL = "https://api-seller.ozon.ru"

    def __init__(self, client_id: str, api_key: str, shop_id: Optional[int] = None):
        """
        初始化 Ozon API 客户端

        Args:
            client_id: Ozon 客户端 ID
            api_key: Ozon API 密钥
            shop_id: 店铺ID（用于多店铺隔离）
        """
        self.client_id = client_id
        self.api_key = api_key
        self.shop_id = shop_id

        # HTTP 客户端配置
        self.client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            headers={"Client-Id": self.client_id, "Api-Key": self.api_key, "Content-Type": "application/json"},
            timeout=30.0,
        )

        # 限流器（每秒请求数）
        self.rate_limiter = RateLimiter(
            rate_limit={
                "products": 10,  # 商品接口：10 req/s
                "orders": 5,  # 订单接口：5 req/s
                "postings": 20,  # 发货单接口：20 req/s
                "analytics": 5,  # 分析接口：5 req/s
                "default": 10,  # 默认：10 req/s
            }
        )

        # 请求追踪
        self.correlation_id = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    async def close(self):
        """关闭客户端连接"""
        await self.client.aclose()

    async def test_connection(self) -> Dict[str, Any]:
        """
        测试API连接
        通过调用一个简单的API端点来验证凭证是否有效

        Returns:
            包含测试结果的字典
        """
        # 使用 product/list API 来测试连接
        endpoint = "/v3/product/list"

        # 最小的请求体，只获取1个商品
        payload = {"filter": {"offer_id": [], "product_id": [], "visibility": "ALL"}, "last_id": "", "limit": 1}

        try:
            start_time = datetime.now()
            result = await self._request("POST", endpoint, data=payload, resource_type="products")
            response_time = (datetime.now() - start_time).total_seconds() * 1000

            # 测试成功，API凭证有效
            return {
                "success": True,
                "message": "Connection successful",
                "details": {
                    "api_version": "v3",
                    "response_time_ms": int(response_time),
                    "test_info": {
                        "status": "API credentials are valid",
                        "products_count": result.get("result", {}).get("total", 0),
                        "endpoint_tested": endpoint,
                    },
                },
            }
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                return {
                    "success": False,
                    "message": "Authentication failed",
                    "details": {"error": "Invalid Client-Id or Api-Key"},
                }
            elif e.response.status_code == 403:
                return {
                    "success": False,
                    "message": "Access denied",
                    "details": {"error": "API key doesn't have required permissions"},
                }
            else:
                return {
                    "success": False,
                    "message": f"API error: {e.response.status_code}",
                    "details": {"error": str(e)},
                }
        except asyncio.TimeoutError:
            return {"success": False, "message": "Connection timeout", "details": {"error": "Request timed out"}}
        except Exception as e:
            return {"success": False, "message": "Unexpected error", "details": {"error": str(e)}}

    async def _request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict] = None,
        params: Optional[Dict] = None,
        resource_type: str = "default",
    ) -> Dict[str, Any]:
        """
        发送 API 请求（带重试和限流）

        Args:
            method: HTTP 方法
            endpoint: API 端点
            data: 请求体数据
            params: 查询参数
            resource_type: 资源类型（用于限流）

        Returns:
            API 响应数据
        """
        # 限流检查
        await self.rate_limiter.acquire(resource_type)

        # 生成请求ID
        import uuid

        request_id = str(uuid.uuid4())

        # 调试日志 - 查看实际发送的数据
        if endpoint == "/v1/product/pictures/import":
            logger.info(f"[DEBUG] _request sending data: {data}")

        # 构建请求
        headers = {"X-Request-Id": request_id}
        if self.correlation_id:
            headers["X-Correlation-Id"] = self.correlation_id

        try:
            logger.info(
                f"Ozon API request: {method} {endpoint}", extra={"request_id": request_id, "shop_id": self.shop_id}
            )

            response = await self.client.request(method=method, url=endpoint, json=data, params=params, headers=headers)

            # 检查响应状态
            if response.status_code == 429:
                # 限流，等待后重试
                retry_after = int(response.headers.get("Retry-After", 60))
                logger.warning(f"Rate limited, retry after {retry_after}s")
                await asyncio.sleep(retry_after)
                raise Exception("Rate limited")

            response.raise_for_status()

            result = response.json()

            # 记录成功
            logger.info(
                f"Ozon API success: {method} {endpoint}",
                extra={"request_id": request_id, "status_code": response.status_code},
            )

            return result

        except httpx.HTTPStatusError as e:
            logger.error(
                f"Ozon API error: {e.response.status_code}",
                extra={"request_id": request_id, "response": e.response.text},
            )
            raise
        except Exception as e:
            logger.error(f"Ozon API request failed: {str(e)}", extra={"request_id": request_id})
            raise

    # ========== 商品相关 API ==========

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

            # 原价（可选）
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
            "POST", "/v2/products/stocks", data={"stocks": stocks_data}, resource_type="products"  # 使用正确的v2端点
        )

    async def get_product_stocks(self, offer_ids: List[str] = None, product_ids: List[int] = None, limit: int = 1000, cursor: str = "") -> Dict[str, Any]:
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
            "POST", "/v1/product/unarchive", data={"product_ids": product_ids}, resource_type="products"
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
        logger.info(f"[OZON API] Updating product media - product_id: {request_data['product_id']}, image_count: {len(request_data['images'])}")
        logger.info(f"[OZON API] Full request data: {request_data}")

        return await self._request(
            "POST", "/v1/product/pictures/import",
            data=request_data,
            resource_type="products"
        )

    # ========== 订单相关 API ==========

    async def get_orders(
        self, date_from: datetime, date_to: datetime, status: Optional[str] = None, limit: int = 100, offset: int = 0
    ) -> Dict[str, Any]:
        """
        获取订单列表

        Args:
            date_from: 开始时间
            date_to: 结束时间
            status: 订单状态筛选
            limit: 每页数量
            offset: 偏移量
        """
        # 将timezone-aware datetime转换为ISO格式（移除tzinfo后添加Z）
        since_str = date_from.replace(tzinfo=None).isoformat() + "Z"
        to_str = date_to.replace(tzinfo=None).isoformat() + "Z"

        data = {
            "dir": "asc",
            "filter": {"since": since_str, "to": to_str},
            "limit": limit,
            "offset": offset,
            "with": {"analytics_data": True, "financial_data": True},
        }

        if status:
            data["filter"]["status"] = status

        return await self._request("POST", "/v3/posting/fbs/list", data=data, resource_type="orders")

    async def get_posting_details(self, posting_number: str) -> Dict[str, Any]:
        """获取发货单详情"""
        return await self._request(
            "POST", "/v3/posting/fbs/get", data={"posting_number": posting_number}, resource_type="postings"
        )

    async def ship_posting(
        self, posting_number: str, tracking_number: str, shipping_provider_id: int, items: List[Dict]
    ) -> Dict[str, Any]:
        """
        发货操作

        Args:
            posting_number: 发货单号
            tracking_number: 物流单号
            shipping_provider_id: 物流商ID
            items: 发货商品列表
        """
        data = {
            "posting_number": posting_number,
            "tracking_number": tracking_number,
            "shipping_provider_id": shipping_provider_id,
            "items": items,
        }

        return await self._request("POST", "/v2/posting/fbs/ship", data=data, resource_type="postings")

    async def ship_posting_v4(
        self, posting_number: str, packages: List[Dict], with_additional_data: bool = True
    ) -> Dict[str, Any]:
        """
        搜集订单（备货操作）- 告诉 OZON 订单已经组装完成
        使用 /v4/posting/fbs/ship 接口

        此操作会将订单状态从 awaiting_packaging 改为 awaiting_deliver

        Args:
            posting_number: 发货单号
            packages: 包裹列表
                [{
                    "products": [
                        {"product_id": 商品ID, "quantity": 数量}
                    ]
                }]
            with_additional_data: 是否返回额外数据（默认True）

        Returns:
            操作结果
        """
        data = {
            "posting_number": posting_number,
            "packages": packages,
            "with": {
                "additional_data": with_additional_data
            }
        }

        return await self._request("POST", "/v4/posting/fbs/ship", data=data, resource_type="postings")

    async def cancel_posting(
        self, posting_number: str, cancel_reason_id: int, cancel_reason_message: str = ""
    ) -> Dict[str, Any]:
        """取消发货单"""
        data = {
            "posting_number": posting_number,
            "cancel_reason_id": cancel_reason_id,
            "cancel_reason_message": cancel_reason_message,
        }

        return await self._request("POST", "/v2/posting/fbs/cancel", data=data, resource_type="postings")

    # ========== FBS备货相关 API（Exemplar） ==========

    async def set_exemplar(
        self, posting_number: str, products: List[Dict[str, Any]], multi_box_qty: int = 0
    ) -> Dict[str, Any]:
        """
        设置发货单的商品样件信息（用于俄罗斯"诚信标志"系统）
        使用 /v6/fbs/posting/product/exemplar/set 接口

        Args:
            posting_number: 发货单号
            products: 商品样件信息列表
                [{
                    "product_id": 商品ID,
                    "exemplars": [{
                        "gtd": "海关申报单号（可选）",
                        "is_gtd_absent": True,  # 如果无GTD设为True
                        "rnpt": "RNPT编号（可选）",
                        "is_rnpt_absent": True,  # 如果无RNPT设为True
                        "marks": [{"mark": "标记", "mark_type": "类型"}]
                    }]
                }]
            multi_box_qty: 多箱数量（默认0）

        Returns:
            设置结果
        """
        data = {
            "posting_number": posting_number,
            "products": products,
            "multi_box_qty": multi_box_qty
        }

        return await self._request("POST", "/v6/fbs/posting/product/exemplar/set", data=data, resource_type="postings")

    async def validate_exemplar(self, posting_number: str, products: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        验证发货单的样件信息是否有效
        使用 /v5/fbs/posting/product/exemplar/validate 接口

        Args:
            posting_number: 发货单号
            products: 商品样件信息（与set_exemplar格式相同）

        Returns:
            验证结果
        """
        data = {
            "posting_number": posting_number,
            "products": products
        }

        return await self._request("POST", "/v5/fbs/posting/product/exemplar/validate", data=data, resource_type="postings")

    async def get_exemplar_status(self, posting_number: str) -> Dict[str, Any]:
        """
        获取发货单的备货状态（样件验证状态）
        使用 /v4/fbs/posting/product/exemplar/status 接口

        Args:
            posting_number: 发货单号

        Returns:
            备货状态信息，包含：
            - status: ship_available（可以备货）| ship_not_available（无法备货）| validation_in_process（验证中）
            - products: 商品列表及其样件信息
        """
        data = {
            "posting_number": posting_number
        }

        return await self._request("POST", "/v4/fbs/posting/product/exemplar/status", data=data, resource_type="postings")

    # ========== 图片管理相关 ==========

    async def import_product_pictures(self, product_id: int, images: List[str]) -> Dict[str, Any]:
        """
        导入商品图片（用于水印后回传）
        使用 /v1/product/pictures/import 接口

        Args:
            product_id: 商品ID
            images: 图片URL列表（第一张为主图，最多15张）

        Returns:
            包含task_id的响应，需要轮询状态
        """
        if not images:
            raise ValueError("Images list cannot be empty")

        if len(images) > 15:
            raise ValueError("Maximum 15 images allowed")

        data = {
            "product_id": product_id,
            "images": images
        }

        return await self._request("POST", "/v1/product/pictures/import", data=data, resource_type="products")

    async def get_picture_import_info(self, task_id: str) -> Dict[str, Any]:
        """
        获取图片导入任务状态
        使用 /v2/product/pictures/info 接口

        Args:
            task_id: 导入任务ID

        Returns:
            任务状态信息
        """
        data = {
            "task_id": task_id
        }

        return await self._request("POST", "/v2/product/pictures/info", data=data, resource_type="products")

    async def update_product_images_by_sku(self, sku: str, images: List[str]) -> Dict[str, Any]:
        """
        通过SKU更新商品图片

        Args:
            sku: 商品SKU
            images: 新的图片URL列表

        Returns:
            更新结果
        """
        # 首先获取商品详情以获得product_id
        product_info = await self.get_product_info(offer_id=sku)

        if not product_info.get("result"):
            raise ValueError(f"Product with SKU {sku} not found")

        product_id = product_info["result"].get("id")
        if not product_id:
            raise ValueError(f"Product ID not found for SKU {sku}")

        # 调用图片导入接口
        return await self.import_product_pictures(product_id, images)

    # ========== 竞争对手和定价策略 API ==========

    async def get_pricing_competitors(self, skus: Optional[List[str]] = None, page: int = 1, limit: int = 50) -> Dict[str, Any]:
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
        import httpx

        # 构建内部API的URL
        url = f"https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2"
        params = {
            "url": f"/modal/otherOffersFromSellers?product_id={product_id}&page_changed=true"
        }

        # 使用独立的httpx客户端调用内部API（不需要认证）
        # 需要follow_redirects以处理307重定向
        # 设置必要的headers来模拟浏览器请求
        import uuid

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
                                import json
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

    # ========== 聊天相关 API ==========

    async def get_chat_list(
        self,
        chat_id_list: Optional[List[str]] = None,
        limit: int = 100,
        cursor: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        获取聊天列表

        Args:
            chat_id_list: 聊天ID列表（可选，用于获取指定聊天）
            limit: 返回数量限制（最大100）
            cursor: 分页游标（可选）

        Returns:
            聊天列表数据，包含：
            - chats: 聊天列表
            - cursor: 下一页游标
            - has_next: 是否有下一页
            - total_unread_count: 总未读数
        """
        data = {
            "limit": min(limit, 100)
        }

        if cursor:
            data["cursor"] = cursor

        if chat_id_list:
            data["chat_id_list"] = chat_id_list

        return await self._request(
            "POST",
            "/v3/chat/list",
            data=data,
            resource_type="default"
        )

    async def get_chat_history(
        self,
        chat_id: str,
        from_message_id: Optional[int] = None,
        limit: int = 100
    ) -> Dict[str, Any]:
        """
        获取聊天历史消息

        Args:
            chat_id: 聊天ID
            from_message_id: 起始消息ID（用于分页）
            limit: 返回数量限制（最大100）

        Returns:
            聊天历史数据
        """
        data = {
            "chat_id": chat_id,
            "limit": min(limit, 100)
        }

        if from_message_id:
            data["from_message_id"] = from_message_id

        return await self._request(
            "POST",
            "/v3/chat/history",
            data=data,
            resource_type="default"
        )

    async def send_chat_message(
        self,
        chat_id: str,
        text: str
    ) -> Dict[str, Any]:
        """
        发送聊天消息

        Args:
            chat_id: 聊天ID
            text: 消息文本内容

        Returns:
            发送结果
        """
        data = {
            "chat_id": chat_id,
            "text": text
        }

        return await self._request(
            "POST",
            "/v1/chat/send/message",
            data=data,
            resource_type="default"
        )

    async def send_chat_file(
        self,
        chat_id: str,
        file_url: str,
        file_name: str
    ) -> Dict[str, Any]:
        """
        发送聊天文件

        Args:
            chat_id: 聊天ID
            file_url: 文件URL
            file_name: 文件名

        Returns:
            发送结果
        """
        data = {
            "chat_id": chat_id,
            "file": {
                "url": file_url,
                "name": file_name
            }
        }

        return await self._request(
            "POST",
            "/v1/chat/send/file",
            data=data,
            resource_type="default"
        )

    async def mark_chat_as_read(
        self,
        chat_id: str
    ) -> Dict[str, Any]:
        """
        标记聊天为已读

        Args:
            chat_id: 聊天ID

        Returns:
            操作结果
        """
        data = {
            "chat_id": chat_id
        }

        return await self._request(
            "POST",
            "/v2/chat/read",
            data=data,
            resource_type="default"
        )

    async def get_chat_updates(
        self,
        chat_id_list: Optional[List[str]] = None,
        from_message_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        获取聊天更新

        Args:
            chat_id_list: 聊天ID列表
            from_message_id: 起始消息ID

        Returns:
            聊天更新数据
        """
        data = {}

        if chat_id_list:
            data["chat_id_list"] = chat_id_list

        if from_message_id:
            data["from_message_id"] = from_message_id

        return await self._request(
            "POST",
            "/v1/chat/updates",
            data=data,
            resource_type="default"
        )

    # ========== Webhook 相关 ==========

    def verify_webhook_signature(self, payload: bytes, signature: str, secret: str) -> bool:
        """
        验证 Webhook 签名

        Args:
            payload: 请求体原始数据
            signature: 请求头中的签名
            secret: Webhook 密钥

        Returns:
            签名是否有效
        """
        expected_signature = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()

        return hmac.compare_digest(signature, expected_signature)
