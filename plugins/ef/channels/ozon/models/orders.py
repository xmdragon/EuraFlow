"""
Ozon 订单相关数据模型
"""
from datetime import datetime, timezone
from typing import Optional, List

from sqlalchemy import (
    Column, String, Integer, BigInteger, Numeric,
    Boolean, DateTime, JSON, ForeignKey, Index, UniqueConstraint, text
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB, ARRAY

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


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
    source_platform = Column(JSONB, comment="采购平台列表")
    operation_time = Column(DateTime(timezone=True), comment="用户操作时间（备货/打包等操作的时间戳）")
    operation_status = Column(
        String(50),
        nullable=False,
        default="awaiting_stock",
        server_default="awaiting_stock",
        comment="操作状态：awaiting_stock(等待备货)/allocating(分配中)/allocated(已分配)/tracking_confirmed(单号确认)/shipping(运输中)/cancelled(已取消)"
    )

    # 财务费用字段（CNY）
    last_mile_delivery_fee_cny = Column(Numeric(18, 2), comment="尾程派送费(CNY)")
    international_logistics_fee_cny = Column(Numeric(18, 2), comment="国际物流费(CNY)")
    ozon_commission_cny = Column(Numeric(18, 2), comment="Ozon佣金(CNY)")
    finance_synced_at = Column(DateTime(timezone=True), comment="财务同步时间")

    # 订单进度时间字段
    tracking_synced_at = Column(DateTime(timezone=True), comment="国际追踪号首次同步时间")
    domestic_tracking_updated_at = Column(DateTime(timezone=True), comment="国内单号最后更新时间")

    # 利润字段（CNY）
    profit = Column(Numeric(18, 2), comment="利润金额(CNY)")
    profit_rate = Column(Numeric(10, 4), comment="利润比率(%)")

    # 反范式化字段（优化统计查询性能）
    order_total_price = Column(Numeric(18, 2), comment="订单总金额（从raw_payload.products计算，避免运行时JSONB解析）")
    has_tracking_number = Column(Boolean, nullable=False, default=False, server_default='false', comment="是否有追踪号（避免JSONB查询）")
    has_domestic_tracking = Column(Boolean, nullable=False, default=False, server_default='false', comment="是否有国内单号（避免EXISTS子查询）")
    has_purchase_info = Column(Boolean, nullable=False, default=False, server_default='false', comment="是否所有商品都有采购信息（避免jsonb_array_elements子查询）")
    product_skus = Column(ARRAY(String), comment="商品SKU数组（反范式化，优化SKU搜索性能，使用GIN索引）")

    # 标签PDF文件路径
    label_pdf_path = Column(String(500), comment="标签PDF文件路径（70x125mm竖向格式）")

    # 打印追踪字段
    label_printed_at = Column(DateTime(timezone=True), comment="标签首次打印时间")
    label_print_count = Column(Integer, nullable=False, default=0, server_default='0', comment="标签打印次数")

    # 包装重量
    package_weight = Column(Integer, comment="包装重量（克），用于跨境物流申报")

    # 时间
    in_process_at = Column(DateTime(timezone=True))
    shipped_at = Column(DateTime(timezone=True))
    delivered_at = Column(DateTime(timezone=True))
    cancelled_at = Column(DateTime(timezone=True))
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    # 关系
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

    def check_has_tracking(self) -> bool:
        """
        判断是否有追踪号码（从 raw_payload 动态检查）

        注意：优先使用 has_tracking_number 字段（反范式化），避免 JSONB 解析

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

    def to_packing_dict(self) -> dict:
        """
        转换为打包页面所需的字典格式

        完全不依赖 order 关系，所有数据从 posting 自身获取。
        用于打包列表、搜索等场景，降低内存占用。

        Returns:
            打包页面所需的数据字典
        """
        # 基础信息
        result = {
            'id': self.id,
            'shop_id': self.shop_id,
            'posting_number': self.posting_number,
            'status': self.status,
            'operation_status': self.operation_status,
            'warehouse_name': self.warehouse_name,
            'delivery_method': self.delivery_method_name,
            'shipment_date': self.shipment_date.isoformat() if self.shipment_date else None,
            'in_process_at': self.in_process_at.isoformat() if self.in_process_at else None,
            'ordered_at': self.in_process_at.isoformat() if self.in_process_at else None,  # 使用 in_process_at 作为下单时间
            'shipped_at': self.shipped_at.isoformat() if self.shipped_at else None,
            'delivered_at': self.delivered_at.isoformat() if self.delivered_at else None,

            # 金额
            'total_price': str(self.order_total_price) if self.order_total_price else '0',
            'total_amount': str(self.order_total_price) if self.order_total_price else '0',
            'currency_code': 'CNY',

            # 业务字段
            'material_cost': str(self.material_cost) if self.material_cost else None,
            'purchase_price': str(self.purchase_price) if self.purchase_price else None,
            'purchase_price_updated_at': self.purchase_price_updated_at.isoformat() if self.purchase_price_updated_at else None,
            'order_notes': self.order_notes,
            'source_platform': self.source_platform,

            # 财务字段
            'last_mile_delivery_fee_cny': str(self.last_mile_delivery_fee_cny) if self.last_mile_delivery_fee_cny else None,
            'international_logistics_fee_cny': str(self.international_logistics_fee_cny) if self.international_logistics_fee_cny else None,
            'ozon_commission_cny': str(self.ozon_commission_cny) if self.ozon_commission_cny else None,

            # 利润
            'profit': str(self.profit) if self.profit else None,
            'profit_rate': str(self.profit_rate) if self.profit_rate else None,

            # 打印状态
            'label_printed_at': self.label_printed_at.isoformat() if self.label_printed_at else None,
            'label_print_count': self.label_print_count or 0,

            # 包装重量
            'package_weight': self.package_weight,

            # 国内单号
            'domestic_tracking_numbers': self.get_domestic_tracking_numbers(),
        }

        # 追踪号 - 从 packages 关系或 raw_payload 获取
        tracking_number = None
        if hasattr(self, '__dict__') and 'packages' in self.__dict__ and self.packages:
            tracking_number = self.packages[0].tracking_number
        elif self.raw_payload and 'tracking_number' in self.raw_payload:
            tracking_number = self.raw_payload['tracking_number']
        result['tracking_number'] = tracking_number

        # 构建 packages 列表
        packages = []
        if hasattr(self, '__dict__') and 'packages' in self.__dict__ and self.packages:
            packages = [
                {
                    'id': pkg.id,
                    'tracking_number': pkg.tracking_number,
                    'carrier_name': pkg.carrier_name,
                    'carrier_code': pkg.carrier_code,
                }
                for pkg in self.packages
            ]
        elif self.raw_payload and self.raw_payload.get('tracking_number'):
            packages = [{
                'id': None,
                'tracking_number': self.raw_payload['tracking_number'],
                'carrier_name': None,
                'carrier_code': None,
            }]
        result['packages'] = packages

        # 商品列表 - 从 raw_payload 获取
        items = []
        if self.raw_payload and 'products' in self.raw_payload:
            for product in self.raw_payload['products']:
                items.append({
                    'sku': str(product.get('sku', '')),
                    'offer_id': str(product.get('offer_id', '')) if product.get('offer_id') else None,
                    'name': product.get('name', ''),
                    'quantity': product.get('quantity', 0),
                    'price': str(product.get('price', '0')),
                })
        result['items'] = items
        result['products'] = items  # 兼容前端的 posting.products

        # 嵌套的 postings 数组（兼容现有前端结构）
        result['postings'] = [{
            'id': self.id,
            'posting_number': self.posting_number,
            'status': self.status,
            'operation_status': self.operation_status,
            'warehouse_name': self.warehouse_name,
            'delivery_method_name': self.delivery_method_name,
            'shipment_date': self.shipment_date.isoformat() if self.shipment_date else None,
            'shipped_at': self.shipped_at.isoformat() if self.shipped_at else None,
            'delivered_at': self.delivered_at.isoformat() if self.delivered_at else None,
            'material_cost': str(self.material_cost) if self.material_cost else None,
            'domestic_tracking_numbers': self.get_domestic_tracking_numbers(),
            'purchase_price': str(self.purchase_price) if self.purchase_price else None,
            'purchase_price_updated_at': self.purchase_price_updated_at.isoformat() if self.purchase_price_updated_at else None,
            'order_notes': self.order_notes,
            'source_platform': self.source_platform,
            'last_mile_delivery_fee_cny': str(self.last_mile_delivery_fee_cny) if self.last_mile_delivery_fee_cny else None,
            'international_logistics_fee_cny': str(self.international_logistics_fee_cny) if self.international_logistics_fee_cny else None,
            'ozon_commission_cny': str(self.ozon_commission_cny) if self.ozon_commission_cny else None,
            'profit': str(self.profit) if self.profit else None,
            'profit_rate': str(self.profit_rate) if self.profit_rate else None,
            'package_weight': self.package_weight,
            'packages': packages,
            'products': items,
        }]

        return result

    __table_args__ = (
        Index("idx_ozon_postings_status", "shop_id", "status"),
        Index("idx_ozon_postings_date", "shop_id", "shipment_date"),
        Index("idx_ozon_postings_warehouse", "warehouse_id", "status"),
        # 优化 in_process_at 范围查询（部分索引，仅索引非空值）
        Index(
            "idx_ozon_postings_in_process",
            "shop_id", "in_process_at", "status",
            postgresql_where=text("in_process_at IS NOT NULL")
        ),
        # 优化按状态+时间的统计查询
        Index("idx_ozon_postings_status_time", "status", "in_process_at", "shop_id"),
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

    __table_args__ = (
        Index("idx_ozon_refunds_status", "shop_id", "status"),
        Index("idx_ozon_refunds_date", "shop_id", "requested_at")
    )