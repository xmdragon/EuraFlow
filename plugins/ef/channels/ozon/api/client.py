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
                "actions": 10,  # 促销活动接口：10 req/s
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

            # 安全地解析JSON响应（避免UTF-8解码错误）
            try:
                result = response.json()
            except UnicodeDecodeError as e:
                # 如果无法解码为UTF-8，可能是二进制响应（如PDF）
                logger.error(
                    f"Failed to decode response as JSON (UTF-8 error): {endpoint}",
                    extra={
                        "request_id": request_id,
                        "content_type": response.headers.get('content-type'),
                        "content_length": len(response.content)
                    }
                )
                raise ValueError(f"OZON API返回了无法解码的响应 (UTF-8错误)，可能返回了二进制数据") from e

            # 记录成功
            logger.info(
                f"Ozon API success: {method} {endpoint}",
                extra={"request_id": request_id, "status_code": response.status_code},
            )

            return result

        except httpx.HTTPStatusError as e:
            # 安全地获取响应内容（避免二进制PDF解码错误）
            try:
                response_content = e.response.text
            except UnicodeDecodeError:
                # 如果是二进制内容（如PDF），记录content-type和大小
                response_content = f"<binary content, type={e.response.headers.get('content-type')}, size={len(e.response.content)} bytes>"
            except Exception:
                response_content = "<unable to decode response>"

            logger.error(
                f"Ozon API error: {e.response.status_code}",
                extra={"request_id": request_id, "response": response_content},
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
            商品详细属性数据，包含：
            - attributes: 商品特征数组
            - barcode/barcodes: 条形码
            - dimensions (width/height/depth/weight): 尺寸和重量
            - images/primary_image: 图片信息
            - model_info: 型号信息
            - pdf_list: PDF文件列表
            等详细属性
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
            "dir": "desc",  # 降序：从新到旧
            "filter": {"since": since_str, "to": to_str},
            "limit": limit,
            "offset": offset,
            "with": {"analytics_data": True, "financial_data": True},
        }

        if status:
            data["filter"]["status"] = status

        return await self._request("POST", "/v3/posting/fbs/list", data=data, resource_type="orders")

    async def get_posting_details(
        self,
        posting_number: str,
        with_analytics_data: bool = False,
        with_barcodes: bool = False,
        with_financial_data: bool = False,
        with_legal_info: bool = False,
        with_product_exemplars: bool = False,
        with_related_postings: bool = False,
        with_translit: bool = False
    ) -> Dict[str, Any]:
        """
        获取发货单详情
        使用 /v3/posting/fbs/get 接口

        Args:
            posting_number: 货件ID（必需）
            with_analytics_data: 添加分析数据
            with_barcodes: 添加条形码
            with_financial_data: 添加财务数据（包含商品级别的佣金、配送费等明细）
            with_legal_info: 添加法律信息
            with_product_exemplars: 添加产品及份数数据
            with_related_postings: 添加相关货件数量
            with_translit: 完成返回值的拼写转换

        Returns:
            发货单详情，如果开启 with_financial_data，将包含：
            - financial_data: 财务数据汇总
            - products[].financial_data: 每个商品的财务明细
                - item_services: 商品佣金
                - posting_services: 配送服务费用
                等详细费用信息
        """
        data = {
            "posting_number": posting_number
        }

        # 构建 with 参数对象
        with_params = {}
        if with_analytics_data:
            with_params["analytics_data"] = True
        if with_barcodes:
            with_params["barcodes"] = True
        if with_financial_data:
            with_params["financial_data"] = True
        if with_legal_info:
            with_params["legal_info"] = True
        if with_product_exemplars:
            with_params["product_exemplars"] = True
        if with_related_postings:
            with_params["related_postings"] = True
        if with_translit:
            with_params["translit"] = True

        # 如果有任何 with 参数，添加到请求数据中
        if with_params:
            data["with"] = with_params

        return await self._request(
            "POST", "/v3/posting/fbs/get", data=data, resource_type="postings"
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

    async def get_package_labels(
        self, posting_numbers: List[str]
    ) -> Dict[str, Any]:
        """
        批量获取快递面单PDF（最多20个）

        OZON API 端点: POST /v2/posting/fbs/package-label
        标签格式: 70mm宽 × 125mm高（竖向Portrait）

        注意：
        - 建议在订单装配后45-60秒内请求标签
        - 如果至少有一个货件发生错误，则不会为请求中的所有货件准备标签
        - OZON API 直接返回 PDF 二进制数据（非 JSON 格式）

        Args:
            posting_numbers: 货件编号列表（最多20个）

        Returns:
            {
                "file_content": "base64编码的PDF",
                "file_name": "labels.pdf",
                "content_type": "application/pdf"
            }

        Raises:
            ValueError: 超过20个货件
            httpx.HTTPStatusError: OZON API错误（如"The next postings aren't ready"）

        Example:
            >>> result = await client.get_package_labels(["12345-0001-1", "67890-0002-1"])
            >>> pdf_bytes = base64.b64decode(result["file_content"])
        """
        if len(posting_numbers) > 20:
            raise ValueError("最多支持20个货件")

        if not posting_numbers:
            raise ValueError("posting_numbers不能为空")

        payload = {"posting_number": posting_numbers}

        # 限流检查
        await self.rate_limiter.acquire("postings")

        # 生成请求ID
        import uuid
        request_id = str(uuid.uuid4())

        # 构建请求
        headers = {"X-Request-Id": request_id}
        if self.correlation_id:
            headers["X-Correlation-Id"] = self.correlation_id

        try:
            logger.info(
                f"Ozon API request: POST /v2/posting/fbs/package-label",
                extra={"request_id": request_id, "shop_id": self.shop_id}
            )

            response = await self.client.request(
                method="POST",
                url="/v2/posting/fbs/package-label",
                json=payload,
                headers=headers
            )

            response.raise_for_status()

            # OZON API 直接返回 PDF 二进制数据
            import base64
            pdf_base64 = base64.b64encode(response.content).decode('utf-8')

            logger.info(
                f"Ozon API success: POST /v2/posting/fbs/package-label",
                extra={"request_id": request_id, "pdf_size": len(response.content)}
            )

            return {
                "file_content": pdf_base64,
                "file_name": "labels.pdf",
                "content_type": "application/pdf"
            }

        except httpx.HTTPStatusError as e:
            # 安全地获取响应内容（避免二进制PDF解码错误）
            try:
                response_content = e.response.text
            except UnicodeDecodeError:
                response_content = f"<binary content, type={e.response.headers.get('content-type')}, size={len(e.response.content)} bytes>"
            except Exception:
                response_content = "<unable to decode response>"

            logger.error(
                f"Ozon API error: {e.response.status_code}",
                extra={"request_id": request_id, "response": response_content},
            )
            raise
        except Exception as e:
            logger.error(f"获取标签失败: {e}", extra={"request_id": request_id})
            raise

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
        base64_content: str,
        file_name: str
    ) -> Dict[str, Any]:
        """
        发送聊天文件

        Args:
            chat_id: 聊天ID
            base64_content: base64编码的文件内容
            file_name: 文件名（含扩展名）

        Returns:
            发送结果
        """
        data = {
            "chat_id": chat_id,
            "base64_content": base64_content,
            "name": file_name
        }

        return await self._request(
            "POST",
            "/v1/chat/send/file",
            data=data,
            resource_type="default"
        )

    async def mark_chat_as_read(
        self,
        chat_id: str,
        from_message_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        标记聊天为已读

        将指定消息及其之前的所有消息标记为已读。
        如果不提供from_message_id，则标记所有消息为已读。

        Args:
            chat_id: 聊天ID
            from_message_id: 消息ID（将该消息及其之前的消息标记为已读）

        Returns:
            操作结果，包含 unread_count（未读消息数量）
        """
        data = {
            "chat_id": chat_id
        }

        # 如果提供了消息ID，添加到请求中
        if from_message_id is not None:
            data["from_message_id"] = from_message_id

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

    # ========== 财务相关 API ==========

    async def get_finance_transaction_totals(
        self,
        posting_number: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        transaction_type: str = "all"
    ) -> Dict[str, Any]:
        """
        获取财务清单数目（费用汇总）
        使用 /v3/finance/transaction/totals 接口

        Args:
            posting_number: 发货号（可选，与date参数二选一）
            date_from: 开始日期，格式YYYY-MM-DD或RFC3339（可选）
            date_to: 结束日期，格式YYYY-MM-DD或RFC3339（可选）
            transaction_type: 操作类型，默认"all"
                - all: 所有
                - orders: 订单
                - returns: 退货和取消
                - services: 服务费
                - compensation: 补贴
                - transferDelivery: 快递费用
                - other: 其他

        Returns:
            财务清单汇总数据，包含：
            - accruals_for_sale: 商品总成本和退货
            - sale_commission: 销售佣金
            - processing_and_delivery: 运输处理和配送费
            - refunds_and_cancellations: 退货和取消费用
            - compensation_amount: 补贴
            - money_transfer: 交货和退货费用
            - services_amount: 附加服务成本
            - others_amount: 其他应计费用
        """
        data = {
            "transaction_type": transaction_type
        }

        # 根据参数选择过滤方式（posting_number 或 date）
        if posting_number:
            # 按发货号查询
            data["posting_number"] = posting_number
        elif date_from and date_to:
            # 按日期范围查询
            # 如果是简单日期格式（YYYY-MM-DD），转换为RFC3339格式
            from_date = date_from if 'T' in date_from else f"{date_from}T00:00:00Z"
            to_date = date_to if 'T' in date_to else f"{date_to}T23:59:59Z"

            data["date"] = {
                "from": from_date,
                "to": to_date
            }
        else:
            raise ValueError("Either posting_number or both date_from and date_to must be provided")

        return await self._request(
            "POST",
            "/v3/finance/transaction/totals",
            data=data,
            resource_type="default"
        )

    async def get_finance_transaction_list(
        self,
        posting_number: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        operation_type: Optional[List[str]] = None,
        transaction_type: str = "all",
        page: int = 1,
        page_size: int = 1000
    ) -> Dict[str, Any]:
        """
        获取财务交易明细列表
        使用 /v3/finance/transaction/list 接口

        Args:
            posting_number: 发货号（可选，与date参数二选一）
            date_from: 开始日期，格式YYYY-MM-DD（可选）
            date_to: 结束日期，格式YYYY-MM-DD（可选）
            operation_type: 交易类型列表（可选），如：
                - ClientReturnAgentOperation: 收到买家退货、取消订单
                - MarketplaceMarketingActionCostOperation: 商品促销服务
                - OperationAgentDeliveredToCustomer: 交付给买家
                - OperationClaim: 索赔应计
                - OperationItemReturn: 处理退货费用
                - OperationMarketplaceServiceStorage: 仓储费用
                等（完整列表见API文档）
            transaction_type: 收费类型，默认"all"
                - all: 所有
                - orders: 订单
                - returns: 退货和取消
                - services: 服务费
                - compensation: 补贴
                - transferDelivery: 运费
                - other: 其他
            page: 页码（必须大于0）
            page_size: 每页数量（最大1000）

        Returns:
            财务交易明细列表，包含：
            - operations: 交易操作列表
            - page_count: 总页数
            - row_count: 总交易数
        """
        data = {
            "transaction_type": transaction_type,
            "page": page,
            "page_size": min(page_size, 1000)
        }

        # 构建filter参数
        filter_data = {}

        # 根据参数选择过滤方式（posting_number 或 date）
        if posting_number:
            # 按发货号查询
            filter_data["posting_number"] = posting_number
        elif date_from and date_to:
            # 按日期范围查询
            # 转换为RFC3339格式
            from_date = f"{date_from}T00:00:00Z" if 'T' not in date_from else date_from
            to_date = f"{date_to}T23:59:59Z" if 'T' not in date_to else date_to

            filter_data["date"] = {
                "from": from_date,
                "to": to_date
            }
        else:
            raise ValueError("Either posting_number or both date_from and date_to must be provided")

        # 添加操作类型过滤（可选）
        if operation_type:
            filter_data["operation_type"] = operation_type

        data["filter"] = filter_data

        return await self._request(
            "POST",
            "/v3/finance/transaction/list",
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

    # ========== 商品上架相关 API ==========

    async def get_category_tree(
        self,
        category_id: Optional[int] = None,
        language: str = "ZH_HANS"
    ) -> Dict[str, Any]:
        """
        获取类目树
        使用 /v1/description-category/tree 接口

        Args:
            category_id: 父类目ID（可选，不填则获取根类目）
            language: 语言（ZH_HANS/DEFAULT/RU/EN/TR）

        Returns:
            类目树数据
        """
        data = {
            "language": language
        }

        if category_id:
            data["description_category_id"] = category_id

        return await self._request(
            "POST",
            "/v1/description-category/tree",
            data=data,
            resource_type="products"
        )

    async def get_category_attributes(
        self,
        category_id: int,
        attribute_type: str = "ALL",
        language: str = "DEFAULT"
    ) -> Dict[str, Any]:
        """
        获取类目属性列表
        使用 /v1/description-category/attribute 接口

        Args:
            category_id: 类目ID
            attribute_type: 属性类型（ALL/REQUIRED/OPTIONAL）
            language: 语言（DEFAULT/RU/EN等）

        Returns:
            类目属性列表
        """
        data = {
            "category_id": category_id,
            "attribute_type": attribute_type,
            "language": language
        }

        return await self._request(
            "POST",
            "/v1/description-category/attribute",
            data=data,
            resource_type="products"
        )

    async def get_attribute_values(
        self,
        attribute_id: int,
        category_id: int,
        last_value_id: int = 0,
        limit: int = 5000,
        language: str = "DEFAULT"
    ) -> Dict[str, Any]:
        """
        获取属性字典值列表
        使用 /v2/category/attribute/values 接口

        Args:
            attribute_id: 属性ID
            category_id: 类目ID
            last_value_id: 上次请求的最后一个value_id（用于分页）
            limit: 每页数量（最大5000）
            language: 语言

        Returns:
            属性字典值列表
        """
        data = {
            "attribute_id": attribute_id,
            "category_id": category_id,
            "last_value_id": last_value_id,
            "limit": min(limit, 5000),
            "language": language
        }

        return await self._request(
            "POST",
            "/v2/category/attribute/values",
            data=data,
            resource_type="products"
        )

    async def import_pictures_by_url(
        self,
        picture_urls: List[str]
    ) -> Dict[str, Any]:
        """
        批量导入图片（通过公网URL）
        使用 /v1/product/pictures/import 接口
        OZON会抓取URL并生成file_id

        Args:
            picture_urls: 图片URL列表（公网可访问的HTTPS链接）

        Returns:
            导入结果，包含：
            - result: 导入结果列表
            - pictures: 图片信息列表（包含url和状态）
        """
        if not picture_urls:
            raise ValueError("Picture URLs list cannot be empty")

        # 根据OZON API文档，pictures字段是一个对象数组
        pictures = [{"url": url} for url in picture_urls]

        data = {
            "pictures": pictures
        }

        logger.info(f"[OZON API] Importing {len(pictures)} pictures by URL")

        return await self._request(
            "POST",
            "/v1/product/pictures/import",
            data=data,
            resource_type="products"
        )

    async def get_pictures_import_status(
        self,
        picture_urls: Optional[List[str]] = None,
        page: int = 1,
        page_size: int = 100
    ) -> Dict[str, Any]:
        """
        查询图片导入状态
        使用 /v2/product/pictures/info 接口

        Args:
            picture_urls: 图片URL列表（用于过滤）
            page: 页码
            page_size: 每页数量（最大100）

        Returns:
            图片导入状态信息
        """
        data = {
            "page": page,
            "page_size": min(page_size, 100)
        }

        if picture_urls:
            data["filter"] = {
                "url": picture_urls
            }

        return await self._request(
            "POST",
            "/v2/product/pictures/info",
            data=data,
            resource_type="products"
        )

    async def import_products(
        self,
        products: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        批量导入商品（新建卡或跟随卡）
        使用 /v2/product/import 接口

        Args:
            products: 商品信息列表（最多100个），每个包含：
                - offer_id: 商家SKU（必需，幂等键）
                - barcode: 条码（可选，跟随卡必需）
                - category_id: 类目ID（必需，必须是叶子类目）
                - name: 商品名称（必需）
                - description: 描述（可选）
                - dimensions: 尺寸重量（必需）
                    {"weight": 克, "height": 毫米, "width": 毫米, "length": 毫米}
                - images: 图片文件名列表（可选，如果已导入图片）
                - attributes: 属性列表（必需）
                    [{"attribute_id": id, "value": "值"} or {"attribute_id": id, "dictionary_value_id": id}]

        Returns:
            导入结果，包含：
            - result: {"task_id": 任务ID}
        """
        if not products:
            raise ValueError("Products list cannot be empty")

        if len(products) > 100:
            raise ValueError("Maximum 100 products per batch")

        data = {
            "items": products
        }

        logger.info(f"[OZON API] Importing {len(products)} products")

        return await self._request(
            "POST",
            "/v2/product/import",
            data=data,
            resource_type="products"
        )

    async def get_import_product_info(
        self,
        task_id: str
    ) -> Dict[str, Any]:
        """
        查询商品导入进度和结果
        使用 /v1/product/import/info 接口

        Args:
            task_id: 导入任务ID

        Returns:
            导入状态信息，包含：
            - result: {"items": [商品导入详情列表]}
            每个商品包含：
            - offer_id: 商家SKU
            - product_id: OZON商品ID（导入成功后）
            - status: 状态（imported/failed等）
            - errors: 错误列表（如果失败）
        """
        data = {
            "task_id": task_id
        }

        return await self._request(
            "POST",
            "/v1/product/import/info",
            data=data,
            resource_type="products"
        )

    # ========== 仓库相关 API ==========

    async def get_warehouses(self) -> Dict[str, Any]:
        """
        获取仓库列表（FBS/rFBS）
        使用 /v1/warehouse/list 接口

        Returns:
            仓库列表数据，包含：
            - result: 仓库列表
                [{
                    "warehouse_id": 仓库ID,
                    "name": 仓库名称,
                    "is_rfbs": 是否rFBS,
                    "status": 状态（new/created/disabled等）,
                    "has_entrusted_acceptance": 是否启用受信任接受,
                    "postings_limit": 订单限额（-1=无限制）,
                    "min_postings_limit": 单次供货最小订单数,
                    "has_postings_limit": 是否有订单数限制,
                    "min_working_days": 最少工作天数,
                    "working_days": 工作日列表,
                    "can_print_act_in_advance": 是否可提前打印收发证书,
                    "is_karantin": 是否隔离停运,
                    "is_kgt": 是否接受大宗商品,
                    "is_timetable_editable": 是否可修改时间表,
                    "first_mile_type": 第一英里类型
                }]
        """
        return await self._request(
            "POST",
            "/v1/warehouse/list",
            data={},  # 空body
            resource_type="default"
        )

    # ========== 促销活动相关 API ==========

    async def get_actions(self) -> Dict[str, Any]:
        """
        获取促销活动清单
        使用 /v1/actions 接口

        Returns:
            活动列表数据，包含：
            - result: 活动列表
                [{
                    "id": 活动ID,
                    "title": 活动名称,
                    "description": 活动描述,
                    "date_start": 开始时间,
                    "date_end": 结束时间,
                    "is_participating": 是否参与,
                    ...
                }]
        """
        return await self._request(
            "GET",
            "/v1/actions",
            resource_type="actions"
        )

    async def get_action_candidates(
        self,
        action_id: int,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        获取可参加促销的商品列表（候选商品）
        使用 /v1/actions/candidates 接口

        Args:
            action_id: 活动ID
            limit: 每页数量
            offset: 偏移量

        Returns:
            候选商品列表数据
        """
        data = {
            "action_id": action_id,
            "limit": limit,
            "offset": offset
        }

        return await self._request(
            "POST",
            "/v1/actions/candidates",
            data=data,
            resource_type="actions"
        )

    async def get_action_products(
        self,
        action_id: int,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        获取参与活动的商品列表
        使用 /v1/actions/products 接口

        Args:
            action_id: 活动ID
            limit: 每页数量
            offset: 偏移量

        Returns:
            参与商品列表数据，包含：
            - result: 商品列表
                [{
                    "id": 商品ID,
                    "offer_id": SKU,
                    "price": 促销价格,
                    "stock": 促销库存,
                    "add_mode": 加入方式（manual/automatic）,
                    ...
                }]
        """
        data = {
            "action_id": action_id,
            "limit": limit,
            "offset": offset
        }

        return await self._request(
            "POST",
            "/v1/actions/products",
            data=data,
            resource_type="actions"
        )

    async def activate_action_products(
        self,
        action_id: int,
        products: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        添加商品到促销活动
        使用 /v1/actions/products/activate 接口

        Args:
            action_id: 活动ID
            products: 商品列表，每个包含：
                - product_id: 商品ID
                - action_price: 促销价格
                - stock: 促销库存

        Returns:
            操作结果
        """
        data = {
            "action_id": action_id,
            "products": products
        }

        return await self._request(
            "POST",
            "/v1/actions/products/activate",
            data=data,
            resource_type="actions"
        )

    async def deactivate_action_products(
        self,
        action_id: int,
        product_ids: List[int]
    ) -> Dict[str, Any]:
        """
        从促销活动中移除商品
        使用 /v1/actions/products/deactivate 接口

        Args:
            action_id: 活动ID
            product_ids: 商品ID列表

        Returns:
            操作结果
        """
        data = {
            "action_id": action_id,
            "product_id": product_ids
        }

        return await self._request(
            "POST",
            "/v1/actions/products/deactivate",
            data=data,
            resource_type="actions"
        )
