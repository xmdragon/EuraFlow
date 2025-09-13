"""
发货服务
处理发货信息的创建和管理
"""
from typing import Dict, List, Optional, Any
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.models import Order, Shipment, Package
from ef_core.utils.errors import (
    EuraFlowException, ValidationError, ConflictError, NotFoundError
)
from ef_core.utils.logger import get_logger
from ef_core.event_bus import get_event_bus
from .base import BaseService, ServiceResult, RepositoryMixin

logger = get_logger(__name__)


class ShipmentsService(BaseService, RepositoryMixin):
    """发货服务"""
    
    SUPPORTED_CARRIERS = ["CDEK", "BOXBERRY", "POCHTA"]
    
    def __init__(self):
        super().__init__()
        self.event_bus = get_event_bus()
    
    async def create_shipment(
        self,
        order_external_id: str,
        shop_id: int,
        carrier_code: str,
        tracking_no: str,
        packages_data: Optional[List[Dict[str, Any]]] = None
    ) -> ServiceResult[Dict[str, Any]]:
        """创建发货记录"""
        try:
            # 验证输入
            self._validate_shipment_data(carrier_code, tracking_no)
            
            # 在事务中执行
            result = await self.execute_with_transaction(
                self._create_shipment_tx,
                order_external_id, shop_id, carrier_code, tracking_no, packages_data or []
            )
            
            # 发布事件
            await self._publish_shipment_event(result["shipment"], "created")
            
            return ServiceResult.ok(result, metadata={
                "tracking_no": tracking_no,
                "carrier_code": carrier_code
            })
            
        except EuraFlowException:
            raise
        except Exception as e:
            self.logger.error("Shipment creation failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to create shipment: {str(e)}",
                error_code="SHIPMENT_CREATION_FAILED"
            )
    
    async def _create_shipment_tx(
        self,
        session: AsyncSession,
        order_external_id: str,
        shop_id: int,
        carrier_code: str,
        tracking_no: str,
        packages_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """事务中的发货创建逻辑"""
        
        # 查找订单
        order = await self._get_order_by_external_id(session, shop_id, order_external_id)
        if not order:
            raise NotFoundError(
                code="ORDER_NOT_FOUND",
                resource=f"Order with external_id {order_external_id}"
            )
        
        # 检查运单号是否已存在
        existing_shipment = await self._get_shipment_by_tracking(session, tracking_no)
        if existing_shipment:
            raise ConflictError(
                code="TRACKING_NO_EXISTS",
                detail=f"Tracking number already exists: {tracking_no}"
            )
        
        # 创建发货记录
        shipment_data = {
            "order_id": order.id,
            "carrier_code": carrier_code,
            "tracking_no": tracking_no,
            "pushed": False
        }
        
        shipment = await self.create(session, Shipment, shipment_data)
        self.logger.info(f"Created shipment: {shipment.id} for order: {order.id}")
        
        # 创建包裹记录
        packages = []
        if packages_data:
            packages = await self._create_packages(session, shipment, packages_data)
        
        return {
            "shipment": shipment,
            "packages": packages,
            "order": order
        }
    
    async def _get_order_by_external_id(
        self,
        session: AsyncSession,
        shop_id: int,
        external_id: str
    ) -> Optional[Order]:
        """根据外部ID查找订单"""
        stmt = select(Order).where(
            and_(
                Order.shop_id == shop_id,
                Order.external_id == external_id,
                Order.platform == "ozon"
            )
        )
        result = await session.execute(stmt)
        return result.scalar_one_or_none()
    
    async def _get_shipment_by_tracking(
        self,
        session: AsyncSession,
        tracking_no: str
    ) -> Optional[Shipment]:
        """根据运单号查找发货记录"""
        stmt = select(Shipment).where(Shipment.tracking_no == tracking_no)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()
    
    def _validate_shipment_data(self, carrier_code: str, tracking_no: str) -> None:
        """验证发货数据"""
        if not carrier_code:
            raise ValidationError(
                code="MISSING_CARRIER_CODE",
                detail="Carrier code is required"
            )
        
        if carrier_code not in self.SUPPORTED_CARRIERS:
            raise ValidationError(
                code="INVALID_CARRIER_CODE",
                detail=f"Unsupported carrier: {carrier_code}. Supported: {self.SUPPORTED_CARRIERS}"
            )
        
        if not tracking_no or len(tracking_no.strip()) == 0:
            raise ValidationError(
                code="MISSING_TRACKING_NO",
                detail="Tracking number is required"
            )
        
        # 运单号格式验证（根据承运商）
        tracking_no = tracking_no.strip()
        if len(tracking_no) < 5 or len(tracking_no) > 50:
            raise ValidationError(
                code="INVALID_TRACKING_NO_LENGTH",
                detail="Tracking number must be between 5 and 50 characters"
            )
    
    async def _create_packages(
        self,
        session: AsyncSession,
        shipment: Shipment,
        packages_data: List[Dict[str, Any]]
    ) -> List[Package]:
        """创建包裹记录"""
        packages = []
        
        for i, package_data in enumerate(packages_data):
            try:
                # 验证包裹数据
                self._validate_package_data(package_data)
                
                package_data["shipment_id"] = shipment.id
                package = await self.create(session, Package, package_data)
                packages.append(package)
                
            except Exception as e:
                self.logger.error(f"Failed to create package {i}", exc_info=True)
                raise ValidationError(
                    code="PACKAGE_CREATION_FAILED",
                    detail=f"Failed to create package {i}: {str(e)}"
                )
        
        self.logger.info(f"Created {len(packages)} packages for shipment {shipment.id}")
        return packages
    
    def _validate_package_data(self, package_data: Dict[str, Any]) -> None:
        """验证包裹数据"""
        # 验证重量
        if "weight_kg" in package_data:
            try:
                weight = Decimal(str(package_data["weight_kg"]))
                if weight < 0:
                    raise ValueError("Weight cannot be negative")
                package_data["weight_kg"] = weight
            except (ValueError, TypeError):
                raise ValidationError(
                    code="INVALID_WEIGHT",
                    detail=f"Invalid weight: {package_data['weight_kg']}"
                )
        
        # 验证尺寸
        dimension_fields = ["dim_l_cm", "dim_w_cm", "dim_h_cm"]
        for field in dimension_fields:
            if field in package_data:
                try:
                    dimension = Decimal(str(package_data[field]))
                    if dimension <= 0:
                        raise ValueError(f"{field} must be positive")
                    package_data[field] = dimension
                except (ValueError, TypeError):
                    raise ValidationError(
                        code="INVALID_DIMENSION",
                        detail=f"Invalid {field}: {package_data[field]}"
                    )
    
    async def mark_as_pushed(
        self,
        tracking_no: str,
        push_receipt: Optional[Dict[str, Any]] = None
    ) -> ServiceResult[Dict[str, Any]]:
        """标记发货记录为已推送"""
        try:
            result = await self.execute_with_transaction(
                self._mark_as_pushed_tx,
                tracking_no, push_receipt
            )
            
            # 发布事件
            await self._publish_shipment_event(result["shipment"], "pushed")
            
            return ServiceResult.ok(result)
            
        except EuraFlowException:
            raise
        except Exception as e:
            self.logger.error("Mark shipment as pushed failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to mark shipment as pushed: {str(e)}",
                error_code="MARK_PUSHED_FAILED"
            )
    
    async def _mark_as_pushed_tx(
        self,
        session: AsyncSession,
        tracking_no: str,
        push_receipt: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """事务中的标记推送逻辑"""
        
        # 查找发货记录
        shipment = await self._get_shipment_by_tracking(session, tracking_no)
        if not shipment:
            raise NotFoundError(
                code="SHIPMENT_NOT_FOUND",
                resource=f"Shipment with tracking_no {tracking_no}"
            )
        
        # 更新状态
        update_data = {
            "pushed": True,
            "pushed_at": datetime.utcnow(),
            "push_receipt": push_receipt
        }
        
        updated_shipment = await self.update(session, shipment, update_data)
        self.logger.info(f"Marked shipment {shipment.id} as pushed")
        
        return {
            "shipment": updated_shipment
        }
    
    async def get_pending_shipments(
        self,
        shop_id: Optional[int] = None,
        limit: int = 100
    ) -> ServiceResult[List[Dict[str, Any]]]:
        """获取待推送的发货记录"""
        try:
            result = await self.execute_with_session(
                self._get_pending_shipments_query,
                shop_id, limit
            )
            
            return ServiceResult.ok(result)
            
        except Exception as e:
            self.logger.error("Get pending shipments failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to get pending shipments: {str(e)}",
                error_code="GET_PENDING_SHIPMENTS_FAILED"
            )
    
    async def _get_pending_shipments_query(
        self,
        session: AsyncSession,
        shop_id: Optional[int],
        limit: int
    ) -> List[Dict[str, Any]]:
        """查询待推送发货记录"""
        
        # 构建查询 - 联接 Order 表获取 shop_id
        stmt = select(Shipment, Order).join(
            Order, Shipment.order_id == Order.id
        ).where(Shipment.pushed == False)
        
        if shop_id:
            stmt = stmt.where(Order.shop_id == shop_id)
        
        # 按创建时间排序，最早的优先
        stmt = stmt.order_by(Shipment.created_at).limit(limit)
        
        result = await session.execute(stmt)
        rows = result.all()
        
        shipments_data = []
        for shipment, order in rows:
            shipment_dict = shipment.to_dict()
            shipment_dict["order"] = {
                "external_id": order.external_id,
                "external_no": order.external_no,
                "shop_id": order.shop_id
            }
            
            # 加载包裹信息
            packages_stmt = select(Package).where(Package.shipment_id == shipment.id)
            packages_result = await session.execute(packages_stmt)
            packages = list(packages_result.scalars().all())
            shipment_dict["packages"] = [pkg.to_dict() for pkg in packages]
            
            shipments_data.append(shipment_dict)
        
        return shipments_data
    
    async def _publish_shipment_event(self, shipment: Shipment, action: str) -> None:
        """发布发货事件"""
        try:
            event_topic = f"ef.ozon.shipment.{action}"
            event_payload = {
                "shipment_id": shipment.id,
                "tracking_no": shipment.tracking_no,
                "carrier_code": shipment.carrier_code,
                "pushed": shipment.pushed,
                "order_id": shipment.order_id
            }
            
            await self.event_bus.publish(event_topic, event_payload)
            self.logger.debug(f"Published shipment event: {event_topic}")
            
        except Exception as e:
            # 事件发布失败不应该影响主流程
            self.logger.error(f"Failed to publish shipment event", exc_info=True)