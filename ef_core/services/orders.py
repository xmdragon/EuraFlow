"""
订单服务
处理订单的创建、更新和查询，确保幂等性
"""
from typing import Dict, List, Optional, Any
from datetime import datetime
from decimal import Decimal
import hashlib
import re

from sqlalchemy import select, and_, or_, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.models import Order, OrderItem
from ef_core.utils.errors import (
    EuraFlowException, ValidationError, ConflictError, NotFoundError
)
from ef_core.utils.logger import get_logger
from ef_core.event_bus import get_event_bus
from .base import BaseService, ServiceResult, RepositoryMixin

logger = get_logger(__name__)


class OrdersService(BaseService, RepositoryMixin):
    """订单服务"""
    
    def __init__(self):
        super().__init__()
        self.event_bus = get_event_bus()
    
    async def create_or_update_order(
        self,
        order_data: Dict[str, Any],
        items_data: List[Dict[str, Any]]
    ) -> ServiceResult[Dict[str, Any]]:
        """创建或更新订单（幂等操作）"""
        try:
            # 验证必填字段
            self._validate_order_data(order_data)
            
            # 生成幂等键
            idempotency_key = self._generate_idempotency_key(order_data)
            order_data["idempotency_key"] = idempotency_key
            
            # 在事务中执行
            result = await self.execute_with_transaction(
                self._create_or_update_order_tx,
                order_data,
                items_data
            )
            
            # 发布事件
            await self._publish_order_event(result["order"], "created" if result["created"] else "updated")
            
            return ServiceResult.ok(result, metadata={
                "operation": "created" if result["created"] else "updated",
                "idempotency_key": idempotency_key
            })
            
        except EuraFlowException:
            raise
        except Exception as e:
            self.logger.error("Order create/update failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to create/update order: {str(e)}",
                error_code="ORDER_OPERATION_FAILED"
            )
    
    async def _create_or_update_order_tx(
        self,
        session: AsyncSession,
        order_data: Dict[str, Any],
        items_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """事务中的订单创建/更新逻辑"""
        
        # 检查是否已存在（按业务唯一键）
        existing_order = await self._get_order_by_external_id(
            session,
            order_data["platform"],
            order_data["shop_id"],
            order_data["external_id"]
        )
        
        created = False
        
        if existing_order:
            # 更新现有订单
            self.logger.info(f"Updating existing order: {existing_order.id}")
            
            # 检查是否有实际变化
            if self._should_update_order(existing_order, order_data):
                updated_order = await self._update_order(session, existing_order, order_data)
                await self._update_order_items(session, updated_order, items_data)
                order = updated_order
            else:
                self.logger.debug(f"No changes detected for order: {existing_order.id}")
                order = existing_order
        else:
            # 创建新订单
            self.logger.info(f"Creating new order for external_id: {order_data['external_id']}")
            order = await self._create_order(session, order_data)
            await self._create_order_items(session, order, items_data)
            created = True
        
        return {
            "order": order,
            "created": created
        }
    
    async def _get_order_by_external_id(
        self,
        session: AsyncSession,
        platform: str,
        shop_id: int,
        external_id: str
    ) -> Optional[Order]:
        """根据外部ID查找订单"""
        stmt = select(Order).where(
            and_(
                Order.platform == platform,
                Order.shop_id == shop_id,
                Order.external_id == external_id
            )
        )
        result = await session.execute(stmt)
        return result.scalar_one_or_none()
    
    def _generate_idempotency_key(self, order_data: Dict[str, Any]) -> str:
        """生成幂等键"""
        key_parts = [
            order_data["platform"],
            str(order_data["shop_id"]),
            order_data["external_id"],
            order_data.get("platform_updated_ts", "").replace("+00:00", "Z")
        ]
        key_string = "|".join(key_parts)
        return hashlib.md5(key_string.encode()).hexdigest()
    
    def _validate_order_data(self, order_data: Dict[str, Any]) -> None:
        """验证订单数据"""
        required_fields = [
            "platform", "shop_id", "external_id", "external_no",
            "status", "external_status", "payment_method",
            "buyer_name", "address_country", "address_city", 
            "address_street", "address_postcode",
            "platform_created_ts", "platform_updated_ts", "fx_rate"
        ]
        
        self.validate_required_fields(order_data, required_fields)
        
        # 验证平台字段存在
        if not order_data.get("platform"):
            raise ValidationError(
                code="MISSING_PLATFORM",
                detail="Platform field is required"
            )
        
        # 验证支付方式
        if order_data["payment_method"] not in ["online", "cod"]:
            raise ValidationError(
                code="INVALID_PAYMENT_METHOD", 
                detail=f"Payment method must be 'online' or 'cod', got: {order_data['payment_method']}"
            )
        
        # 验证邮编格式（俄罗斯6位）
        postcode = order_data.get("address_postcode", "")
        if not re.match(r"^\d{6}$", postcode):
            raise ValidationError(
                code="INVALID_POSTCODE",
                detail=f"Postcode must be 6 digits, got: {postcode}"
            )
        
        # 验证电话格式（如果提供）
        phone_e164 = order_data.get("buyer_phone_e164")
        if phone_e164 and not re.match(r"^\+[1-9]\d{6,14}$", phone_e164):
            raise ValidationError(
                code="INVALID_PHONE_E164",
                detail=f"Invalid E.164 phone format: {phone_e164}"
            )
        
        # 验证汇率
        try:
            fx_rate = Decimal(str(order_data["fx_rate"]))
            if fx_rate <= 0:
                raise ValueError("FX rate must be positive")
            order_data["fx_rate"] = fx_rate
        except (ValueError, TypeError):
            raise ValidationError(
                code="INVALID_FX_RATE",
                detail=f"Invalid FX rate: {order_data['fx_rate']}"
            )
    
    def _should_update_order(self, existing_order: Order, new_data: Dict[str, Any]) -> bool:
        """检查是否需要更新订单"""
        # 比较关键字段
        fields_to_compare = [
            "status", "external_status", "buyer_phone_e164",
            "buyer_email", "platform_updated_ts"
        ]
        
        for field in fields_to_compare:
            existing_value = getattr(existing_order, field, None)
            new_value = new_data.get(field)
            
            if existing_value != new_value:
                return True
        
        return False
    
    async def _create_order(
        self,
        session: AsyncSession,
        order_data: Dict[str, Any]
    ) -> Order:
        """创建订单"""
        # 设置默认值
        order_data.setdefault("currency", "RUB")
        order_data.setdefault("address_country", "RU")
        order_data.setdefault("is_cod", order_data["payment_method"] == "cod")
        
        order = await self.create(session, Order, order_data)
        self.logger.info(f"Created order: {order.id}")
        return order
    
    async def _update_order(
        self,
        session: AsyncSession,
        order: Order,
        order_data: Dict[str, Any]
    ) -> Order:
        """更新订单"""
        # 更新允许的字段
        updatable_fields = [
            "status", "external_status", "buyer_phone_e164", 
            "buyer_email", "platform_updated_ts", "updated_at"
        ]
        
        update_data = {k: v for k, v in order_data.items() if k in updatable_fields}
        update_data["updated_at"] = datetime.utcnow()
        
        updated_order = await self.update(session, order, update_data)
        self.logger.info(f"Updated order: {order.id}")
        return updated_order
    
    async def _create_order_items(
        self,
        session: AsyncSession,
        order: Order,
        items_data: List[Dict[str, Any]]
    ) -> List[OrderItem]:
        """创建订单项"""
        items = []
        
        for item_data in items_data:
            # 验证订单项数据
            self._validate_order_item_data(item_data)
            
            item_data["order_id"] = order.id
            item = await self.create(session, OrderItem, item_data)
            items.append(item)
        
        self.logger.info(f"Created {len(items)} order items for order {order.id}")
        return items
    
    async def _update_order_items(
        self,
        session: AsyncSession,
        order: Order,
        items_data: List[Dict[str, Any]]
    ) -> List[OrderItem]:
        """更新订单项（简化版本：先删除再创建）"""
        # 删除现有项
        from sqlalchemy import delete
        await session.execute(
            delete(OrderItem).where(OrderItem.order_id == order.id)
        )
        
        # 创建新项
        return await self._create_order_items(session, order, items_data)
    
    def _validate_order_item_data(self, item_data: Dict[str, Any]) -> None:
        """验证订单项数据"""
        required_fields = ["sku", "qty", "price_rub"]
        self.validate_required_fields(item_data, required_fields)
        
        # 验证数量
        if not isinstance(item_data["qty"], int) or item_data["qty"] <= 0:
            raise ValidationError(
                code="INVALID_QUANTITY",
                detail=f"Quantity must be positive integer, got: {item_data['qty']}"
            )
        
        # 验证价格
        try:
            price = Decimal(str(item_data["price_rub"]))
            if price < 0:
                raise ValueError("Price cannot be negative")
            item_data["price_rub"] = price
        except (ValueError, TypeError):
            raise ValidationError(
                code="INVALID_PRICE",
                detail=f"Invalid price: {item_data['price_rub']}"
            )
    
    async def _publish_order_event(self, order: Order, action: str) -> None:
        """发布订单事件"""
        try:
            event_topic = f"ef.order.{action}"
            event_payload = {
                "shop_id": order.shop_id,
                "order_id": order.id,
                "external_id": order.external_id,
                "external_no": order.external_no,
                "status": order.status,
                "external_status": order.external_status,
                "is_cod": order.is_cod,
                "platform_updated_ts": order.platform_updated_ts.isoformat() + "Z"
            }
            
            await self.event_bus.publish(event_topic, event_payload)
            self.logger.debug(f"Published order event: {event_topic}")
            
        except Exception as e:
            # 事件发布失败不应该影响主流程
            self.logger.error(f"Failed to publish order event", exc_info=True)
    
    async def get_orders(
        self,
        shop_id: int,
        platform: Optional[str] = None,
        status: Optional[List[str]] = None,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        search_query: Optional[str] = None,
        page_size: int = 50,
        offset: int = 0
    ) -> ServiceResult[Dict[str, Any]]:
        """查询订单列表"""
        try:
            result = await self.execute_with_session(
                self._get_orders_query,
                shop_id, platform, status, from_date, to_date,
                search_query, page_size, offset
            )
            
            return ServiceResult.ok(result)
            
        except Exception as e:
            self.logger.error("Get orders failed", exc_info=True)
            return ServiceResult.error(
                error=f"Failed to get orders: {str(e)}",
                error_code="GET_ORDERS_FAILED"
            )
    
    async def _get_orders_query(
        self,
        session: AsyncSession,
        shop_id: int,
        platform: str,
        status: Optional[List[str]],
        from_date: Optional[datetime],
        to_date: Optional[datetime],
        search_query: Optional[str],
        page_size: int,
        offset: int
    ) -> Dict[str, Any]:
        """订单查询逻辑"""
        # 构建查询
        stmt = select(Order).where(
            and_(
                Order.shop_id == shop_id,
                Order.platform == platform
            )
        )
        
        # 添加过滤条件
        if status:
            stmt = stmt.where(Order.status.in_(status))
        
        if from_date:
            stmt = stmt.where(Order.platform_updated_ts >= from_date)
        
        if to_date:
            stmt = stmt.where(Order.platform_updated_ts <= to_date)
        
        if search_query:
            search_pattern = f"%{search_query}%"
            stmt = stmt.where(
                or_(
                    Order.external_no.ilike(search_pattern),
                    Order.buyer_phone_raw.ilike(search_pattern),
                    Order.buyer_email.ilike(search_pattern)
                )
            )
        
        # 排序和分页
        stmt = stmt.order_by(desc(Order.platform_updated_ts))
        
        # 获取总数（用于分页信息）
        from sqlalchemy import func
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_result = await session.execute(count_stmt)
        total = total_result.scalar()
        
        # 应用分页
        stmt = stmt.offset(offset).limit(page_size)
        
        # 执行查询
        result = await session.execute(stmt)
        orders = list(result.scalars().all())
        
        # 转换为字典格式
        orders_data = []
        for order in orders:
            order_dict = order.to_dict()
            # 加载订单项
            items_stmt = select(OrderItem).where(OrderItem.order_id == order.id)
            items_result = await session.execute(items_stmt)
            items = list(items_result.scalars().all())
            order_dict["items"] = [item.to_dict() for item in items]
            orders_data.append(order_dict)
        
        return {
            "items": orders_data,
            "total": total,
            "page_size": page_size,
            "offset": offset,
            "has_more": offset + page_size < total
        }