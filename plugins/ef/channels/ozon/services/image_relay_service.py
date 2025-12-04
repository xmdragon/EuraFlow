"""
图片中转服务
接收 Base64 数据，上传到图床（Cloudinary/阿里云 OSS），返回图床 URL

用于解决服务器部署在日本无法访问 OZON CDN（403/超时）的问题。
浏览器扩展在中国可以正常访问 OZON CDN，下载图片后通过此服务上传到图床。
"""

import asyncio
import hashlib
import time
from typing import Dict, Any, List

from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.utils.logger import get_logger
from .image_storage_factory import ImageStorageFactory

logger = get_logger(__name__)


# ========== 辅助函数 ==========

def is_already_staged_url(url: str) -> bool:
    """
    判断 URL 是否已经是图床 URL（无需再中转/上传）

    Args:
        url: 图片 URL

    Returns:
        是否为图床 URL
    """
    if not url:
        return False

    staged_domains = [
        # Cloudinary
        'res.cloudinary.com',
        'cloudinary.com',
        # 阿里云 OSS
        '.aliyuncs.com',
        'oss-cn-',
        'oss-ap-',
        # 其他常见图床
        'cdn.hjdtrading.com',
        'static.hjdtrading.com',
    ]

    url_lower = url.lower()
    return any(domain in url_lower for domain in staged_domains)


def is_base64_data(data: str) -> bool:
    """
    判断字符串是否为 Base64 编码的图片数据

    Args:
        data: 可能是 URL 或 Base64 数据

    Returns:
        是否为 Base64 数据
    """
    if not data:
        return False

    # Base64 图片通常以 data:image/ 开头
    if data.startswith('data:image/'):
        return True

    # 或者是纯 Base64 字符串（不含前缀），通过长度和字符集判断
    # 图片 Base64 通常很长（至少几千字符），且只包含 Base64 字符
    if len(data) > 1000 and not data.startswith('http'):
        import re
        # Base64 字符集: A-Z, a-z, 0-9, +, /, =
        if re.match(r'^[A-Za-z0-9+/=]+$', data):
            return True

    return False


class ImageRelayService:
    """图片中转服务 - 接收 Base64 数据，上传到图床，返回图床 URL"""

    # 并发上传限制
    MAX_CONCURRENT_UPLOADS = 5

    async def relay_image(
        self,
        db: AsyncSession,
        base64_data: str,
        original_url: str,
        shop_id: int
    ) -> Dict[str, Any]:
        """
        中转单张图片

        Args:
            db: 数据库会话
            base64_data: Base64 编码的图片数据（可包含 data URL 前缀）
            original_url: 原始图片 URL（用于生成唯一 public_id）
            shop_id: 店铺 ID（用于组织文件夹结构）

        Returns:
            {
                "success": bool,
                "original_url": str,
                "staged_url": str,  # 图床 URL
                "error": str  # 仅失败时返回
            }
        """
        try:
            # 1. 获取图床服务
            storage_service = await ImageStorageFactory.create_from_db(db)

            # 2. 生成唯一的 public_id（基于原始 URL 的 hash）
            url_hash = hashlib.md5(original_url.encode()).hexdigest()[:12]
            timestamp = int(time.time() * 1000)
            public_id = f"relay_{shop_id}_{url_hash}_{timestamp}"

            # 3. 上传到图床
            # 使用 products 文件夹（与正常上传流程一致）
            folder = getattr(storage_service, 'product_images_folder', 'products')

            result = await storage_service.upload_base64_image(
                base64_data=base64_data,
                public_id=public_id,
                folder=folder
            )

            if result.get("success"):
                logger.info(f"图片中转成功: {original_url[:50]}... -> {result['url'][:50]}...")
                return {
                    "success": True,
                    "original_url": original_url,
                    "staged_url": result["url"]
                }
            else:
                error_msg = result.get("error", "上传失败")
                logger.error(f"图片中转失败: {original_url[:50]}... - {error_msg}")
                return {
                    "success": False,
                    "original_url": original_url,
                    "staged_url": None,
                    "error": error_msg
                }

        except Exception as e:
            logger.error(f"图片中转异常: {original_url[:50]}... - {e}", exc_info=True)
            return {
                "success": False,
                "original_url": original_url,
                "staged_url": None,
                "error": str(e)
            }

    async def batch_relay_images(
        self,
        db: AsyncSession,
        images: List[Dict[str, str]],  # [{"url": str, "data": str}]
        shop_id: int
    ) -> Dict[str, Any]:
        """
        批量中转图片，使用信号量控制并发

        Args:
            db: 数据库会话
            images: 图片列表，每项包含 {"url": 原始URL, "data": Base64数据}
            shop_id: 店铺 ID

        Returns:
            {
                "results": [
                    {"original_url": str, "staged_url": str, "success": bool, "error": str}
                ],
                "mapping": {"原始URL": "图床URL"},  # 仅成功的映射
                "success_count": int,
                "failed_count": int
            }
        """
        if not images:
            return {
                "results": [],
                "mapping": {},
                "success_count": 0,
                "failed_count": 0
            }

        logger.info(f"开始批量中转 {len(images)} 张图片, shop_id={shop_id}")

        # 使用信号量限制并发数
        semaphore = asyncio.Semaphore(self.MAX_CONCURRENT_UPLOADS)

        async def relay_with_semaphore(image: Dict[str, str]) -> Dict[str, Any]:
            async with semaphore:
                return await self.relay_image(
                    db=db,
                    base64_data=image["data"],
                    original_url=image["url"],
                    shop_id=shop_id
                )

        # 并发执行所有上传任务
        tasks = [relay_with_semaphore(img) for img in images]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # 处理结果
        processed_results = []
        mapping = {}
        success_count = 0
        failed_count = 0

        for i, result in enumerate(results):
            original_url = images[i]["url"]

            if isinstance(result, Exception):
                # 任务异常
                processed_results.append({
                    "original_url": original_url,
                    "staged_url": None,
                    "success": False,
                    "error": str(result)
                })
                failed_count += 1
            elif result.get("success"):
                # 上传成功
                processed_results.append({
                    "original_url": original_url,
                    "staged_url": result["staged_url"],
                    "success": True
                })
                mapping[original_url] = result["staged_url"]
                success_count += 1
            else:
                # 上传失败
                processed_results.append({
                    "original_url": original_url,
                    "staged_url": None,
                    "success": False,
                    "error": result.get("error", "未知错误")
                })
                failed_count += 1

        logger.info(f"批量中转完成: 成功 {success_count}, 失败 {failed_count}")

        return {
            "results": processed_results,
            "mapping": mapping,
            "success_count": success_count,
            "failed_count": failed_count
        }
