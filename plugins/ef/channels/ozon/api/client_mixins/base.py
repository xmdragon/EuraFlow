"""
Ozon API 客户端基础类
包含初始化、连接管理、核心请求方法
"""

import asyncio
import time
import uuid
from typing import TYPE_CHECKING, Any, Dict, Optional

import httpx

from ef_core.utils.external_api_timing import log_external_api_timing
from ef_core.utils.logger import get_logger

if TYPE_CHECKING:
    from ..rate_limiter import RateLimiter

logger = get_logger(__name__)


class OzonAPIClientBase:
    """Ozon API 客户端基础类"""

    BASE_URL = "https://api-seller.ozon.ru"

    def __init__(self, client_id: str, api_key: str, shop_id: Optional[int] = None):
        """
        初始化 Ozon API 客户端

        Args:
            client_id: Ozon 客户端 ID
            api_key: Ozon API 密钥
            shop_id: 店铺ID（用于多店铺隔离）
        """
        from ..rate_limiter import RateLimiter

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
        # OZON官方API限流：50 req/s
        self.rate_limiter: "RateLimiter" = RateLimiter(
            rate_limit={
                "products": 50,  # 商品接口：50 req/s
                "orders": 50,  # 订单接口：50 req/s
                "postings": 50,  # 发货单接口：50 req/s
                "analytics": 50,  # 分析接口：50 req/s
                "actions": 50,  # 促销活动接口：50 req/s
                "categories": 50,  # 类目接口：50 req/s
                "default": 50,  # 默认：50 req/s
            }
        )

        # 请求追踪
        self.correlation_id: Optional[str] = None

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
        from datetime import datetime

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
        request_id = str(uuid.uuid4())

        # 调试日志 - 查看实际发送的数据
        if endpoint in ["/v1/product/pictures/import", "/v3/product/import"]:
            logger.info(f"[DEBUG] _request sending data to {endpoint}: {data}")

        # 构建请求
        headers = {"X-Request-Id": request_id}
        if self.correlation_id:
            headers["X-Correlation-Id"] = self.correlation_id

        api_start = time.perf_counter()

        try:
            logger.info(
                f"Ozon API request: {method} {endpoint}", extra={"request_id": request_id, "shop_id": self.shop_id}
            )

            response = await self.client.request(method=method, url=endpoint, json=data, params=params, headers=headers)

            # 记录外部 API 调用耗时
            api_elapsed_ms = (time.perf_counter() - api_start) * 1000

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
                raise ValueError("OZON API返回了无法解码的响应 (UTF-8错误)，可能返回了二进制数据") from e

            # 记录成功（含外部 API 耗时）
            logger.info(
                f"Ozon API success: {method} {endpoint}",
                extra={"request_id": request_id, "status_code": response.status_code},
            )

            # 写入外部 API 计时日志
            log_external_api_timing(
                "OZON", method, endpoint, api_elapsed_ms,
                f"shop={self.shop_id}"
            )

            return result

        except httpx.HTTPStatusError as e:
            # 记录外部 API 耗时（即使失败也记录）
            api_elapsed_ms = (time.perf_counter() - api_start) * 1000

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

            # 写入外部 API 计时日志（错误情况）
            log_external_api_timing(
                "OZON", method, endpoint, api_elapsed_ms,
                f"shop={self.shop_id} | ERROR={e.response.status_code}"
            )

            # 尝试解析JSON错误响应（OZON API通常返回JSON格式的错误）
            try:
                error_json = e.response.json()
                logger.error(f"OZON API JSON error: {error_json}")
                # 返回结构化的错误而不是抛出异常
                return error_json
            except Exception:
                # 如果不是JSON，继续抛出异常
                raise
        except Exception as e:
            # 记录外部 API 耗时（如果已经开始计时）
            api_elapsed_ms = (time.perf_counter() - api_start) * 1000
            log_external_api_timing(
                "OZON", method, endpoint, api_elapsed_ms,
                f"shop={self.shop_id} | EXCEPTION={type(e).__name__}"
            )
            logger.error(f"Ozon API request failed: {str(e)}", extra={"request_id": request_id})
            raise
