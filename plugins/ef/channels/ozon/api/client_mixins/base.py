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
        import json as json_module

        # 限流检查
        await self.rate_limiter.acquire(resource_type)

        # 生成请求ID
        request_id = str(uuid.uuid4())

        # 构建请求
        headers = {"X-Request-Id": request_id}
        if self.correlation_id:
            headers["X-Correlation-Id"] = self.correlation_id

        api_start = time.perf_counter()

        # 截断请求体用于日志（避免日志过大）
        def truncate_for_log(obj, max_len=5000):
            """截断对象用于日志记录"""
            if obj is None:
                return None
            try:
                s = json_module.dumps(obj, ensure_ascii=False)
                if len(s) > max_len:
                    return s[:max_len] + f"... [truncated, total {len(s)} chars]"
                return s
            except Exception:
                return str(obj)[:max_len]

        try:
            # 记录出站请求（含请求参数）
            logger.info(
                "OZON API request",
                direction="outbound",
                method=method,
                endpoint=endpoint,
                url=f"{self.BASE_URL}{endpoint}",
                shop_id=self.shop_id,
                request_id=request_id,
                request_body=truncate_for_log(data),
                query_params=truncate_for_log(params) if params else None,
            )

            response = await self.client.request(method=method, url=endpoint, json=data, params=params, headers=headers)

            # 记录外部 API 调用耗时
            api_elapsed_ms = (time.perf_counter() - api_start) * 1000

            # 检查响应状态
            if response.status_code == 429:
                # 限流，等待后重试
                retry_after = int(response.headers.get("Retry-After", 60))
                logger.warning(
                    "OZON API rate limited",
                    direction="outbound",
                    endpoint=endpoint,
                    retry_after=retry_after,
                    shop_id=self.shop_id,
                )
                await asyncio.sleep(retry_after)
                raise Exception("Rate limited")

            response.raise_for_status()

            # 安全地解析JSON响应（避免UTF-8解码错误）
            try:
                result = response.json()
            except UnicodeDecodeError as e:
                # 如果无法解码为UTF-8，可能是二进制响应（如PDF）
                logger.error(
                    "OZON API response decode error",
                    direction="outbound",
                    endpoint=endpoint,
                    request_id=request_id,
                    content_type=response.headers.get('content-type'),
                    content_length=len(response.content),
                    shop_id=self.shop_id,
                )
                raise ValueError("OZON API返回了无法解码的响应 (UTF-8错误)，可能返回了二进制数据") from e

            # 记录成功响应（含返回值）
            logger.info(
                "OZON API response",
                direction="outbound",
                method=method,
                endpoint=endpoint,
                status_code=response.status_code,
                latency_ms=int(api_elapsed_ms),
                shop_id=self.shop_id,
                request_id=request_id,
                response_body=truncate_for_log(result),
                result="success",
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

            # 记录错误响应
            logger.error(
                "OZON API error response",
                direction="outbound",
                method=method,
                endpoint=endpoint,
                status_code=e.response.status_code,
                latency_ms=int(api_elapsed_ms),
                shop_id=self.shop_id,
                request_id=request_id,
                request_body=truncate_for_log(data),
                response_body=response_content[:5000] if response_content else None,
                result="error",
            )

            # 写入外部 API 计时日志（错误情况）
            log_external_api_timing(
                "OZON", method, endpoint, api_elapsed_ms,
                f"shop={self.shop_id} | ERROR={e.response.status_code}"
            )

            # 尝试解析JSON错误响应（OZON API通常返回JSON格式的错误）
            try:
                error_json = e.response.json()
                # 返回结构化的错误而不是抛出异常
                return error_json
            except Exception:
                # 如果不是JSON，继续抛出异常
                raise
        except Exception as e:
            # 记录外部 API 耗时（如果已经开始计时）
            api_elapsed_ms = (time.perf_counter() - api_start) * 1000

            logger.error(
                "OZON API request failed",
                direction="outbound",
                method=method,
                endpoint=endpoint,
                latency_ms=int(api_elapsed_ms),
                shop_id=self.shop_id,
                request_id=request_id,
                request_body=truncate_for_log(data),
                error=str(e),
                error_type=type(e).__name__,
                result="error",
                exc_info=True,
            )

            log_external_api_timing(
                "OZON", method, endpoint, api_elapsed_ms,
                f"shop={self.shop_id} | EXCEPTION={type(e).__name__}"
            )
            raise
