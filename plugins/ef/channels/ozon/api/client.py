"""
Ozon API 客户端
处理与 Ozon API 的所有交互
"""
import asyncio
import json
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import hashlib
import hmac

import httpx

from ef_core.utils.logging import get_logger
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
            headers={
                "Client-Id": self.client_id,
                "Api-Key": self.api_key,
                "Content-Type": "application/json"
            },
            timeout=30.0
        )
        
        # 限流器（每秒请求数）
        self.rate_limiter = RateLimiter(
            rate_limit={
                "products": 10,  # 商品接口：10 req/s
                "orders": 5,     # 订单接口：5 req/s  
                "postings": 20,  # 发货单接口：20 req/s
                "default": 10    # 默认：10 req/s
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
        payload = {
            "filter": {
                "offer_id": [],
                "product_id": [],
                "visibility": "ALL"
            },
            "last_id": "",
            "limit": 1
        }
        
        try:
            start_time = datetime.now()
            result = await self._request(
                "POST",
                endpoint,
                data=payload,
                resource_type="products"
            )
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
                        "endpoint_tested": endpoint
                    }
                }
            }
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                return {
                    "success": False,
                    "message": "Authentication failed",
                    "details": {
                        "error": "Invalid Client-Id or Api-Key"
                    }
                }
            elif e.response.status_code == 403:
                return {
                    "success": False,
                    "message": "Access denied",
                    "details": {
                        "error": "API key doesn't have required permissions"
                    }
                }
            else:
                return {
                    "success": False,
                    "message": f"API error: {e.response.status_code}",
                    "details": {
                        "error": str(e)
                    }
                }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "message": "Connection timeout",
                "details": {
                    "error": "Request timed out"
                }
            }
        except Exception as e:
            return {
                "success": False,
                "message": "Unexpected error",
                "details": {
                    "error": str(e)
                }
            }
    
    async def _request(
        self, 
        method: str, 
        endpoint: str, 
        data: Optional[Dict] = None,
        params: Optional[Dict] = None,
        resource_type: str = "default"
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
        
        # 构建请求
        headers = {"X-Request-Id": request_id}
        if self.correlation_id:
            headers["X-Correlation-Id"] = self.correlation_id
        
        try:
            logger.info(f"Ozon API request: {method} {endpoint}", extra={
                "request_id": request_id,
                "shop_id": self.shop_id
            })
            
            response = await self.client.request(
                method=method,
                url=endpoint,
                json=data,
                params=params,
                headers=headers
            )
            
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
            logger.info(f"Ozon API success: {method} {endpoint}", extra={
                "request_id": request_id,
                "status_code": response.status_code
            })
            
            return result
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Ozon API error: {e.response.status_code}", extra={
                "request_id": request_id,
                "response": e.response.text
            })
            raise
        except Exception as e:
            logger.error(f"Ozon API request failed: {str(e)}", extra={
                "request_id": request_id
            })
            raise
    
    # ========== 商品相关 API ==========
    
    async def get_products(
        self, 
        limit: int = 100,
        last_id: Optional[str] = None,
        filter: Optional[Dict] = None
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
        data = {
            "limit": limit,
            "filter": filter or {}
        }
        
        if last_id:
            data["last_id"] = last_id
        
        return await self._request(
            "POST", 
            "/v3/product/list",
            data=data,
            resource_type="products"
        )
    
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
        
        return await self._request(
            "POST",
            "/v2/product/info",
            data=payload,
            resource_type="products"
        )
    
    async def update_prices(self, prices: List[Dict]) -> Dict[str, Any]:
        """
        批量更新商品价格
        
        Args:
            prices: 价格更新列表
                [{"product_id": 123, "price": "1000", "old_price": "1200"}]
        """
        return await self._request(
            "POST",
            "/v1/product/import/prices",
            data={"prices": prices},
            resource_type="products"
        )
    
    async def update_stocks(self, stocks: List[Dict]) -> Dict[str, Any]:
        """
        批量更新库存
        
        Args:
            stocks: 库存更新列表
                [{"product_id": 123, "offer_id": "SKU123", "stock": 100}]
        """
        return await self._request(
            "POST",
            "/v1/product/import/stocks",
            data={"stocks": stocks},
            resource_type="products"
        )
    
    # ========== 订单相关 API ==========
    
    async def get_orders(
        self,
        date_from: datetime,
        date_to: datetime,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
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
            "filter": {
                "since": date_from.isoformat() + "Z",
                "to": date_to.isoformat() + "Z"
            },
            "limit": limit,
            "offset": offset,
            "with": {
                "analytics_data": True,
                "financial_data": True
            }
        }
        
        if status:
            data["filter"]["status"] = status
        
        return await self._request(
            "POST",
            "/v3/posting/fbs/list",
            data=data,
            resource_type="orders"
        )
    
    async def get_posting_details(self, posting_number: str) -> Dict[str, Any]:
        """获取发货单详情"""
        return await self._request(
            "POST",
            "/v2/posting/fbs/get",
            data={"posting_number": posting_number},
            resource_type="postings"
        )
    
    async def ship_posting(
        self,
        posting_number: str,
        tracking_number: str,
        shipping_provider_id: int,
        items: List[Dict]
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
            "items": items
        }
        
        return await self._request(
            "POST",
            "/v2/posting/fbs/ship",
            data=data,
            resource_type="postings"
        )
    
    async def cancel_posting(
        self,
        posting_number: str,
        cancel_reason_id: int,
        cancel_reason_message: str = ""
    ) -> Dict[str, Any]:
        """取消发货单"""
        data = {
            "posting_number": posting_number,
            "cancel_reason_id": cancel_reason_id,
            "cancel_reason_message": cancel_reason_message
        }
        
        return await self._request(
            "POST",
            "/v2/posting/fbs/cancel",
            data=data,
            resource_type="postings"
        )
    
    # ========== Webhook 相关 ==========
    
    def verify_webhook_signature(
        self,
        payload: bytes,
        signature: str,
        secret: str
    ) -> bool:
        """
        验证 Webhook 签名
        
        Args:
            payload: 请求体原始数据
            signature: 请求头中的签名
            secret: Webhook 密钥
            
        Returns:
            签名是否有效
        """
        expected_signature = hmac.new(
            secret.encode(),
            payload,
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(signature, expected_signature)