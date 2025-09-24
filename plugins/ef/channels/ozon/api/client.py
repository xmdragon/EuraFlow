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
            payload["product_id"] = [str(pid) for pid in product_ids]
        elif skus:
            payload["sku"] = [str(sku) for sku in skus]
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
        data = {
            "dir": "asc",
            "filter": {"since": date_from.isoformat() + "Z", "to": date_to.isoformat() + "Z"},
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
            "POST", "/v2/posting/fbs/get", data={"posting_number": posting_number}, resource_type="postings"
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
