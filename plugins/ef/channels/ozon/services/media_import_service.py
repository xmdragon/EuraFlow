"""
OZON媒体导入服务
负责Cloudinary图片URL的验证、提交、状态轮询与日志记录
"""
import asyncio
import re
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
import aiohttp

from ef_core.utils.logger import get_logger
from ..api.client import OzonAPIClient
from ..models.listing import OzonMediaImportLog

logger = get_logger(__name__)


class MediaImportService:
    """OZON媒体导入服务"""

    # Cloudinary URL 正则模式
    CLOUDINARY_URL_PATTERN = re.compile(
        r'^https://res\.cloudinary\.com/[^/]+/image/upload/'
    )

    # 支持的图片格式
    SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png']

    # 图片大小限制（10MB）
    MAX_IMAGE_SIZE = 10 * 1024 * 1024

    def __init__(self, ozon_client: OzonAPIClient, db: AsyncSession):
        """
        初始化媒体导入服务

        Args:
            ozon_client: OZON API客户端
            db: 数据库会话
        """
        self.client = ozon_client
        self.db = db

    async def import_images_for_product(
        self,
        shop_id: int,
        offer_id: str,
        image_urls: List[str],
        validate_properties: bool = False
    ) -> Dict[str, Any]:
        """
        为商品导入图片

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID
            image_urls: Cloudinary图片URL列表
            validate_properties: 是否验证图片属性（HEAD请求）

        Returns:
            导入结果
        """
        try:
            logger.info(f"Starting image import for offer_id={offer_id}, {len(image_urls)} images")

            # 1. 验证URL格式
            validated_urls = []
            validation_errors = []

            for idx, url in enumerate(image_urls):
                validation_result = self._validate_cloudinary_url(url)
                if not validation_result["valid"]:
                    validation_errors.append({
                        "position": idx,
                        "url": url,
                        "error": validation_result["error"]
                    })
                    continue

                validated_urls.append({
                    "url": url,
                    "position": idx,
                    "file_name": validation_result["file_name"]
                })

            if validation_errors:
                logger.warning(f"URL validation failed for {len(validation_errors)} images: {validation_errors}")

            if not validated_urls:
                return {
                    "success": False,
                    "error": "No valid image URLs",
                    "validation_errors": validation_errors
                }

            # 2. 可选：验证图片属性（HEAD请求）
            if validate_properties:
                property_errors = []
                for item in validated_urls[:]:
                    check_result = await self._check_image_properties(item["url"])
                    if not check_result["valid"]:
                        property_errors.append({
                            "position": item["position"],
                            "url": item["url"],
                            "error": check_result["error"]
                        })
                        validated_urls.remove(item)

                if property_errors:
                    logger.warning(f"Image property check failed for {len(property_errors)} images")
                    validation_errors.extend(property_errors)

            if not validated_urls:
                return {
                    "success": False,
                    "error": "No images passed validation",
                    "validation_errors": validation_errors
                }

            # 3. 创建导入日志记录
            log_entries = []
            for item in validated_urls:
                log = OzonMediaImportLog(
                    shop_id=shop_id,
                    offer_id=offer_id,
                    source_url=item["url"],
                    file_name=item["file_name"],
                    position=item["position"],
                    state="pending"
                )
                self.db.add(log)
                log_entries.append(log)

            await self.db.flush()  # 获取log ID

            # 4. 调用OZON API导入图片
            try:
                response = await self.client.import_pictures_by_url(
                    picture_urls=[item["url"] for item in validated_urls]
                )

                if not response.get("result"):
                    error_msg = response.get("error", {}).get("message", "Unknown error")
                    logger.error(f"OZON API import_pictures failed: {error_msg}")

                    # 更新所有日志为失败
                    for log in log_entries:
                        log.state = "failed"
                        log.error_message = error_msg

                    await self.db.commit()

                    return {
                        "success": False,
                        "error": error_msg,
                        "validation_errors": validation_errors
                    }

                # 5. 更新日志状态
                result = response["result"]
                pictures = result.get("pictures", [])

                for item, log in zip(validated_urls, log_entries):
                    # 查找对应的OZON响应
                    ozon_picture = next(
                        (p for p in pictures if p.get("url") == item["url"]),
                        None
                    )

                    if ozon_picture:
                        log.ozon_url = ozon_picture.get("url")

                        # 检查是否有错误
                        error = ozon_picture.get("error")
                        if error:
                            log.state = "failed"
                            log.error_code = error
                            log.error_message = ozon_picture.get("error_message", error)
                        else:
                            log.state = "uploading"
                    else:
                        log.state = "failed"
                        log.error_message = "Not found in OZON response"

                await self.db.commit()

                logger.info(f"Image import submitted for offer_id={offer_id}, {len(log_entries)} logs created")

                return {
                    "success": True,
                    "submitted_count": len(validated_urls),
                    "log_ids": [log.id for log in log_entries],
                    "validation_errors": validation_errors if validation_errors else None
                }

            except Exception as e:
                logger.error(f"Failed to call OZON import API: {e}", exc_info=True)

                # 更新日志为失败
                for log in log_entries:
                    log.state = "failed"
                    log.error_message = str(e)

                await self.db.commit()
                raise

        except Exception as e:
            logger.error(f"Image import failed: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    def _validate_cloudinary_url(self, url: str) -> Dict[str, Any]:
        """
        验证Cloudinary URL格式

        Args:
            url: 图片URL

        Returns:
            验证结果
        """
        if not url:
            return {"valid": False, "error": "Empty URL"}

        # 检查是否为Cloudinary URL
        if not self.CLOUDINARY_URL_PATTERN.match(url):
            return {"valid": False, "error": "Not a valid Cloudinary URL"}

        # 提取文件名
        file_name = url.split('/')[-1]

        # 检查文件扩展名
        ext = file_name.split('.')[-1].lower()
        if ext not in self.SUPPORTED_FORMATS:
            return {
                "valid": False,
                "error": f"Unsupported format: {ext}. Supported: {self.SUPPORTED_FORMATS}"
            }

        return {
            "valid": True,
            "file_name": file_name
        }

    async def _check_image_properties(self, url: str) -> Dict[str, Any]:
        """
        检查图片属性（HEAD请求）

        Args:
            url: 图片URL

        Returns:
            检查结果
        """
        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.head(url) as response:
                    # 检查状态码
                    if response.status != 200:
                        return {
                            "valid": False,
                            "error": f"HTTP {response.status}"
                        }

                    # 检查Content-Type
                    content_type = response.headers.get('Content-Type', '')
                    if not content_type.startswith('image/'):
                        return {
                            "valid": False,
                            "error": f"Invalid Content-Type: {content_type}"
                        }

                    # 检查文件大小
                    content_length = response.headers.get('Content-Length')
                    if content_length:
                        size = int(content_length)
                        if size > self.MAX_IMAGE_SIZE:
                            return {
                                "valid": False,
                                "error": f"Image too large: {size} bytes (max {self.MAX_IMAGE_SIZE})"
                            }

                    return {"valid": True}

        except asyncio.TimeoutError:
            return {"valid": False, "error": "Request timeout"}
        except Exception as e:
            return {"valid": False, "error": str(e)}

    async def poll_import_status(
        self,
        shop_id: int,
        offer_id: str,
        max_retries: int = 10,
        retry_interval: float = 2.0
    ) -> Dict[str, Any]:
        """
        轮询图片导入状态

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID
            max_retries: 最大重试次数
            retry_interval: 重试间隔（秒）

        Returns:
            状态查询结果
        """
        try:
            # 获取该商品的所有待上传/上传中的日志
            stmt = select(OzonMediaImportLog).where(
                and_(
                    OzonMediaImportLog.shop_id == shop_id,
                    OzonMediaImportLog.offer_id == offer_id,
                    OzonMediaImportLog.state.in_(["pending", "uploading"])
                )
            )
            logs = list(await self.db.scalars(stmt))

            if not logs:
                logger.info(f"No pending/uploading logs for offer_id={offer_id}")
                return {"success": True, "all_completed": True}

            picture_urls = [log.source_url for log in logs]
            retry_count = 0

            while retry_count < max_retries:
                # 调用OZON API查询状态
                response = await self.client.get_pictures_import_status(
                    picture_urls=picture_urls
                )

                if not response.get("result"):
                    error_msg = response.get("error", {}).get("message", "Unknown error")
                    logger.error(f"Failed to query import status: {error_msg}")
                    return {"success": False, "error": error_msg}

                result = response["result"]
                pictures = result.get("pictures", [])

                # 更新日志状态
                all_completed = True
                for log in logs:
                    # 查找对应的OZON响应
                    ozon_picture = next(
                        (p for p in pictures if p.get("url") == log.source_url),
                        None
                    )

                    if not ozon_picture:
                        continue

                    state = ozon_picture.get("state", "").lower()

                    if state == "uploaded":
                        log.state = "uploaded"
                        log.ozon_file_id = ozon_picture.get("file_id")
                        log.ozon_url = ozon_picture.get("url")
                    elif state == "failed":
                        log.state = "failed"
                        log.error_code = ozon_picture.get("error", "")
                        log.error_message = ozon_picture.get("error_message", "")
                    else:
                        # 仍在上传中
                        all_completed = False

                await self.db.commit()

                if all_completed:
                    logger.info(f"All images uploaded for offer_id={offer_id}")
                    return {
                        "success": True,
                        "all_completed": True,
                        "retry_count": retry_count
                    }

                # 等待后重试
                retry_count += 1
                if retry_count < max_retries:
                    await asyncio.sleep(retry_interval)

            # 超过最大重试次数
            logger.warning(f"Import status polling timed out for offer_id={offer_id}")
            return {
                "success": True,
                "all_completed": False,
                "retry_count": retry_count,
                "timeout": True
            }

        except Exception as e:
            logger.error(f"Failed to poll import status: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def get_import_logs(
        self,
        shop_id: int,
        offer_id: str,
        state: Optional[str] = None
    ) -> List[OzonMediaImportLog]:
        """
        获取图片导入日志

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID
            state: 状态过滤（可选）

        Returns:
            日志列表
        """
        stmt = select(OzonMediaImportLog).where(
            and_(
                OzonMediaImportLog.shop_id == shop_id,
                OzonMediaImportLog.offer_id == offer_id
            )
        )

        if state:
            stmt = stmt.where(OzonMediaImportLog.state == state)

        stmt = stmt.order_by(OzonMediaImportLog.position)

        result = await self.db.scalars(stmt)
        return list(result)

    async def retry_failed_imports(
        self,
        shop_id: int,
        offer_id: str,
        max_retry_count: int = 3
    ) -> Dict[str, Any]:
        """
        重试失败的图片导入

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID
            max_retry_count: 最大重试次数

        Returns:
            重试结果
        """
        try:
            # 获取失败的日志（未超过最大重试次数）
            stmt = select(OzonMediaImportLog).where(
                and_(
                    OzonMediaImportLog.shop_id == shop_id,
                    OzonMediaImportLog.offer_id == offer_id,
                    OzonMediaImportLog.state == "failed",
                    OzonMediaImportLog.retry_count < max_retry_count
                )
            )
            failed_logs = list(await self.db.scalars(stmt))

            if not failed_logs:
                logger.info(f"No failed imports to retry for offer_id={offer_id}")
                return {"success": True, "retry_count": 0}

            # 提取URL并调用API
            picture_urls = [log.source_url for log in failed_logs]

            response = await self.client.import_pictures_by_url(
                picture_urls=picture_urls
            )

            if not response.get("result"):
                error_msg = response.get("error", {}).get("message", "Unknown error")
                logger.error(f"Retry import failed: {error_msg}")
                return {"success": False, "error": error_msg}

            # 更新日志状态
            result = response["result"]
            pictures = result.get("pictures", [])

            for log in failed_logs:
                ozon_picture = next(
                    (p for p in pictures if p.get("url") == log.source_url),
                    None
                )

                log.retry_count += 1
                log.last_retry_at = datetime.utcnow()

                if ozon_picture:
                    error = ozon_picture.get("error")
                    if error:
                        log.error_code = error
                        log.error_message = ozon_picture.get("error_message", error)
                    else:
                        log.state = "uploading"
                        log.error_code = None
                        log.error_message = None

            await self.db.commit()

            logger.info(f"Retried {len(failed_logs)} failed imports for offer_id={offer_id}")

            return {
                "success": True,
                "retry_count": len(failed_logs),
                "log_ids": [log.id for log in failed_logs]
            }

        except Exception as e:
            logger.error(f"Failed to retry imports: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}
