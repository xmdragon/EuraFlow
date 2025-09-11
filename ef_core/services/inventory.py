"""
库存管理服务
处理库存的更新和守护逻辑
"""
from typing import Dict, List, Optional, Any
from datetime import datetime

from sqlalchemy import select, and_, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

from ef_core.models import Inventory
from ef_core.utils.errors import (
    EuraFlowException, ValidationError
)
from ef_core.utils.logging import get_logger
from ef_core.event_bus import get_event_bus
from .base import BaseService, ServiceResult, RepositoryMixin

logger = get_logger(__name__)


class InventoryService(BaseService, RepositoryMixin):
    """库存服务"""
    
    def __init__(self):
        super().__init__()
        self.event_bus = get_event_bus()
    
    async def update_inventory(
        self,
        shop_id: int,
        items: List[Dict[str, Any]]
    ) -> ServiceResult[Dict[str, Any]]:
        """批量更新库存"""
        try:
            # 验证输入
            validated_items = self._validate_inventory_items(items)
            
            # 在事务中执行
            result = await self.execute_with_transaction(
                self._update_inventory_tx,
                shop_id, validated_items
            )
            
            # 发布事件
            await self._publish_inventory_events(shop_id, result["updated_items"])
            
            return ServiceResult.ok(result)
            
        except EuraFlowException:
            raise
        except Exception as e:
            self.logger.error("Inventory update failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to update inventory: {str(e)}",
                error_code="INVENTORY_UPDATE_FAILED"
            )
    
    def _validate_inventory_items(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """验证库存项数据"""
        if not items:
            raise ValidationError(
                code="EMPTY_INVENTORY_ITEMS",
                detail="Inventory items list cannot be empty"
            )
        
        validated_items = []
        for i, item in enumerate(items):
            try:
                # 验证必填字段
                if "sku" not in item or not item["sku"]:
                    raise ValidationError(
                        code="MISSING_SKU",
                        detail=f"SKU is required for item {i}"
                    )
                
                if "qty" not in item:
                    raise ValidationError(
                        code="MISSING_QUANTITY",
                        detail=f"Quantity is required for item {i}"
                    )
                
                # 验证数量
                try:
                    qty = int(item["qty"])
                    if qty < 0:
                        raise ValidationError(
                            code="INVALID_QUANTITY",
                            detail=f"Quantity cannot be negative for item {i}: {qty}"
                        )
                except (ValueError, TypeError):
                    raise ValidationError(
                        code="INVALID_QUANTITY_TYPE",
                        detail=f"Invalid quantity type for item {i}: {item['qty']}"
                    )
                
                validated_item = {
                    "sku": item["sku"].strip(),
                    "qty_available": qty,
                    "threshold": item.get("threshold", 0)
                }
                
                # 验证阈值
                try:
                    threshold = int(validated_item["threshold"])
                    if threshold < 0:
                        raise ValidationError(
                            code="INVALID_THRESHOLD",
                            detail=f"Threshold cannot be negative for item {i}: {threshold}"
                        )
                    validated_item["threshold"] = threshold
                except (ValueError, TypeError):
                    raise ValidationError(
                        code="INVALID_THRESHOLD_TYPE",
                        detail=f"Invalid threshold type for item {i}: {validated_item['threshold']}"
                    )
                
                validated_items.append(validated_item)
                
            except Exception as e:
                self.logger.error(f"Validation failed for inventory item {i}", exc_info=True)
                raise
        
        return validated_items
    
    async def _update_inventory_tx(
        self,
        session: AsyncSession,
        shop_id: int,
        items: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """事务中的库存更新逻辑"""
        
        updated_items = []
        threshold_alerts = []
        
        for item in items:
            # 使用 PostgreSQL 的 UPSERT (INSERT ... ON CONFLICT)
            stmt = insert(Inventory).values(
                shop_id=shop_id,
                sku=item["sku"],
                qty_available=item["qty_available"],
                threshold=item["threshold"],
                updated_at=datetime.utcnow()
            )
            
            # 如果记录已存在，更新数量和阈值
            stmt = stmt.on_conflict_do_update(
                index_elements=["shop_id", "sku"],
                set_={
                    "qty_available": stmt.excluded.qty_available,
                    "threshold": stmt.excluded.threshold,
                    "updated_at": stmt.excluded.updated_at
                }
            ).returning(Inventory)
            
            result = await session.execute(stmt)
            inventory = result.scalar_one()
            
            updated_items.append(inventory)
            
            # 检查库存阈值
            if inventory.qty_available <= inventory.threshold:
                threshold_alerts.append({
                    "shop_id": shop_id,
                    "sku": inventory.sku,
                    "qty_available": inventory.qty_available,
                    "threshold": inventory.threshold
                })
                
                self.logger.warning(
                    f"Inventory below threshold",
                    shop_id=shop_id,
                    sku=inventory.sku,
                    qty_available=inventory.qty_available,
                    threshold=inventory.threshold
                )
        
        self.logger.info(f"Updated inventory for {len(updated_items)} items",
                        shop_id=shop_id,
                        threshold_alerts=len(threshold_alerts))
        
        return {
            "updated_items": updated_items,
            "threshold_alerts": threshold_alerts
        }
    
    async def get_inventory(
        self,
        shop_id: int,
        sku: Optional[str] = None,
        below_threshold: bool = False
    ) -> ServiceResult[List[Dict[str, Any]]]:
        """查询库存"""
        try:
            result = await self.execute_with_session(
                self._get_inventory_query,
                shop_id, sku, below_threshold
            )
            
            return ServiceResult.ok(result)
            
        except Exception as e:
            self.logger.error("Get inventory failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to get inventory: {str(e)}",
                error_code="GET_INVENTORY_FAILED"
            )
    
    async def _get_inventory_query(
        self,
        session: AsyncSession,
        shop_id: int,
        sku: Optional[str],
        below_threshold: bool
    ) -> List[Dict[str, Any]]:
        """库存查询逻辑"""
        
        stmt = select(Inventory).where(Inventory.shop_id == shop_id)
        
        if sku:
            stmt = stmt.where(Inventory.sku == sku)
        
        if below_threshold:
            stmt = stmt.where(Inventory.qty_available <= Inventory.threshold)
        
        stmt = stmt.order_by(Inventory.sku)
        
        result = await session.execute(stmt)
        inventories = list(result.scalars().all())
        
        return [inv.to_dict() for inv in inventories]
    
    async def check_stock_availability(
        self,
        shop_id: int,
        items: List[Dict[str, Any]]
    ) -> ServiceResult[Dict[str, Any]]:
        """检查库存可用性"""
        try:
            result = await self.execute_with_session(
                self._check_stock_availability_query,
                shop_id, items
            )
            
            return ServiceResult.ok(result)
            
        except Exception as e:
            self.logger.error("Stock availability check failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to check stock availability: {str(e)}",
                error_code="STOCK_CHECK_FAILED"
            )
    
    async def _check_stock_availability_query(
        self,
        session: AsyncSession,
        shop_id: int,
        items: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """库存可用性检查逻辑"""
        
        check_results = []
        overall_available = True
        
        for item in items:
            sku = item.get("sku")
            required_qty = item.get("qty", 0)
            
            if not sku:
                continue
            
            # 查询当前库存
            stmt = select(Inventory).where(
                and_(
                    Inventory.shop_id == shop_id,
                    Inventory.sku == sku
                )
            )
            
            result = await session.execute(stmt)
            inventory = result.scalar_one_or_none()
            
            if not inventory:
                check_result = {
                    "sku": sku,
                    "required_qty": required_qty,
                    "available_qty": 0,
                    "available": False,
                    "reason": "SKU not found in inventory"
                }
                overall_available = False
            else:
                available = inventory.qty_available >= required_qty
                check_result = {
                    "sku": sku,
                    "required_qty": required_qty,
                    "available_qty": inventory.qty_available,
                    "available": available,
                    "threshold": inventory.threshold
                }
                
                if not available:
                    check_result["reason"] = f"Insufficient stock (need {required_qty}, have {inventory.qty_available})"
                    overall_available = False
            
            check_results.append(check_result)
        
        return {
            "overall_available": overall_available,
            "items": check_results
        }
    
    async def reserve_stock(
        self,
        shop_id: int,
        items: List[Dict[str, Any]]
    ) -> ServiceResult[Dict[str, Any]]:
        """预留库存（减少可用数量）"""
        try:
            # 先检查可用性
            availability_result = await self.check_stock_availability(shop_id, items)
            if not availability_result.success:
                return availability_result
            
            if not availability_result.data["overall_available"]:
                return ServiceResult.error(
                    error="Insufficient stock for reservation",
                    error_code="INSUFFICIENT_STOCK"
                )
            
            # 在事务中执行预留
            result = await self.execute_with_transaction(
                self._reserve_stock_tx,
                shop_id, items
            )
            
            return ServiceResult.ok(result)
            
        except EuraFlowException:
            raise
        except Exception as e:
            self.logger.error("Stock reservation failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to reserve stock: {str(e)}",
                error_code="STOCK_RESERVATION_FAILED"
            )
    
    async def _reserve_stock_tx(
        self,
        session: AsyncSession,
        shop_id: int,
        items: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """事务中的库存预留逻辑"""
        
        reserved_items = []
        
        for item in items:
            sku = item["sku"]
            qty_to_reserve = item["qty"]
            
            # 更新库存数量
            stmt = sql_update(Inventory).where(
                and_(
                    Inventory.shop_id == shop_id,
                    Inventory.sku == sku
                )
            ).values(
                qty_available=Inventory.qty_available - qty_to_reserve,
                updated_at=datetime.utcnow()
            ).returning(Inventory)
            
            result = await session.execute(stmt)
            inventory = result.scalar_one()
            
            reserved_items.append({
                "sku": sku,
                "reserved_qty": qty_to_reserve,
                "remaining_qty": inventory.qty_available
            })
        
        self.logger.info(f"Reserved stock for {len(reserved_items)} items", shop_id=shop_id)
        
        return {
            "reserved_items": reserved_items
        }
    
    async def _publish_inventory_events(
        self,
        shop_id: int,
        updated_items: List[Inventory]
    ) -> None:
        """发布库存事件"""
        try:
            # 发布更新事件
            event_payload = {
                "shop_id": shop_id,
                "updated_count": len(updated_items),
                "skus": [item.sku for item in updated_items]
            }
            
            await self.event_bus.publish("ef.ozon.inventory.updated", event_payload)
            
            # 发布阈值告警事件
            threshold_items = [
                item for item in updated_items 
                if item.qty_available <= item.threshold
            ]
            
            if threshold_items:
                alert_payload = {
                    "shop_id": shop_id,
                    "alert_count": len(threshold_items),
                    "items": [
                        {
                            "sku": item.sku,
                            "qty_available": item.qty_available,
                            "threshold": item.threshold
                        }
                        for item in threshold_items
                    ]
                }
                
                await self.event_bus.publish("ef.ozon.inventory.threshold_alert", alert_payload)
            
            self.logger.debug(f"Published inventory events for shop {shop_id}")
            
        except Exception as e:
            # 事件发布失败不应该影响主流程
            self.logger.error(f"Failed to publish inventory events", exc_info=True)