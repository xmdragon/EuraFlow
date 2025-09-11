"""
商品同步服务
处理Ozon商品的拉取、更新、映射等
"""
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from decimal import Decimal

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_session
from ef_core.utils.logging import get_logger
from ef_core.utils.errors import BusinessError

from ..api.client import OzonAPIClient
from ..models.products import (
    OzonProduct, OzonProductVariant, OzonProductAttribute,
    OzonPriceHistory, OzonInventorySnapshot
)
from ..models.sync import OzonSyncCheckpoint, OzonSyncLog

logger = get_logger(__name__)


class ProductSyncService:
    """商品同步服务"""
    
    def __init__(self, shop_id: int, api_client: OzonAPIClient):
        """
        初始化商品同步服务
        
        Args:
            shop_id: 店铺ID
            api_client: Ozon API客户端
        """
        self.shop_id = shop_id
        self.api_client = api_client
        self.batch_size = 100
    
    async def sync_products(self, full_sync: bool = False) -> Dict[str, Any]:
        """
        同步商品主流程
        
        Args:
            full_sync: 是否全量同步
            
        Returns:
            同步结果统计
        """
        sync_log = await self._create_sync_log("products", "full" if full_sync else "incremental")
        
        try:
            # 获取检查点
            checkpoint = await self._get_checkpoint()
            
            # 更新检查点状态
            checkpoint.status = "running"
            checkpoint.retry_count = 0
            await self._save_checkpoint(checkpoint)
            
            # 执行同步
            stats = {
                "total_processed": 0,
                "success": 0,
                "failed": 0,
                "skipped": 0
            }
            
            last_id = None if full_sync else checkpoint.last_cursor
            has_more = True
            
            while has_more:
                # 拉取商品批次
                batch_result = await self._fetch_product_batch(last_id)
                
                if not batch_result["items"]:
                    has_more = False
                    continue
                
                # 处理批次
                batch_stats = await self._process_product_batch(batch_result["items"])
                
                # 更新统计
                stats["total_processed"] += batch_stats["processed"]
                stats["success"] += batch_stats["success"]
                stats["failed"] += batch_stats["failed"]
                stats["skipped"] += batch_stats["skipped"]
                
                # 更新检查点
                last_id = batch_result.get("last_id")
                checkpoint.last_cursor = last_id
                checkpoint.total_processed = stats["total_processed"]
                checkpoint.total_success = stats["success"]
                checkpoint.total_failed = stats["failed"]
                await self._save_checkpoint(checkpoint)
                
                # 检查是否还有更多数据
                has_more = batch_result.get("has_next", False)
                
                # 避免过快请求
                await asyncio.sleep(0.5)
            
            # 更新检查点为完成状态
            checkpoint.status = "idle"
            checkpoint.last_sync_at = datetime.utcnow()
            await self._save_checkpoint(checkpoint)
            
            # 记录同步日志
            await self._complete_sync_log(sync_log, "success", stats)
            
            logger.info(f"Product sync completed for shop {self.shop_id}", extra=stats)
            
            return stats
            
        except Exception as e:
            logger.error(f"Product sync failed for shop {self.shop_id}: {e}")
            
            # 更新检查点为失败状态
            checkpoint.status = "failed"
            checkpoint.error_message = str(e)
            checkpoint.retry_count += 1
            await self._save_checkpoint(checkpoint)
            
            # 记录失败日志
            await self._complete_sync_log(sync_log, "failed", error=str(e))
            
            raise
    
    async def _fetch_product_batch(self, last_id: Optional[str] = None) -> Dict[str, Any]:
        """
        拉取商品批次
        
        Args:
            last_id: 上一批次最后的ID
            
        Returns:
            商品批次数据
        """
        try:
            response = await self.api_client.get_products(
                limit=self.batch_size,
                last_id=last_id
            )
            
            return {
                "items": response.get("result", {}).get("items", []),
                "last_id": response.get("result", {}).get("last_id"),
                "has_next": response.get("result", {}).get("has_next", False)
            }
            
        except Exception as e:
            logger.error(f"Failed to fetch product batch: {e}")
            raise
    
    async def _process_product_batch(self, products: List[Dict]) -> Dict[str, int]:
        """
        处理商品批次
        
        Args:
            products: 商品数据列表
            
        Returns:
            处理统计
        """
        stats = {
            "processed": len(products),
            "success": 0,
            "failed": 0,
            "skipped": 0
        }
        
        async with get_session() as session:
            for product_data in products:
                try:
                    # 处理单个商品
                    await self._process_single_product(session, product_data)
                    stats["success"] += 1
                    
                except Exception as e:
                    logger.error(f"Failed to process product {product_data.get('id')}: {e}")
                    stats["failed"] += 1
            
            # 批量提交
            await session.commit()
        
        return stats
    
    async def _process_single_product(
        self, 
        session: AsyncSession, 
        product_data: Dict[str, Any]
    ) -> OzonProduct:
        """
        处理单个商品
        
        Args:
            session: 数据库会话
            product_data: Ozon商品数据
            
        Returns:
            商品实体
        """
        # 查找或创建商品
        stmt = select(OzonProduct).where(
            and_(
                OzonProduct.shop_id == self.shop_id,
                OzonProduct.ozon_product_id == product_data["id"]
            )
        )
        product = await session.scalar(stmt)
        
        if not product:
            product = OzonProduct(
                shop_id=self.shop_id,
                ozon_product_id=product_data["id"]
            )
            session.add(product)
        
        # 更新商品信息
        product.offer_id = product_data.get("offer_id", "")
        product.ozon_sku = product_data.get("fbs_sku") or product_data.get("fbo_sku")
        product.sku = product_data.get("offer_id", "")  # 默认使用offer_id作为本地SKU
        
        product.title = product_data.get("name", "")
        product.barcode = product_data.get("barcode", "")
        product.category_id = product_data.get("category_id")
        
        # 价格信息
        if "price" in product_data:
            old_price = product.price
            new_price = Decimal(str(product_data["price"]))
            
            if old_price != new_price:
                # 记录价格变更
                price_history = OzonPriceHistory(
                    product_id=product.id,
                    shop_id=self.shop_id,
                    price_before=old_price,
                    price_after=new_price,
                    change_reason="sync",
                    changed_by="system",
                    source="ozon_api"
                )
                session.add(price_history)
            
            product.price = new_price
            product.old_price = Decimal(str(product_data.get("old_price", "0")))
        
        # 库存信息
        stocks = product_data.get("stocks", {})
        if stocks:
            product.stock = stocks.get("present", 0)
            product.reserved = stocks.get("reserved", 0)
            product.available = product.stock - product.reserved
        
        # 状态
        product.status = self._map_product_status(product_data.get("status"))
        product.visibility = product_data.get("visible", True)
        product.is_archived = product_data.get("is_archived", False)
        
        # 原始数据
        product.raw_payload = product_data
        
        # 同步信息
        product.last_sync_at = datetime.utcnow()
        product.sync_status = "success"
        product.sync_error = None
        
        # 处理变体
        if "variants" in product_data and product_data["variants"]:
            await self._process_variants(session, product, product_data["variants"])
        
        # 处理属性
        if "attributes" in product_data and product_data["attributes"]:
            await self._process_attributes(session, product, product_data["attributes"])
        
        return product
    
    async def _process_variants(
        self,
        session: AsyncSession,
        product: OzonProduct,
        variants_data: List[Dict]
    ):
        """处理商品变体"""
        # 删除旧变体
        for variant in product.variants:
            await session.delete(variant)
        
        # 添加新变体
        for variant_data in variants_data:
            variant = OzonProductVariant(
                product_id=product.id,
                variant_id=str(variant_data.get("id", "")),
                variant_type=variant_data.get("type"),
                variant_value=variant_data.get("value"),
                variant_sku=variant_data.get("sku"),
                price=Decimal(str(variant_data.get("price", "0"))),
                stock=variant_data.get("stock", 0)
            )
            session.add(variant)
    
    async def _process_attributes(
        self,
        session: AsyncSession,
        product: OzonProduct,
        attributes_data: List[Dict]
    ):
        """处理商品属性"""
        # 删除旧属性
        for attr in product.attributes:
            await session.delete(attr)
        
        # 添加新属性
        for attr_data in attributes_data:
            attribute = OzonProductAttribute(
                product_id=product.id,
                attribute_id=attr_data.get("id"),
                attribute_name=attr_data.get("name"),
                attribute_type=attr_data.get("type"),
                value=attr_data.get("value"),
                is_required=attr_data.get("is_required", False)
            )
            session.add(attribute)
    
    def _map_product_status(self, ozon_status: str) -> str:
        """映射Ozon商品状态到系统状态"""
        status_map = {
            "processing": "active",
            "moderating": "active",
            "processed": "active",
            "archived": "inactive",
            "failed_moderation": "failed",
            "failed_validation": "failed"
        }
        return status_map.get(ozon_status, "draft")
    
    async def _get_checkpoint(self) -> OzonSyncCheckpoint:
        """获取或创建同步检查点"""
        async with get_session() as session:
            stmt = select(OzonSyncCheckpoint).where(
                and_(
                    OzonSyncCheckpoint.shop_id == self.shop_id,
                    OzonSyncCheckpoint.entity_type == "products"
                )
            )
            checkpoint = await session.scalar(stmt)
            
            if not checkpoint:
                checkpoint = OzonSyncCheckpoint(
                    shop_id=self.shop_id,
                    entity_type="products",
                    status="idle"
                )
                session.add(checkpoint)
                await session.commit()
            
            return checkpoint
    
    async def _save_checkpoint(self, checkpoint: OzonSyncCheckpoint):
        """保存检查点"""
        async with get_session() as session:
            session.add(checkpoint)
            await session.commit()
    
    async def _create_sync_log(self, entity_type: str, sync_type: str) -> OzonSyncLog:
        """创建同步日志"""
        async with get_session() as session:
            sync_log = OzonSyncLog(
                shop_id=self.shop_id,
                entity_type=entity_type,
                sync_type=sync_type,
                status="started",
                started_at=datetime.utcnow()
            )
            session.add(sync_log)
            await session.commit()
            return sync_log
    
    async def _complete_sync_log(
        self, 
        sync_log: OzonSyncLog,
        status: str,
        stats: Optional[Dict] = None,
        error: Optional[str] = None
    ):
        """完成同步日志"""
        async with get_session() as session:
            sync_log.status = status
            sync_log.completed_at = datetime.utcnow()
            
            if stats:
                sync_log.processed_count = stats.get("total_processed", 0)
                sync_log.success_count = stats.get("success", 0)
                sync_log.failed_count = stats.get("failed", 0)
                sync_log.skipped_count = stats.get("skipped", 0)
            
            if error:
                sync_log.error_message = error
            
            # 计算耗时
            if sync_log.started_at:
                duration = (sync_log.completed_at - sync_log.started_at).total_seconds()
                sync_log.duration_ms = int(duration * 1000)
            
            session.add(sync_log)
            await session.commit()
    
    async def update_prices(self, price_updates: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        批量更新商品价格
        
        Args:
            price_updates: 价格更新列表
                [{"sku": "xxx", "price": 100.00, "old_price": 120.00}]
                
        Returns:
            更新结果
        """
        results = {
            "success": 0,
            "failed": 0,
            "errors": []
        }
        
        async with get_session() as session:
            # 准备Ozon API请求数据
            ozon_prices = []
            
            for update in price_updates:
                try:
                    # 查找商品
                    stmt = select(OzonProduct).where(
                        and_(
                            OzonProduct.shop_id == self.shop_id,
                            OzonProduct.sku == update["sku"]
                        )
                    )
                    product = await session.scalar(stmt)
                    
                    if not product:
                        results["failed"] += 1
                        results["errors"].append({
                            "sku": update["sku"],
                            "error": "Product not found"
                        })
                        continue
                    
                    # 记录价格历史
                    price_history = OzonPriceHistory(
                        product_id=product.id,
                        shop_id=self.shop_id,
                        price_before=product.price,
                        price_after=Decimal(str(update["price"])),
                        old_price_before=product.old_price,
                        old_price_after=Decimal(str(update.get("old_price", "0"))),
                        change_reason=update.get("reason", "manual"),
                        changed_by=update.get("user_id", "system"),
                        source="manual"
                    )
                    session.add(price_history)
                    
                    # 更新本地价格
                    product.price = Decimal(str(update["price"]))
                    if "old_price" in update:
                        product.old_price = Decimal(str(update["old_price"]))
                    
                    # 准备API请求
                    ozon_prices.append({
                        "product_id": product.ozon_product_id,
                        "price": str(update["price"]),
                        "old_price": str(update.get("old_price", "0")),
                        "premium_price": str(update.get("premium_price", update["price"]))
                    })
                    
                    results["success"] += 1
                    
                except Exception as e:
                    logger.error(f"Failed to prepare price update for {update['sku']}: {e}")
                    results["failed"] += 1
                    results["errors"].append({
                        "sku": update["sku"],
                        "error": str(e)
                    })
            
            # 调用Ozon API批量更新
            if ozon_prices:
                try:
                    api_result = await self.api_client.update_prices(ozon_prices)
                    
                    # 检查API结果
                    if api_result.get("result", {}).get("errors"):
                        for error in api_result["result"]["errors"]:
                            logger.error(f"Ozon API price update error: {error}")
                    
                except Exception as e:
                    logger.error(f"Failed to update prices via Ozon API: {e}")
                    # API失败不影响本地更新
            
            # 提交数据库更改
            await session.commit()
        
        return results