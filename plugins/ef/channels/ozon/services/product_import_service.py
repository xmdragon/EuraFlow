"""
OZON商品导入服务
负责商品导入请求的构建、提交、状态轮询与日志记录
"""
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime
from decimal import Decimal
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.utils.logger import get_logger
from ..api.client import OzonAPIClient
from ..models.products import OzonProduct, OzonProductAttribute
from ..models.listing import OzonProductImportLog, OzonMediaImportLog

logger = get_logger(__name__)


class ProductImportService:
    """OZON商品导入服务"""

    # 导入模式
    MODE_NEW_CARD = "NEW_CARD"
    MODE_FOLLOW_PDP = "FOLLOW_PDP"

    # 状态映射
    STATE_SUBMITTED = "submitted"
    STATE_PROCESSING = "processing"
    STATE_CREATED = "created"
    STATE_PRICE_SENT = "price_sent"
    STATE_FAILED = "failed"

    def __init__(self, ozon_client: OzonAPIClient, db: AsyncSession):
        """
        初始化商品导入服务

        Args:
            ozon_client: OZON API客户端
            db: 数据库会话
        """
        self.client = ozon_client
        self.db = db

    async def import_product(
        self,
        shop_id: int,
        offer_id: str,
        mode: str = MODE_NEW_CARD,
        custom_payload: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        导入商品到OZON

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID
            mode: 导入模式（NEW_CARD/FOLLOW_PDP）
            custom_payload: 自定义payload（可选，如果不提供则从数据库构建）

        Returns:
            导入结果
        """
        try:
            logger.info(f"Starting product import: offer_id={offer_id}, mode={mode}")

            # 1. 获取或构建payload
            if custom_payload:
                payload = custom_payload
            else:
                # 从数据库获取商品信息
                product = await self._get_product(shop_id, offer_id)
                if not product:
                    return {
                        "success": False,
                        "error": f"Product not found: {offer_id}"
                    }

                # 构建导入payload
                payload = await self._build_import_payload(product, mode)

            # 2. 创建导入日志
            log = OzonProductImportLog(
                shop_id=shop_id,
                offer_id=offer_id,
                import_mode=mode,
                request_payload=payload,
                state=self.STATE_SUBMITTED
            )
            self.db.add(log)
            await self.db.flush()

            # 3. 调用OZON API
            try:
                response = await self.client.import_products(
                    products=[payload]
                )

                if not response.get("result"):
                    error_msg = response.get("error", {}).get("message", "Unknown error")
                    logger.error(f"OZON API import_products failed: {error_msg}")

                    log.state = self.STATE_FAILED
                    log.error_message = error_msg
                    log.response_payload = response

                    await self.db.commit()

                    return {
                        "success": False,
                        "error": error_msg,
                        "log_id": log.id
                    }

                # 4. 保存响应结果
                result = response["result"]
                log.task_id = result.get("task_id")
                log.response_payload = result
                log.state = self.STATE_PROCESSING

                await self.db.commit()

                logger.info(f"Product import submitted: offer_id={offer_id}, task_id={log.task_id}")

                return {
                    "success": True,
                    "task_id": log.task_id,
                    "log_id": log.id
                }

            except Exception as e:
                logger.error(f"Failed to call OZON import API: {e}", exc_info=True)

                log.state = self.STATE_FAILED
                log.error_message = str(e)
                await self.db.commit()

                raise

        except Exception as e:
            logger.error(f"Product import failed: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def _get_product(self, shop_id: int, offer_id: str) -> Optional[OzonProduct]:
        """获取商品记录"""
        stmt = select(OzonProduct).where(
            and_(
                OzonProduct.shop_id == shop_id,
                OzonProduct.offer_id == offer_id
            )
        )
        return await self.db.scalar(stmt)

    async def _build_import_payload(
        self,
        product: OzonProduct,
        mode: str
    ) -> Dict[str, Any]:
        """
        构建商品导入payload

        Args:
            product: 商品对象
            mode: 导入模式

        Returns:
            导入payload
        """
        # 基础字段
        payload = {
            "offer_id": product.offer_id,
            "name": product.title,
            "price": str(product.price) if product.price else "0",
            "vat": "0.0"  # 默认增值税率
        }

        # 原价（可选）
        if product.old_price:
            payload["old_price"] = str(product.old_price)

        # 模式特定字段
        if mode == self.MODE_NEW_CARD:
            # NEW_CARD模式：需要类目ID
            if not product.category_id:
                raise ValueError(f"category_id is required for NEW_CARD mode: {product.offer_id}")
            payload["category_id"] = product.category_id

            # 描述
            if product.description:
                payload["description"] = product.description

        elif mode == self.MODE_FOLLOW_PDP:
            # FOLLOW_PDP模式：需要条形码
            if not product.barcode:
                raise ValueError(f"barcode is required for FOLLOW_PDP mode: {product.offer_id}")
            payload["barcode"] = product.barcode

        # 图片
        images = await self._get_product_images(product.shop_id, product.offer_id)
        if images:
            payload["images"] = images

        # 尺寸重量
        if product.height and product.width and product.depth:
            payload["height"] = int(product.height * 10)  # cm转mm
            payload["width"] = int(product.width * 10)
            payload["depth"] = int(product.depth * 10)

        if product.weight:
            payload["weight"] = int(product.weight * 1000)  # kg转g
            payload["weight_unit"] = "g"

        # 属性
        attributes = await self._get_product_attributes(product.id)
        if attributes:
            payload["attributes"] = attributes

        # 货币代码
        if product.currency_code:
            payload["currency_code"] = product.currency_code

        return payload

    async def _get_product_images(
        self,
        shop_id: int,
        offer_id: str
    ) -> List[Dict[str, Any]]:
        """
        获取商品图片列表（从media import logs）

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID

        Returns:
            图片列表
        """
        stmt = select(OzonMediaImportLog).where(
            and_(
                OzonMediaImportLog.shop_id == shop_id,
                OzonMediaImportLog.offer_id == offer_id,
                OzonMediaImportLog.state == "uploaded"
            )
        ).order_by(OzonMediaImportLog.position)

        logs = list(await self.db.scalars(stmt))

        images = []
        for log in logs:
            if log.ozon_url:
                images.append({
                    "file_name": log.file_name or "",
                    "url": log.ozon_url
                })

        return images

    async def _get_product_attributes(
        self,
        product_id: int
    ) -> List[Dict[str, Any]]:
        """
        获取商品属性列表

        Args:
            product_id: 商品ID

        Returns:
            属性列表
        """
        stmt = select(OzonProductAttribute).where(
            OzonProductAttribute.product_id == product_id
        )
        attrs = list(await self.db.scalars(stmt))

        attributes = []
        for attr in attrs:
            # 构建属性对象
            attr_obj = {
                "id": attr.attribute_id
            }

            # 处理属性值
            value = attr.value
            if isinstance(value, list):
                attr_obj["values"] = value
            elif isinstance(value, dict):
                # 复杂属性（如dictionary_value_id）
                if "dictionary_value_id" in value:
                    attr_obj["dictionary_value_id"] = value["dictionary_value_id"]
                elif "complex_id" in value:
                    attr_obj["complex_id"] = value["complex_id"]
                    attr_obj["values"] = value.get("values", [])
                else:
                    attr_obj["values"] = [value]
            else:
                attr_obj["values"] = [{"value": str(value)}]

            attributes.append(attr_obj)

        return attributes

    async def poll_import_task(
        self,
        shop_id: int,
        task_id: str,
        max_retries: int = 20,
        retry_interval: float = 3.0
    ) -> Dict[str, Any]:
        """
        轮询商品导入任务状态

        Args:
            shop_id: 店铺ID
            task_id: 任务ID
            max_retries: 最大重试次数
            retry_interval: 重试间隔（秒）

        Returns:
            任务状态结果
        """
        try:
            # 获取导入日志
            stmt = select(OzonProductImportLog).where(
                and_(
                    OzonProductImportLog.shop_id == shop_id,
                    OzonProductImportLog.task_id == task_id
                )
            )
            log = await self.db.scalar(stmt)

            if not log:
                return {
                    "success": False,
                    "error": f"Import log not found for task_id={task_id}"
                }

            retry_count = 0

            while retry_count < max_retries:
                # 调用OZON API查询任务状态
                response = await self.client.get_import_product_info(task_id)

                if not response.get("result"):
                    error_msg = response.get("error", {}).get("message", "Unknown error")
                    logger.error(f"Failed to query import task: {error_msg}")
                    return {"success": False, "error": error_msg}

                result = response["result"]
                items = result.get("items", [])

                if not items:
                    logger.warning(f"No items in import task result: task_id={task_id}")
                    retry_count += 1
                    await asyncio.sleep(retry_interval)
                    continue

                # 查找对应的商品
                item = next(
                    (i for i in items if i.get("offer_id") == log.offer_id),
                    None
                )

                if not item:
                    logger.warning(f"offer_id {log.offer_id} not found in task result")
                    retry_count += 1
                    await asyncio.sleep(retry_interval)
                    continue

                # 更新日志状态
                status = item.get("status", "").lower()

                log.response_payload = item

                if status == "imported":
                    # 导入成功
                    log.state = self.STATE_CREATED
                    log.ozon_product_id = item.get("product_id")
                    log.ozon_sku = item.get("sku")

                    # 更新产品记录
                    await self._update_product_after_import(
                        log.shop_id,
                        log.offer_id,
                        log.ozon_product_id,
                        log.ozon_sku
                    )

                    await self.db.commit()

                    logger.info(f"Product import completed: offer_id={log.offer_id}, product_id={log.ozon_product_id}")

                    return {
                        "success": True,
                        "status": "imported",
                        "product_id": log.ozon_product_id,
                        "sku": log.ozon_sku,
                        "retry_count": retry_count
                    }

                elif status == "failed":
                    # 导入失败
                    errors = item.get("errors", [])
                    log.state = self.STATE_FAILED
                    log.errors = errors

                    if errors:
                        log.error_code = errors[0].get("code", "")
                        log.error_message = errors[0].get("message", "")

                    await self.db.commit()

                    logger.error(f"Product import failed: offer_id={log.offer_id}, errors={errors}")

                    return {
                        "success": False,
                        "status": "failed",
                        "errors": errors,
                        "retry_count": retry_count
                    }

                elif status in ["processing", "pending"]:
                    # 仍在处理中
                    log.state = self.STATE_PROCESSING
                    await self.db.commit()

                    retry_count += 1
                    if retry_count < max_retries:
                        await asyncio.sleep(retry_interval)
                    continue

                else:
                    # 未知状态
                    logger.warning(f"Unknown import status: {status}")
                    retry_count += 1
                    await asyncio.sleep(retry_interval)

            # 超过最大重试次数
            logger.warning(f"Import task polling timed out: task_id={task_id}")
            return {
                "success": True,
                "status": "timeout",
                "retry_count": retry_count
            }

        except Exception as e:
            logger.error(f"Failed to poll import task: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def _update_product_after_import(
        self,
        shop_id: int,
        offer_id: str,
        ozon_product_id: Optional[int],
        ozon_sku: Optional[int]
    ):
        """
        导入成功后更新产品记录

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID
            ozon_product_id: OZON商品ID
            ozon_sku: OZON SKU
        """
        product = await self._get_product(shop_id, offer_id)
        if not product:
            logger.warning(f"Product not found for update: {offer_id}")
            return

        if ozon_product_id:
            product.ozon_product_id = ozon_product_id

        if ozon_sku:
            product.ozon_sku = ozon_sku

        product.status = "active"
        product.ozon_created_at = datetime.utcnow()

    async def get_import_logs(
        self,
        shop_id: int,
        offer_id: Optional[str] = None,
        state: Optional[str] = None,
        limit: int = 100
    ) -> List[OzonProductImportLog]:
        """
        获取商品导入日志

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID（可选）
            state: 状态过滤（可选）
            limit: 返回数量限制

        Returns:
            日志列表
        """
        stmt = select(OzonProductImportLog).where(
            OzonProductImportLog.shop_id == shop_id
        )

        if offer_id:
            stmt = stmt.where(OzonProductImportLog.offer_id == offer_id)

        if state:
            stmt = stmt.where(OzonProductImportLog.state == state)

        stmt = stmt.order_by(OzonProductImportLog.created_at.desc()).limit(limit)

        result = await self.db.scalars(stmt)
        return list(result)

    async def retry_failed_import(
        self,
        shop_id: int,
        offer_id: str,
        mode: Optional[str] = None,
        max_retry_count: int = 3
    ) -> Dict[str, Any]:
        """
        重试失败的商品导入

        Args:
            shop_id: 店铺ID
            offer_id: 商品Offer ID
            mode: 导入模式（可选，如果不提供则使用上次的模式）
            max_retry_count: 最大重试次数

        Returns:
            重试结果
        """
        try:
            # 获取最近一次失败的日志
            stmt = select(OzonProductImportLog).where(
                and_(
                    OzonProductImportLog.shop_id == shop_id,
                    OzonProductImportLog.offer_id == offer_id,
                    OzonProductImportLog.state == self.STATE_FAILED,
                    OzonProductImportLog.retry_count < max_retry_count
                )
            ).order_by(OzonProductImportLog.created_at.desc()).limit(1)

            log = await self.db.scalar(stmt)

            if not log:
                return {
                    "success": False,
                    "error": "No failed import to retry or max retry count reached"
                }

            # 使用原有的payload或模式
            import_mode = mode or log.import_mode
            payload = log.request_payload

            # 更新重试信息
            log.retry_count += 1
            log.last_retry_at = datetime.utcnow()
            await self.db.commit()

            # 重新提交导入
            result = await self.import_product(
                shop_id=shop_id,
                offer_id=offer_id,
                mode=import_mode,
                custom_payload=payload
            )

            return {
                **result,
                "retry_count": log.retry_count
            }

        except Exception as e:
            logger.error(f"Failed to retry import: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def batch_import_products(
        self,
        shop_id: int,
        products: List[Dict[str, Any]],
        mode: str = MODE_NEW_CARD
    ) -> Dict[str, Any]:
        """
        批量导入商品（最多100个）

        Args:
            shop_id: 店铺ID
            products: 商品payload列表
            mode: 导入模式

        Returns:
            导入结果
        """
        try:
            if len(products) > 100:
                return {
                    "success": False,
                    "error": "Maximum 100 products per batch"
                }

            logger.info(f"Starting batch import: {len(products)} products")

            # 创建导入日志
            logs = []
            for product_payload in products:
                offer_id = product_payload.get("offer_id")
                if not offer_id:
                    logger.warning("Product payload missing offer_id, skipping")
                    continue

                log = OzonProductImportLog(
                    shop_id=shop_id,
                    offer_id=offer_id,
                    import_mode=mode,
                    request_payload=product_payload,
                    state=self.STATE_SUBMITTED
                )
                self.db.add(log)
                logs.append(log)

            await self.db.flush()

            # 调用OZON API
            response = await self.client.import_products(products=products)

            if not response.get("result"):
                error_msg = response.get("error", {}).get("message", "Unknown error")
                logger.error(f"Batch import failed: {error_msg}")

                for log in logs:
                    log.state = self.STATE_FAILED
                    log.error_message = error_msg

                await self.db.commit()

                return {
                    "success": False,
                    "error": error_msg
                }

            # 更新日志
            result = response["result"]
            task_id = result.get("task_id")

            for log in logs:
                log.task_id = task_id
                log.state = self.STATE_PROCESSING
                log.response_payload = result

            await self.db.commit()

            logger.info(f"Batch import submitted: task_id={task_id}, {len(logs)} products")

            return {
                "success": True,
                "task_id": task_id,
                "submitted_count": len(logs),
                "log_ids": [log.id for log in logs]
            }

        except Exception as e:
            logger.error(f"Batch import failed: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}
