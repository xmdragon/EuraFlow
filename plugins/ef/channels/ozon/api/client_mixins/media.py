"""
Ozon API 图片导入相关方法
"""

from typing import Any, Dict, List, Optional

from ef_core.utils.logger import get_logger

logger = get_logger(__name__)


class MediaMixin:
    """图片导入相关 API 方法"""

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
