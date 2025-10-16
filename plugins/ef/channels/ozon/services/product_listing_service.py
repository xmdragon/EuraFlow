"""
OZON商品上架编排服务
负责协调商品上架生命周期的各个阶段
"""
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime
from decimal import Decimal
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.utils.logger import get_logger
from ..api.client import OzonAPIClient
from ..models.products import OzonProduct
from ..models.listing import (
    OzonPriceUpdateLog,
    OzonStockUpdateLog
)
from .catalog_service import CatalogService
from .media_import_service import MediaImportService
from .product_import_service import ProductImportService

logger = get_logger(__name__)


class ProductListingService:
    """OZON商品上架编排服务"""

    # 状态机状态
    STATUS_DRAFT = "draft"
    STATUS_MEDIA_READY = "media_ready"
    STATUS_IMPORT_SUBMITTED = "import_submitted"
    STATUS_CREATED = "created"
    STATUS_PRICED = "priced"
    STATUS_READY_FOR_SALE = "ready_for_sale"
    STATUS_LIVE = "live"
    STATUS_ERROR = "error"

    def __init__(
        self,
        ozon_client: OzonAPIClient,
        db: AsyncSession
    ):
        """
        初始化上架编排服务

        Args:
            ozon_client: OZON API客户端
            db: 数据库会话
        """
        self.client = ozon_client
        self.db = db

        # 初始化子服务
        self.catalog_service = CatalogService(ozon_client, db)
        self.media_service = MediaImportService(ozon_client, db)
        self.product_service = ProductImportService(ozon_client, db)

    async def list_product(
        self,
        shop_id: int,
        offer_id: str,
        mode: str = "NEW_CARD",
        auto_advance: bool = True
    ) -> Dict[str, Any]:
        """
        商品上架主流程（端到端）

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID
            mode: 上架模式（NEW_CARD/FOLLOW_PDP）
            auto_advance: 是否自动推进到后续阶段

        Returns:
            上架结果
        """
        try:
            logger.info(f"Starting product listing: offer_id={offer_id}, mode={mode}")

            # 获取商品记录
            product = await self._get_product(shop_id, offer_id)
            if not product:
                return {
                    "success": False,
                    "error": f"Product not found: {offer_id}"
                }

            # 设置上架模式
            product.listing_mode = mode

            # 根据当前状态执行相应操作
            current_status = product.listing_status or self.STATUS_DRAFT

            if current_status == self.STATUS_DRAFT:
                # 阶段1：上传图片
                result = await self._stage_upload_media(product)
                if not result["success"]:
                    return result

            if auto_advance and product.listing_status == self.STATUS_MEDIA_READY:
                # 阶段2：提交商品导入
                result = await self._stage_submit_import(product, mode)
                if not result["success"]:
                    return result

            if auto_advance and product.listing_status == self.STATUS_IMPORT_SUBMITTED:
                # 阶段3：轮询导入状态
                result = await self._stage_poll_import(product)
                if not result["success"]:
                    return result

            if auto_advance and product.listing_status == self.STATUS_CREATED:
                # 阶段4：设置价格
                result = await self._stage_set_price(product)
                if not result["success"]:
                    return result

            if auto_advance and product.listing_status == self.STATUS_PRICED:
                # 阶段5：设置库存
                result = await self._stage_set_stock(product)
                if not result["success"]:
                    return result

            await self.db.commit()

            logger.info(f"Product listing completed: offer_id={offer_id}, status={product.listing_status}")

            return {
                "success": True,
                "status": product.listing_status,
                "product_id": product.ozon_product_id,
                "sku": product.ozon_sku
            }

        except Exception as e:
            logger.error(f"Product listing failed: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def _stage_upload_media(self, product: OzonProduct) -> Dict[str, Any]:
        """
        阶段1：上传图片到OZON

        Args:
            product: 商品对象

        Returns:
            执行结果
        """
        try:
            logger.info(f"Stage 1: Uploading media for {product.offer_id}")

            # 获取图片URL列表（从product.images JSONB字段）
            images = product.images or []
            if not images:
                # 没有图片，直接标记为media_ready
                product.listing_status = self.STATUS_MEDIA_READY
                product.media_ready_at = datetime.utcnow()
                await self.db.commit()
                return {"success": True}

            # 提取图片URL
            image_urls = []
            if isinstance(images, list):
                for img in images:
                    if isinstance(img, dict):
                        url = img.get("url") or img.get("src")
                        if url:
                            image_urls.append(url)
                    elif isinstance(img, str):
                        image_urls.append(img)

            if not image_urls:
                product.listing_status = self.STATUS_MEDIA_READY
                product.media_ready_at = datetime.utcnow()
                await self.db.commit()
                return {"success": True}

            # 调用媒体导入服务
            result = await self.media_service.import_images_for_product(
                shop_id=product.shop_id,
                offer_id=product.offer_id,
                image_urls=image_urls,
                validate_properties=False
            )

            if not result["success"]:
                product.listing_status = self.STATUS_ERROR
                product.listing_error_code = "MEDIA_IMPORT_FAILED"
                product.listing_error_message = result.get("error", "Unknown error")
                await self.db.commit()
                return result

            # 轮询图片上传状态
            poll_result = await self.media_service.poll_import_status(
                shop_id=product.shop_id,
                offer_id=product.offer_id,
                max_retries=15,
                retry_interval=2.0
            )

            if not poll_result["success"] or not poll_result.get("all_completed"):
                product.listing_status = self.STATUS_ERROR
                product.listing_error_code = "MEDIA_UPLOAD_TIMEOUT"
                product.listing_error_message = "Image upload timed out or failed"
                await self.db.commit()
                return {"success": False, "error": "Image upload failed"}

            # 标记为media_ready
            product.listing_status = self.STATUS_MEDIA_READY
            product.media_ready_at = datetime.utcnow()
            await self.db.commit()

            logger.info(f"Media upload completed for {product.offer_id}")
            return {"success": True}

        except Exception as e:
            logger.error(f"Media upload stage failed: {e}", exc_info=True)
            product.listing_status = self.STATUS_ERROR
            product.listing_error_message = str(e)
            await self.db.commit()
            return {"success": False, "error": str(e)}

    async def _stage_submit_import(
        self,
        product: OzonProduct,
        mode: str
    ) -> Dict[str, Any]:
        """
        阶段2：提交商品导入请求

        Args:
            product: 商品对象
            mode: 导入模式

        Returns:
            执行结果
        """
        try:
            logger.info(f"Stage 2: Submitting import for {product.offer_id}")

            # 调用商品导入服务
            result = await self.product_service.import_product(
                shop_id=product.shop_id,
                offer_id=product.offer_id,
                mode=mode
            )

            if not result["success"]:
                product.listing_status = self.STATUS_ERROR
                product.listing_error_code = "PRODUCT_IMPORT_FAILED"
                product.listing_error_message = result.get("error", "Unknown error")
                await self.db.commit()
                return result

            # 标记为import_submitted
            product.listing_status = self.STATUS_IMPORT_SUBMITTED
            product.import_submitted_at = datetime.utcnow()
            await self.db.commit()

            logger.info(f"Import submitted for {product.offer_id}, task_id={result['task_id']}")
            return {"success": True, "task_id": result["task_id"]}

        except Exception as e:
            logger.error(f"Import submit stage failed: {e}", exc_info=True)
            product.listing_status = self.STATUS_ERROR
            product.listing_error_message = str(e)
            await self.db.commit()
            return {"success": False, "error": str(e)}

    async def _stage_poll_import(self, product: OzonProduct) -> Dict[str, Any]:
        """
        阶段3：轮询商品导入状态

        Args:
            product: 商品对象

        Returns:
            执行结果
        """
        try:
            logger.info(f"Stage 3: Polling import status for {product.offer_id}")

            # 获取最近的导入日志
            logs = await self.product_service.get_import_logs(
                shop_id=product.shop_id,
                offer_id=product.offer_id,
                limit=1
            )

            if not logs:
                product.listing_status = self.STATUS_ERROR
                product.listing_error_code = "NO_IMPORT_LOG"
                product.listing_error_message = "No import log found"
                await self.db.commit()
                return {"success": False, "error": "No import log found"}

            log = logs[0]
            if not log.task_id:
                product.listing_status = self.STATUS_ERROR
                product.listing_error_code = "NO_TASK_ID"
                product.listing_error_message = "Import log has no task_id"
                await self.db.commit()
                return {"success": False, "error": "No task_id"}

            # 轮询任务状态
            result = await self.product_service.poll_import_task(
                shop_id=product.shop_id,
                task_id=log.task_id,
                max_retries=20,
                retry_interval=3.0
            )

            if not result["success"]:
                product.listing_status = self.STATUS_ERROR
                product.listing_error_code = "IMPORT_POLL_FAILED"
                product.listing_error_message = result.get("error", "Unknown error")
                await self.db.commit()
                return result

            status = result.get("status")
            if status != "imported":
                product.listing_status = self.STATUS_ERROR
                product.listing_error_code = "IMPORT_NOT_IMPORTED"
                product.listing_error_message = f"Import status: {status}"
                await self.db.commit()
                return {"success": False, "error": f"Import failed with status: {status}"}

            # 标记为created
            product.listing_status = self.STATUS_CREATED
            product.created_at_ozon = datetime.utcnow()
            await self.db.commit()

            logger.info(f"Import completed for {product.offer_id}, product_id={product.ozon_product_id}")
            return {"success": True}

        except Exception as e:
            logger.error(f"Import poll stage failed: {e}", exc_info=True)
            product.listing_status = self.STATUS_ERROR
            product.listing_error_message = str(e)
            await self.db.commit()
            return {"success": False, "error": str(e)}

    async def _stage_set_price(self, product: OzonProduct) -> Dict[str, Any]:
        """
        阶段4：设置商品价格

        Args:
            product: 商品对象

        Returns:
            执行结果
        """
        try:
            logger.info(f"Stage 4: Setting price for {product.offer_id}")

            if not product.price:
                # 没有价格，跳过此阶段
                product.listing_status = self.STATUS_PRICED
                product.priced_at = datetime.utcnow()
                await self.db.commit()
                return {"success": True}

            # 调用价格更新API
            result = await self.update_price(
                shop_id=product.shop_id,
                offer_id=product.offer_id,
                price=product.price,
                old_price=product.old_price,
                currency_code=product.currency_code or "RUB"
            )

            if not result["success"]:
                product.listing_status = self.STATUS_ERROR
                product.listing_error_code = "PRICE_UPDATE_FAILED"
                product.listing_error_message = result.get("error", "Unknown error")
                await self.db.commit()
                return result

            # 标记为priced
            product.listing_status = self.STATUS_PRICED
            product.priced_at = datetime.utcnow()
            await self.db.commit()

            logger.info(f"Price set for {product.offer_id}")
            return {"success": True}

        except Exception as e:
            logger.error(f"Price set stage failed: {e}", exc_info=True)
            product.listing_status = self.STATUS_ERROR
            product.listing_error_message = str(e)
            await self.db.commit()
            return {"success": False, "error": str(e)}

    async def _stage_set_stock(self, product: OzonProduct) -> Dict[str, Any]:
        """
        阶段5：设置商品库存

        Args:
            product: 商品对象

        Returns:
            执行结果
        """
        try:
            logger.info(f"Stage 5: Setting stock for {product.offer_id}")

            # 使用默认仓库ID（需要从配置或店铺信息获取）
            # 这里暂时使用固定值，实际应从店铺配置读取
            warehouse_id = 1

            stock = product.stock or 0

            # 调用库存更新API
            result = await self.update_stock(
                shop_id=product.shop_id,
                offer_id=product.offer_id,
                stock=stock,
                warehouse_id=warehouse_id
            )

            if not result["success"]:
                product.listing_status = self.STATUS_ERROR
                product.listing_error_code = "STOCK_UPDATE_FAILED"
                product.listing_error_message = result.get("error", "Unknown error")
                await self.db.commit()
                return result

            # 根据库存判断最终状态
            if stock > 0:
                product.listing_status = self.STATUS_LIVE
                product.live_at = datetime.utcnow()
            else:
                product.listing_status = self.STATUS_READY_FOR_SALE

            product.stock_set_at = datetime.utcnow()
            await self.db.commit()

            logger.info(f"Stock set for {product.offer_id}, final status: {product.listing_status}")
            return {"success": True}

        except Exception as e:
            logger.error(f"Stock set stage failed: {e}", exc_info=True)
            product.listing_status = self.STATUS_ERROR
            product.listing_error_message = str(e)
            await self.db.commit()
            return {"success": False, "error": str(e)}

    async def update_price(
        self,
        shop_id: int,
        offer_id: str,
        price: Decimal,
        old_price: Optional[Decimal] = None,
        min_price: Optional[Decimal] = None,
        currency_code: str = "RUB",
        auto_action_enabled: bool = False
    ) -> Dict[str, Any]:
        """
        更新商品价格

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID
            price: 售价
            old_price: 原价（可选）
            min_price: 最低价（可选）
            currency_code: 货币代码
            auto_action_enabled: 是否启用自动定价

        Returns:
            更新结果
        """
        try:
            logger.info(f"Updating price for {offer_id}: {price} {currency_code}")

            # 构建请求payload
            price_item = {
                "offer_id": offer_id,
                "price": str(price),
                "currency_code": currency_code
            }

            if old_price:
                price_item["old_price"] = str(old_price)

            if min_price:
                price_item["min_price"] = str(min_price)

            if auto_action_enabled:
                price_item["auto_action_enabled"] = "ENABLED"

            # 调用OZON API
            response = await self.client.update_prices(prices=[price_item])

            if not response.get("result"):
                error_msg = response.get("error", {}).get("message", "Unknown error")
                logger.error(f"Price update failed: {error_msg}")

                # 记录日志
                log = OzonPriceUpdateLog(
                    shop_id=shop_id,
                    offer_id=offer_id,
                    currency_code=currency_code,
                    price=price,
                    old_price=old_price,
                    min_price=min_price,
                    auto_action_enabled=auto_action_enabled,
                    state="failed",
                    error_message=error_msg
                )
                self.db.add(log)
                await self.db.commit()

                return {"success": False, "error": error_msg}

            # 检查结果
            result = response["result"]
            errors = result.get("errors", [])

            if errors:
                error = errors[0]
                error_msg = f"{error.get('code', 'ERROR')}: {error.get('message', 'Unknown error')}"
                logger.error(f"Price update failed: {error_msg}")

                log = OzonPriceUpdateLog(
                    shop_id=shop_id,
                    offer_id=offer_id,
                    currency_code=currency_code,
                    price=price,
                    old_price=old_price,
                    min_price=min_price,
                    auto_action_enabled=auto_action_enabled,
                    state="failed",
                    error_message=error_msg
                )
                self.db.add(log)
                await self.db.commit()

                return {"success": False, "error": error_msg}

            # 记录成功日志
            log = OzonPriceUpdateLog(
                shop_id=shop_id,
                offer_id=offer_id,
                currency_code=currency_code,
                price=price,
                old_price=old_price,
                min_price=min_price,
                auto_action_enabled=auto_action_enabled,
                state="accepted"
            )
            self.db.add(log)

            # 更新产品记录
            product = await self._get_product(shop_id, offer_id)
            if product:
                product.price = price
                if old_price:
                    product.old_price = old_price
                if min_price:
                    product.min_price = min_price

            await self.db.commit()

            logger.info(f"Price updated successfully for {offer_id}")
            return {"success": True}

        except Exception as e:
            logger.error(f"Price update failed: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def update_stock(
        self,
        shop_id: int,
        offer_id: str,
        stock: int,
        warehouse_id: int,
        product_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        更新商品库存

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID
            stock: 库存数量
            warehouse_id: 仓库ID
            product_id: OZON商品ID（可选）

        Returns:
            更新结果
        """
        try:
            logger.info(f"Updating stock for {offer_id}: {stock} @ warehouse {warehouse_id}")

            # 构建请求payload
            stock_item = {
                "offer_id": offer_id,
                "stock": stock,
                "warehouse_id": warehouse_id
            }

            if product_id:
                stock_item["product_id"] = product_id

            # 调用OZON API
            response = await self.client.update_stocks(stocks=[stock_item])

            if not response.get("result"):
                error_msg = response.get("error", {}).get("message", "Unknown error")
                logger.error(f"Stock update failed: {error_msg}")

                # 记录日志
                log = OzonStockUpdateLog(
                    shop_id=shop_id,
                    offer_id=offer_id,
                    product_id=product_id,
                    warehouse_id=warehouse_id,
                    stock=stock,
                    state="failed",
                    error_message=error_msg
                )
                self.db.add(log)
                await self.db.commit()

                return {"success": False, "error": error_msg}

            # 检查结果
            result = response["result"]
            errors = result.get("errors", [])

            if errors:
                error = errors[0]
                error_msg = f"{error.get('code', 'ERROR')}: {error.get('message', 'Unknown error')}"
                logger.error(f"Stock update failed: {error_msg}")

                log = OzonStockUpdateLog(
                    shop_id=shop_id,
                    offer_id=offer_id,
                    product_id=product_id,
                    warehouse_id=warehouse_id,
                    stock=stock,
                    state="failed",
                    error_message=error_msg
                )
                self.db.add(log)
                await self.db.commit()

                return {"success": False, "error": error_msg}

            # 记录成功日志
            log = OzonStockUpdateLog(
                shop_id=shop_id,
                offer_id=offer_id,
                product_id=product_id,
                warehouse_id=warehouse_id,
                stock=stock,
                state="accepted"
            )
            self.db.add(log)

            # 更新产品记录
            product = await self._get_product(shop_id, offer_id)
            if product:
                product.stock = stock
                product.available = stock

            await self.db.commit()

            logger.info(f"Stock updated successfully for {offer_id}")
            return {"success": True}

        except Exception as e:
            logger.error(f"Stock update failed: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def get_listing_status(
        self,
        shop_id: int,
        offer_id: str
    ) -> Dict[str, Any]:
        """
        获取商品上架状态

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID

        Returns:
            状态信息
        """
        product = await self._get_product(shop_id, offer_id)
        if not product:
            return {"success": False, "error": "Product not found"}

        return {
            "success": True,
            "status": product.listing_status or self.STATUS_DRAFT,
            "mode": product.listing_mode,
            "product_id": product.ozon_product_id,
            "sku": product.ozon_sku,
            "timestamps": {
                "media_ready_at": product.media_ready_at.isoformat() if product.media_ready_at else None,
                "import_submitted_at": product.import_submitted_at.isoformat() if product.import_submitted_at else None,
                "created_at_ozon": product.created_at_ozon.isoformat() if product.created_at_ozon else None,
                "priced_at": product.priced_at.isoformat() if product.priced_at else None,
                "stock_set_at": product.stock_set_at.isoformat() if product.stock_set_at else None,
                "live_at": product.live_at.isoformat() if product.live_at else None
            },
            "error": {
                "code": product.listing_error_code,
                "message": product.listing_error_message
            } if product.listing_error_code else None
        }

    async def _get_product(self, shop_id: int, offer_id: str) -> Optional[OzonProduct]:
        """获取商品记录"""
        stmt = select(OzonProduct).where(
            and_(
                OzonProduct.shop_id == shop_id,
                OzonProduct.offer_id == offer_id
            )
        )
        return await self.db.scalar(stmt)
