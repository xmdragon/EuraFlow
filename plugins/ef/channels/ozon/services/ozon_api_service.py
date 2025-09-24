"""
OZON API服务
用于处理与OZON平台的API交互
"""
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

from ..api.client import OzonAPIClient

logger = logging.getLogger(__name__)


class OzonApiService:
    """OZON API服务封装"""

    def __init__(self, client_id: str, api_key: str):
        """
        初始化OZON API服务

        Args:
            client_id: OZON客户端ID
            api_key: OZON API密钥
        """
        self.client = OzonAPIClient(client_id, api_key)

    async def update_product_images(
        self,
        products_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        更新商品图片

        Args:
            products_data: 商品数据列表，每个元素包含:
                - offer_id: 商品ID
                - images: 图片URL列表

        Returns:
            更新结果
        """
        try:
            # 构建请求数据
            items = []
            for product in products_data:
                item = {
                    "product_id": product.get("product_id", 0),  # OZON商品ID
                    "offer_id": product["offer_id"],
                    "images": product["images"][:15]  # OZON限制最多15张图片
                }

                # 确保至少有一张主图
                if item["images"]:
                    items.append(item)
                else:
                    logger.warning(f"Product {product['offer_id']} has no images, skipping")

            if not items:
                return {
                    "success": False,
                    "error": "No valid products to update"
                }

            # 调用OZON API
            result = await self.client.update_product_media(items)

            # 解析响应
            if result.get("result"):
                return {
                    "success": True,
                    "updated_count": len(items),
                    "result": result["result"]
                }
            else:
                error_msg = result.get("error", {}).get("message", "Unknown error")
                logger.error(f"OZON API error: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg,
                    "details": result
                }

        except Exception as e:
            logger.error(f"Failed to update product images: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def get_product_info(
        self,
        offer_id: Optional[str] = None,
        product_id: Optional[int] = None,
        sku: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        """
        获取商品信息

        Args:
            offer_id: 商家商品ID
            product_id: OZON商品ID
            sku: OZON SKU

        Returns:
            商品信息字典，失败返回None
        """
        try:
            # 构建查询参数
            params = {}
            if offer_id:
                params["offer_id"] = offer_id
            if product_id:
                params["product_id"] = product_id
            if sku:
                params["sku"] = sku

            if not params:
                logger.error("No product identifier provided")
                return None

            # 调用API
            result = await self.client.get_product_info(**params)

            if result.get("result"):
                return result["result"]
            else:
                logger.error(f"Failed to get product info: {result}")
                return None

        except Exception as e:
            logger.error(f"Error getting product info: {e}")
            return None

    async def update_product_stocks(
        self,
        stocks_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        更新商品库存

        Args:
            stocks_data: 库存数据列表

        Returns:
            更新结果
        """
        try:
            result = await self.client.update_stocks(stocks_data)
            return {
                "success": bool(result.get("result")),
                "result": result
            }
        except Exception as e:
            logger.error(f"Failed to update stocks: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def update_product_prices(
        self,
        prices_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        更新商品价格

        Args:
            prices_data: 价格数据列表

        Returns:
            更新结果
        """
        try:
            result = await self.client.update_prices(prices_data)
            return {
                "success": bool(result.get("result")),
                "result": result
            }
        except Exception as e:
            logger.error(f"Failed to update prices: {e}")
            return {
                "success": False,
                "error": str(e)
            }