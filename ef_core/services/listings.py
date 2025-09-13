"""
商品价格管理服务
处理价格更新和毛利守护逻辑
"""
from typing import Dict, List, Optional, Any
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

from ef_core.models import Listing
from ef_core.utils.errors import (
    EuraFlowException, ValidationError
)
from ef_core.utils.logger import get_logger
from ef_core.event_bus import get_event_bus
from ef_core.config import get_settings
from .base import BaseService, ServiceResult, RepositoryMixin

logger = get_logger(__name__)


class ListingsService(BaseService, RepositoryMixin):
    """商品价格服务"""
    
    def __init__(self):
        super().__init__()
        self.event_bus = get_event_bus()
        self.settings = get_settings()
        self.min_margin = self.settings.price_min_margin  # 默认 0.2 (20%)
    
    async def update_prices(
        self,
        shop_id: int,
        items: List[Dict[str, Any]],
        skip_margin_check: bool = False
    ) -> ServiceResult[Dict[str, Any]]:
        """批量更新价格"""
        try:
            # 验证输入
            validated_items = self._validate_price_items(items)
            
            # 毛利守护检查
            if not skip_margin_check:
                margin_check = await self._check_margin_guard(shop_id, validated_items)
                if margin_check["violations"]:
                    from ef_core.utils.errors import ValidationError
                    raise ValidationError(
                        code="OZON_GUARD_PRICE_VIOLATION",
                        detail=f"Price violations: {len(margin_check['violations'])} items below minimum margin"
                    )
            
            # 在事务中执行
            result = await self.execute_with_transaction(
                self._update_prices_tx,
                shop_id, validated_items
            )
            
            # 发布事件
            await self._publish_price_events(shop_id, result["updated_items"])
            
            return ServiceResult.ok(result, metadata={
                "margin_check_skipped": skip_margin_check
            })
            
        except EuraFlowException:
            raise
        except Exception as e:
            self.logger.error("Price update failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to update prices: {str(e)}",
                error_code="PRICE_UPDATE_FAILED"
            )
    
    def _validate_price_items(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """验证价格项数据"""
        if not items:
            raise ValidationError(
                code="EMPTY_PRICE_ITEMS",
                detail="Price items list cannot be empty"
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
                
                if "price_rub" not in item:
                    raise ValidationError(
                        code="MISSING_PRICE",
                        detail=f"Price is required for item {i}"
                    )
                
                # 验证价格
                try:
                    price_rub = Decimal(str(item["price_rub"]))
                    if price_rub < 0:
                        raise ValidationError(
                            code="INVALID_PRICE",
                            detail=f"Price cannot be negative for item {i}: {price_rub}"
                        )
                except (ValueError, TypeError):
                    raise ValidationError(
                        code="INVALID_PRICE_TYPE",
                        detail=f"Invalid price type for item {i}: {item['price_rub']}"
                    )
                
                validated_item = {
                    "sku": item["sku"].strip(),
                    "price_rub": price_rub
                }
                
                # 验证划线价（如果提供）
                if "price_old_rub" in item and item["price_old_rub"] is not None:
                    try:
                        price_old_rub = Decimal(str(item["price_old_rub"]))
                        if price_old_rub < price_rub:
                            raise ValidationError(
                                code="INVALID_OLD_PRICE",
                                detail=f"Old price must be >= current price for item {i}: {price_old_rub} < {price_rub}"
                            )
                        validated_item["price_old_rub"] = price_old_rub
                    except (ValueError, TypeError):
                        raise ValidationError(
                            code="INVALID_OLD_PRICE_TYPE",
                            detail=f"Invalid old price type for item {i}: {item['price_old_rub']}"
                        )
                
                # 成本价（如果提供，用于毛利计算）
                if "cost_rub" in item and item["cost_rub"] is not None:
                    try:
                        cost_rub = Decimal(str(item["cost_rub"]))
                        if cost_rub < 0:
                            raise ValueError("Cost cannot be negative")
                        validated_item["cost_rub"] = cost_rub
                    except (ValueError, TypeError):
                        self.logger.warning(f"Invalid cost for item {i}, margin check will be skipped")
                
                validated_items.append(validated_item)
                
            except Exception as e:
                self.logger.error(f"Validation failed for price item {i}", exc_info=True)
                raise
        
        return validated_items
    
    async def _check_margin_guard(
        self,
        shop_id: int,
        items: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """毛利守护检查"""
        violations = []
        
        for item in items:
            sku = item["sku"]
            price_rub = item["price_rub"]
            cost_rub = item.get("cost_rub")
            
            if cost_rub is not None:
                # 计算毛利率：(售价 - 成本) / 售价
                if price_rub > 0:
                    margin = (price_rub - cost_rub) / price_rub
                    
                    if margin < self.min_margin:
                        violations.append({
                            "sku": sku,
                            "price_rub": str(price_rub),
                            "cost_rub": str(cost_rub),
                            "actual_margin": float(margin),
                            "required_margin": self.min_margin,
                            "reason": f"Margin {margin:.1%} < required {self.min_margin:.1%}"
                        })
                        
                        self.logger.warning(
                            f"Margin violation detected",
                            shop_id=shop_id,
                            sku=sku,
                            price=str(price_rub),
                            cost=str(cost_rub),
                            margin=float(margin),
                            required_margin=self.min_margin
                        )
        
        return {
            "violations": violations,
            "min_margin": self.min_margin
        }
    
    async def _update_prices_tx(
        self,
        session: AsyncSession,
        shop_id: int,
        items: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """事务中的价格更新逻辑"""
        
        updated_items = []
        
        for item in items:
            # 准备数据
            listing_data = {
                "shop_id": shop_id,
                "sku": item["sku"],
                "price_rub": item["price_rub"],
                "updated_at": datetime.utcnow()
            }
            
            # 添加划线价（如果有）
            if "price_old_rub" in item:
                listing_data["price_old_rub"] = item["price_old_rub"]
            
            # 使用 PostgreSQL 的 UPSERT
            stmt = insert(Listing).values(**listing_data)
            
            # 如果记录已存在，更新价格信息
            update_dict = {
                "price_rub": stmt.excluded.price_rub,
                "updated_at": stmt.excluded.updated_at
            }
            
            if "price_old_rub" in item:
                update_dict["price_old_rub"] = stmt.excluded.price_old_rub
            
            stmt = stmt.on_conflict_do_update(
                index_elements=["shop_id", "sku"],
                set_=update_dict
            ).returning(Listing)
            
            result = await session.execute(stmt)
            listing = result.scalar_one()
            
            updated_items.append(listing)
        
        self.logger.info(f"Updated prices for {len(updated_items)} items", shop_id=shop_id)
        
        return {
            "updated_items": updated_items
        }
    
    async def get_listings(
        self,
        shop_id: int,
        sku: Optional[str] = None
    ) -> ServiceResult[List[Dict[str, Any]]]:
        """查询商品价格"""
        try:
            result = await self.execute_with_session(
                self._get_listings_query,
                shop_id, sku
            )
            
            return ServiceResult.ok(result)
            
        except Exception as e:
            self.logger.error("Get listings failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to get listings: {str(e)}",
                error_code="GET_LISTINGS_FAILED"
            )
    
    async def _get_listings_query(
        self,
        session: AsyncSession,
        shop_id: int,
        sku: Optional[str]
    ) -> List[Dict[str, Any]]:
        """商品价格查询逻辑"""
        
        stmt = select(Listing).where(Listing.shop_id == shop_id)
        
        if sku:
            stmt = stmt.where(Listing.sku == sku)
        
        stmt = stmt.order_by(Listing.sku)
        
        result = await session.execute(stmt)
        listings = list(result.scalars().all())
        
        return [listing.to_dict() for listing in listings]
    
    async def calculate_price_with_margin(
        self,
        cost_rub: Decimal,
        target_margin: Optional[float] = None
    ) -> ServiceResult[Dict[str, Any]]:
        """根据成本和目标毛利率计算售价"""
        try:
            margin = target_margin or self.min_margin
            
            if margin >= 1.0:
                raise ValidationError(
                    code="INVALID_MARGIN",
                    detail="Margin must be less than 1.0 (100%)"
                )
            
            if margin < 0:
                raise ValidationError(
                    code="INVALID_MARGIN",
                    detail="Margin cannot be negative"
                )
            
            # 公式：售价 = 成本 / (1 - 毛利率)
            price_rub = cost_rub / (1 - Decimal(str(margin)))
            
            result = {
                "cost_rub": str(cost_rub),
                "target_margin": margin,
                "calculated_price_rub": str(price_rub.quantize(Decimal("0.01"))),
                "actual_margin": float((price_rub - cost_rub) / price_rub)
            }
            
            return ServiceResult.ok(result)
            
        except Exception as e:
            self.logger.error("Price calculation failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to calculate price: {str(e)}",
                error_code="PRICE_CALCULATION_FAILED"
            )
    
    async def bulk_price_check(
        self,
        shop_id: int,
        items: List[Dict[str, Any]]
    ) -> ServiceResult[Dict[str, Any]]:
        """批量价格检查（不更新数据库）"""
        try:
            # 验证输入
            validated_items = self._validate_price_items(items)
            
            # 毛利守护检查
            margin_check = await self._check_margin_guard(shop_id, validated_items)
            
            # 价格合规性检查
            compliance_results = []
            
            for item in validated_items:
                check_result = {
                    "sku": item["sku"],
                    "price_rub": str(item["price_rub"]),
                    "compliant": True,
                    "issues": []
                }
                
                # 检查是否有毛利率问题
                violation = next(
                    (v for v in margin_check["violations"] if v["sku"] == item["sku"]),
                    None
                )
                
                if violation:
                    check_result["compliant"] = False
                    check_result["issues"].append({
                        "type": "margin_violation",
                        "message": violation["reason"],
                        "actual_margin": violation["actual_margin"],
                        "required_margin": violation["required_margin"]
                    })
                
                # 检查划线价格逻辑
                if "price_old_rub" in item:
                    if item["price_old_rub"] < item["price_rub"]:
                        check_result["compliant"] = False
                        check_result["issues"].append({
                            "type": "invalid_old_price",
                            "message": f"Old price {item['price_old_rub']} must be >= current price {item['price_rub']}"
                        })
                
                compliance_results.append(check_result)
            
            overall_compliant = all(r["compliant"] for r in compliance_results)
            
            result = {
                "overall_compliant": overall_compliant,
                "items": compliance_results,
                "margin_violations": len(margin_check["violations"]),
                "min_margin": margin_check["min_margin"]
            }
            
            return ServiceResult.ok(result)
            
        except EuraFlowException:
            raise
        except Exception as e:
            self.logger.error("Bulk price check failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to check prices: {str(e)}",
                error_code="PRICE_CHECK_FAILED"
            )
    
    async def _publish_price_events(
        self,
        shop_id: int,
        updated_items: List[Listing]
    ) -> None:
        """发布价格事件"""
        try:
            # 发布价格更新事件
            event_payload = {
                "shop_id": shop_id,
                "updated_count": len(updated_items),
                "skus": [item.sku for item in updated_items],
                "price_range": {
                    "min_price": str(min(item.price_rub for item in updated_items)),
                    "max_price": str(max(item.price_rub for item in updated_items))
                }
            }
            
            await self.event_bus.publish("ef.ozon.price.updated", event_payload)
            self.logger.debug(f"Published price events for shop {shop_id}")
            
        except Exception as e:
            # 事件发布失败不应该影响主流程
            self.logger.error(f"Failed to publish price events", exc_info=True)