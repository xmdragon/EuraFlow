"""
Ozon 订单相关数据模型
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, List

from sqlalchemy import (
    Column, String, Integer, BigInteger, Numeric,
    Boolean, DateTime, JSON, ForeignKey, Index, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class OzonOrder(Base):
    """Ozon 订单表"""
    __tablename__ = "ozon_orders"
    
    # 主键
    id = Column(BigInteger, primary_key=True)
    
    # 店铺隔离
    shop_id = Column(Integer, nullable=False, index=True)
    
    # 订单号映射
    order_id = Column(String(100), nullable=False, comment="本地订单号")
    ozon_order_id = Column(String(100), nullable=False, comment="Ozon订单号")
    ozon_order_number = Column(String(100), comment="Ozon订单编号")
    
    # 订单状态
    status = Column(String(50), nullable=False)  # pending/confirmed/processing/shipped/delivered/cancelled
    ozon_status = Column(String(50))  # 原始Ozon状态
    payment_status = Column(String(50))  # pending/paid/refunded
    
    # 订单类型
    order_type = Column(String(50), default="FBS")  # FBS/FBO/CrossDock
    is_express = Column(Boolean, default=False)
    is_premium = Column(Boolean, default=False)
    
    # 金额信息（Decimal避免精度问题）
    total_price = Column(Numeric(18, 4), nullable=False)
    products_price = Column(Numeric(18, 4))
    delivery_price = Column(Numeric(18, 4))
    commission_amount = Column(Numeric(18, 4))
    
    # 客户信息
    customer_id = Column(String(100))
    customer_phone = Column(String(50))
    customer_email = Column(String(200))
    
    # 地址信息（JSON存储）
    delivery_address = Column(JSONB)
    # 格式: {"city": "", "region": "", "postal_code": "", "address": "", "lat": 0.0, "lon": 0.0}
    
    # 配送信息
    delivery_method = Column(String(100))
    delivery_date = Column(DateTime(timezone=True))
    delivery_time_slot = Column(String(50))
    
    # 原始数据
    raw_payload = Column(JSONB, comment="Ozon原始订单数据")
    
    # 时间信息
    ordered_at = Column(DateTime(timezone=True), nullable=False)
    confirmed_at = Column(DateTime(timezone=True))
    shipped_at = Column(DateTime(timezone=True))
    delivered_at = Column(DateTime(timezone=True))
    cancelled_at = Column(DateTime(timezone=True))
    
    # 同步信息
    last_sync_at = Column(DateTime(timezone=True))
    sync_status = Column(String(50), default="pending")

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    # 关系
    postings = relationship("OzonPosting", back_populates="order", cascade="all, delete-orphan")
    items = relationship("OzonOrderItem", back_populates="order", cascade="all, delete-orphan")
    refunds = relationship("OzonRefund", back_populates="order", cascade="all, delete-orphan")
    kuajing84_sync_logs = relationship("Kuajing84SyncLog", back_populates="ozon_order", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint("shop_id", "ozon_order_id", name="uq_ozon_orders_shop_order"),
        Index("idx_ozon_orders_status", "shop_id", "status"),
        Index("idx_ozon_orders_date", "shop_id", "ordered_at"),
        Index("idx_ozon_orders_sync", "sync_status", "last_sync_at")
    )

    def to_dict(self, target_posting_number: Optional[str] = None):
        """转换为字典，包含关联的商品明细和posting信息

        Args:
            target_posting_number: 可选的目标货件号。如果提供，将使用该货件作为主记录，
                                  并且只在postings数组中包含该货件
        """
        # 调用父类方法获取基础字段
        result = super().to_dict()

        # 不再构建 items 字段（与 postings[].products 重复）
        # 所有商品数据都在 postings[].products 中

        # 确定使用哪个posting作为主记录
        # 如果指定了target_posting_number，使用匹配的posting；否则使用第一个posting
        if self.postings and len(self.postings) > 0:
            if target_posting_number:
                # 查找匹配的posting
                first_posting = next(
                    (p for p in self.postings if p.posting_number == target_posting_number),
                    None
                )
                # 如果未找到匹配，使用第一个posting（兜底策略）
                if not first_posting:
                    first_posting = self.postings[0]
            else:
                # 默认使用第一个posting
                first_posting = self.postings[0]
            result['posting_number'] = first_posting.posting_number
            result['posting_status'] = first_posting.status
            result['in_process_at'] = first_posting.in_process_at.isoformat() if first_posting.in_process_at else None
            result['warehouse_name'] = first_posting.warehouse_name
            result['shipment_date'] = first_posting.shipment_date.isoformat() if first_posting.shipment_date else None

            # 添加 posting 维度的业务字段（用于前端表单显示和编辑）
            result['material_cost'] = str(first_posting.material_cost) if first_posting.material_cost else None
            result['domestic_tracking_numbers'] = first_posting.get_domestic_tracking_numbers()  # 统一使用数组
            result['purchase_price'] = str(first_posting.purchase_price) if first_posting.purchase_price else None
            result['purchase_price_updated_at'] = first_posting.purchase_price_updated_at.isoformat() if first_posting.purchase_price_updated_at else None
            result['order_notes'] = first_posting.order_notes
            result['source_platform'] = first_posting.source_platform

            # 添加完整的postings列表
            # 如果指定了target_posting_number，只包含匹配的posting
            result['postings'] = []
            postings_to_include = self.postings
            if target_posting_number:
                postings_to_include = [p for p in self.postings if p.posting_number == target_posting_number]

            for posting in postings_to_include:
                # 构建 packages 列表
                packages = []
                if posting.packages:
                    # 如果有 packages 表数据，使用它
                    packages = [
                        {
                            'id': pkg.id,
                            'tracking_number': pkg.tracking_number,
                            'carrier_name': pkg.carrier_name,
                            'carrier_code': pkg.carrier_code,
                        }
                        for pkg in posting.packages
                    ]
                elif posting.raw_payload:
                    # 如果没有 packages 表数据，尝试从 raw_payload 中提取
                    tracking_number = posting.raw_payload.get('tracking_number')
                    if tracking_number:
                        packages = [{
                            'id': None,
                            'tracking_number': tracking_number,
                            'carrier_name': None,
                            'carrier_code': None,
                        }]

                # 从 raw_payload 中提取该 posting 的商品信息
                posting_products = []
                if posting.raw_payload and 'products' in posting.raw_payload:
                    for product in posting.raw_payload['products']:
                        posting_products.append({
                            'sku': str(product.get('sku', '')),
                            'offer_id': str(product.get('offer_id', '')) if product.get('offer_id') else None,
                            'name': product.get('name', ''),
                            'quantity': product.get('quantity', 0),
                            'price': str(product.get('price', '0')),
                        })

                result['postings'].append({
                    'id': posting.id,
                    'posting_number': posting.posting_number,
                    'status': posting.status,
                    'warehouse_name': posting.warehouse_name,
                    'delivery_method_name': posting.delivery_method_name,
                    'shipment_date': posting.shipment_date.isoformat() if posting.shipment_date else None,
                    'shipped_at': posting.shipped_at.isoformat() if posting.shipped_at else None,
                    'delivered_at': posting.delivered_at.isoformat() if posting.delivered_at else None,
                    # 添加业务字段到 posting 对象
                    'material_cost': str(posting.material_cost) if posting.material_cost else None,
                    'domestic_tracking_numbers': posting.get_domestic_tracking_numbers(),  # 统一使用数组
                    'purchase_price': str(posting.purchase_price) if posting.purchase_price else None,
                    'purchase_price_updated_at': posting.purchase_price_updated_at.isoformat() if posting.purchase_price_updated_at else None,
                    'order_notes': posting.order_notes,
                    'source_platform': posting.source_platform,
                    # 添加财务字段
                    'last_mile_delivery_fee_cny': str(posting.last_mile_delivery_fee_cny) if posting.last_mile_delivery_fee_cny else None,
                    'international_logistics_fee_cny': str(posting.international_logistics_fee_cny) if posting.international_logistics_fee_cny else None,
                    'ozon_commission_cny': str(posting.ozon_commission_cny) if posting.ozon_commission_cny else None,
                    'packages': packages,
                    # 添加该 posting 的商品列表（从 raw_payload 提取）
                    'products': posting_products
                })
        else:
            result['posting_number'] = None
            result['posting_status'] = None
            result['in_process_at'] = None
            result['warehouse_name'] = None
            result['shipment_date'] = None
            # 业务字段默认值
            result['material_cost'] = None
            result['domestic_tracking_numbers'] = []  # 统一使用数组
            result['purchase_price'] = None
            result['purchase_price_updated_at'] = None
            result['order_notes'] = None
            result['source_platform'] = None
            result['postings'] = []
            # 不设置 items（已废弃）

        return result


class OzonDomesticTracking(Base):
    """国内物流单号表（一对多关系）"""
    __tablename__ = "ozon_domestic_tracking_numbers"

    # 主键
    id = Column(BigInteger, primary_key=True)

    # 外键关联
    posting_id = Column(BigInteger, ForeignKey("ozon_postings.id", ondelete="CASCADE"), nullable=False)

    # 单号
    tracking_number = Column(String(200), nullable=False, comment="国内物流单号")

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow, comment="创建时间")

    # 关系
    posting = relationship("OzonPosting", back_populates="domestic_trackings")

    __table_args__ = (
        # 索引1：反查优化（从单号查posting）
        Index("idx_domestic_tracking_number", "tracking_number"),
        # 索引2：正查优化（从posting查所有单号）
        Index("idx_domestic_posting_id", "posting_id"),
        # 唯一约束：同一个posting不能有重复单号
        UniqueConstraint("posting_id", "tracking_number", name="uq_posting_tracking")
    )


class OzonPosting(Base):
    """Ozon 发货单（Posting维度）"""
    __tablename__ = "ozon_postings"
    
    id = Column(BigInteger, primary_key=True)
    order_id = Column(BigInteger, ForeignKey("ozon_orders.id"), nullable=False)
    shop_id = Column(Integer, nullable=False)
    
    # 发货单信息
    posting_number = Column(String(100), nullable=False, unique=True)
    ozon_posting_number = Column(String(100))
    
    # 状态
    status = Column(String(50), nullable=False)  # awaiting_packaging/awaiting_deliver/delivering/delivered
    substatus = Column(String(100))
    
    # 发货信息
    shipment_date = Column(DateTime(timezone=True))
    delivery_method_id = Column(BigInteger)  # OZON API可能返回超大ID
    delivery_method_name = Column(String(200))

    # 仓库
    warehouse_id = Column(BigInteger)  # OZON API可能返回超大ID
    warehouse_name = Column(String(200))
    
    # 包裹信息
    packages_count = Column(Integer, default=1)
    total_weight = Column(Numeric(10, 3))
    
    # 取消信息
    is_cancelled = Column(Boolean, default=False)
    cancel_reason_id = Column(Integer)
    cancel_reason = Column(String(500))
    
    # 原始数据
    raw_payload = Column(JSONB)

    # 业务字段（Posting维度）
    material_cost = Column(Numeric(18, 2), comment="物料成本（包装、标签等）")
    purchase_price = Column(Numeric(18, 2), comment="进货价格")
    purchase_price_updated_at = Column(DateTime(timezone=True), comment="进货价格更新时间")
    order_notes = Column(String(1000), comment="订单备注")
    source_platform = Column(String(50), comment="采集平台")
    operation_time = Column(DateTime(timezone=True), comment="用户操作时间（备货/打包等操作的时间戳）")
    operation_status = Column(
        String(50),
        nullable=False,
        default="awaiting_stock",
        server_default="awaiting_stock",
        comment="操作状态：awaiting_stock(等待备货)/allocating(分配中)/allocated(已分配)/tracking_confirmed(单号确认)/shipping(运输中)/cancelled(已取消)"
    )

    # 跨境巴士同步状态
    kuajing84_sync_error = Column(String(200), comment="跨境巴士同步错误信息（如'订单不存在'则跳过后续同步）")
    kuajing84_last_sync_at = Column(DateTime(timezone=True), comment="最后尝试同步跨境巴士的时间")

    # 财务费用字段（CNY）
    last_mile_delivery_fee_cny = Column(Numeric(18, 2), comment="尾程派送费(CNY)")
    international_logistics_fee_cny = Column(Numeric(18, 2), comment="国际物流费(CNY)")
    ozon_commission_cny = Column(Numeric(18, 2), comment="Ozon佣金(CNY)")
    finance_synced_at = Column(DateTime(timezone=True), comment="财务同步时间")

    # 利润字段（CNY）
    profit = Column(Numeric(18, 2), comment="利润金额(CNY)")
    profit_rate = Column(Numeric(10, 4), comment="利润比率(%)")

    # 标签PDF文件路径
    label_pdf_path = Column(String(500), comment="标签PDF文件路径（70x125mm竖向格式）")

    # 时间
    in_process_at = Column(DateTime(timezone=True))
    shipped_at = Column(DateTime(timezone=True))
    delivered_at = Column(DateTime(timezone=True))
    cancelled_at = Column(DateTime(timezone=True))
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    # 关系
    order = relationship("OzonOrder", back_populates="postings")
    packages = relationship("OzonShipmentPackage", back_populates="posting", cascade="all, delete-orphan")
    domestic_trackings = relationship(
        "OzonDomesticTracking",
        back_populates="posting",
        cascade="all, delete-orphan",
        lazy="selectin"  # 预加载优化，避免N+1查询
    )

    # Helper 方法：统一访问多层级字段，屏蔽OZON API数据结构复杂性
    def get_tracking_numbers(self) -> list[str]:
        """
        获取所有追踪号码列表

        优先级：
        1. 数据库 packages 关系（如果已加载）
        2. raw_payload 的 packages 数组
        3. raw_payload 的顶层 tracking_number 字段

        注意：优先读取数据库 packages 关系（如果已预加载），避免数据不一致
        如果 packages 未预加载，则降级使用 raw_payload

        Returns:
            追踪号码列表（去重）
        """
        tracking_numbers = []

        # 优先级1：从数据库 packages 关系获取（如果已预加载，不触发懒加载）
        try:
            if hasattr(self, '__dict__') and 'packages' in self.__dict__:
                # packages 已被预加载或之前访问过
                for pkg in self.packages:
                    if pkg.tracking_number:
                        tracking_numbers.append(pkg.tracking_number)
                if tracking_numbers:
                    return list(set(tracking_numbers))
        except Exception:
            # 如果访问 packages 失败（懒加载被禁用等），继续使用 raw_payload
            pass

        # 优先级2：从 raw_payload 获取
        if not self.raw_payload:
            return []

        # 方式1：从raw_payload的顶层tracking_number获取
        if top_tracking := self.raw_payload.get("tracking_number"):
            tracking_numbers.append(top_tracking)

        # 方式2：从raw_payload的packages数组获取
        if packages := self.raw_payload.get("packages"):
            if isinstance(packages, list):
                tracking_numbers.extend([
                    pkg.get("tracking_number")
                    for pkg in packages
                    if isinstance(pkg, dict) and pkg.get("tracking_number")
                ])

        # 去重并过滤空值
        return list(set(filter(None, tracking_numbers)))

    def has_tracking_number(self) -> bool:
        """
        判断是否有追踪号码

        Returns:
            True如果有任何追踪号码，否则False
        """
        return len(self.get_tracking_numbers()) > 0

    def get_package_count(self) -> int:
        """
        获取包裹数量（从raw_payload）

        优先级：
        1. raw_payload的packages数组长度
        2. 如果有顶层tracking_number则返回1
        3. 默认返回0

        注意：此方法只读取raw_payload，不触发packages关系的lazy loading
        如需访问数据库packages表，请使用显式查询或预加载

        Returns:
            包裹数量
        """
        if not self.raw_payload:
            return 0

        # 方式1：raw_payload的packages数组
        if packages := self.raw_payload.get("packages"):
            if isinstance(packages, list):
                return len(packages)

        # 方式2：顶层tracking_number（单包裹）
        if self.raw_payload.get("tracking_number"):
            return 1

        # 默认返回0
        return 0

    def get_domestic_tracking_numbers(self) -> List[str]:
        """
        获取所有国内物流单号列表

        从数据库 domestic_trackings 关系获取（预加载）

        Returns:
            国内物流单号列表
        """
        tracking_numbers = []

        # 从数据库 domestic_trackings 关系获取
        # 直接访问，lazy="selectin" 会自动触发预加载
        try:
            for tracking in self.domestic_trackings:
                if tracking.tracking_number:
                    tracking_numbers.append(tracking.tracking_number)
        except Exception:
            # 如果访问 domestic_trackings 失败（例如在detached状态），返回空列表
            pass

        return tracking_numbers

    __table_args__ = (
        Index("idx_ozon_postings_status", "shop_id", "status"),
        Index("idx_ozon_postings_date", "shop_id", "shipment_date"),
        Index("idx_ozon_postings_warehouse", "warehouse_id", "status")
    )


class OzonOrderItem(Base):
    """订单商品明细"""
    __tablename__ = "ozon_order_items"
    
    id = Column(BigInteger, primary_key=True)
    order_id = Column(BigInteger, ForeignKey("ozon_orders.id"), nullable=False)

    # SKU映射
    offer_id = Column(String(100), nullable=False)
    ozon_sku = Column(BigInteger)
    
    # 商品信息
    name = Column(String(500))
    
    # 数量和价格
    quantity = Column(Integer, nullable=False)
    price = Column(Numeric(18, 4), nullable=False)
    discount = Column(Numeric(18, 4), default=Decimal("0"))
    total_amount = Column(Numeric(18, 4), nullable=False)
    
    # 状态
    status = Column(String(50))  # pending/confirmed/shipped/delivered/cancelled/returned
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    # 关系
    order = relationship("OzonOrder", back_populates="items")

    __table_args__ = (
        Index("idx_ozon_order_items_offer_id", "offer_id"),
        Index("idx_ozon_order_items_order", "order_id", "status")
    )


class OzonShipmentPackage(Base):
    """发货包裹信息"""
    __tablename__ = "ozon_shipment_packages"
    
    id = Column(BigInteger, primary_key=True)
    posting_id = Column(BigInteger, ForeignKey("ozon_postings.id"), nullable=False)
    
    # 包裹信息
    package_number = Column(String(100), nullable=False)
    tracking_number = Column(String(200))
    
    # 物流商
    carrier_id = Column(Integer)
    carrier_name = Column(String(200))
    carrier_code = Column(String(50))  # CDEK/BOXBERRY/POCHTA
    
    # 包裹属性
    weight = Column(Numeric(10, 3))
    width = Column(Numeric(10, 2))
    height = Column(Numeric(10, 2))
    length = Column(Numeric(10, 2))
    
    # 标签
    label_url = Column(String(500))
    label_printed_at = Column(DateTime(timezone=True))
    
    # 状态追踪
    status = Column(String(50))
    status_updated_at = Column(DateTime(timezone=True))
    tracking_data = Column(JSONB)
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    # 关系
    posting = relationship("OzonPosting", back_populates="packages")
    
    __table_args__ = (
        UniqueConstraint("posting_id", "package_number", name="uq_ozon_packages"),
        Index("idx_ozon_packages_tracking", "tracking_number")
    )


class OzonRefund(Base):
    """退款/退货记录"""
    __tablename__ = "ozon_refunds"
    
    id = Column(BigInteger, primary_key=True)
    order_id = Column(BigInteger, ForeignKey("ozon_orders.id"), nullable=False)
    shop_id = Column(Integer, nullable=False)
    
    # 退款信息
    refund_id = Column(String(100), nullable=False, unique=True)
    refund_type = Column(String(50))  # refund/return/partial_refund
    
    # 关联
    posting_id = Column(BigInteger, ForeignKey("ozon_postings.id"))
    
    # 金额
    refund_amount = Column(Numeric(18, 4), nullable=False)
    commission_refund = Column(Numeric(18, 4))
    
    # 商品明细（JSON数组）
    refund_items = Column(JSONB)
    # 格式: [{"sku": "xxx", "quantity": 1, "amount": 100.00, "reason": "xxx"}]
    
    # 原因
    reason_id = Column(Integer)
    reason = Column(String(500))
    customer_comment = Column(String(1000))
    
    # 状态
    status = Column(String(50))  # pending/approved/processing/completed/rejected
    
    # 时间
    requested_at = Column(DateTime(timezone=True), nullable=False)
    approved_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    # 关系
    order = relationship("OzonOrder", back_populates="refunds")
    
    __table_args__ = (
        Index("idx_ozon_refunds_status", "shop_id", "status"),
        Index("idx_ozon_refunds_date", "shop_id", "requested_at")
    )