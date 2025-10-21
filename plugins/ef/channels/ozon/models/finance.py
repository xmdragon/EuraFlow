"""
OZON 财务交易记录数据模型
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Column, String, Integer, BigInteger, Numeric,
    DateTime, JSON, ForeignKey, Index, UniqueConstraint, Text
)
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class OzonFinanceTransaction(Base):
    """OZON 财务交易记录表（扁平化存储）"""
    __tablename__ = "ozon_finance_transactions"

    # 主键
    id = Column(BigInteger, primary_key=True)

    # 店铺隔离
    shop_id = Column(Integer, ForeignKey("ozon_shops.id"), nullable=False, index=True)

    # OZON交易标识
    operation_id = Column(BigInteger, nullable=False, comment="OZON操作ID")
    operation_type = Column(String(200), nullable=False, comment="操作类型")
    operation_type_name = Column(String(500), comment="操作类型名称")

    # 交易分类
    transaction_type = Column(String(50), nullable=False, comment="收费类型: orders/returns/services/compensation/transferDelivery/other")

    # 关联信息
    posting_number = Column(String(100), comment="发货单号")

    # 交易日期
    operation_date = Column(DateTime(timezone=True), nullable=False, comment="操作日期")

    # 金额字段（Decimal 18,4，RUB卢布）
    accruals_for_sale = Column(Numeric(18, 4), default=Decimal("0"), comment="考虑卖家折扣的商品成本")
    amount = Column(Numeric(18, 4), default=Decimal("0"), comment="交易总额")
    delivery_charge = Column(Numeric(18, 4), default=Decimal("0"), comment="运费")
    return_delivery_charge = Column(Numeric(18, 4), default=Decimal("0"), comment="退货运费")
    sale_commission = Column(Numeric(18, 4), default=Decimal("0"), comment="销售佣金或佣金返还")

    # 商品明细（扁平化字段，用于快速查询）
    # 注意：一个operation可能包含多个item，会展开成多条记录
    item_sku = Column(String(100), comment="商品SKU")
    item_name = Column(String(500), comment="商品名称")
    item_quantity = Column(Integer, comment="商品数量")
    item_price = Column(Numeric(18, 4), comment="商品价格")

    # 发货单信息（从posting对象提取）
    posting_delivery_schema = Column(String(200), comment="配送方式")
    posting_warehouse_name = Column(String(200), comment="仓库名称")

    # 服务费用（JSON数组，保留完整结构）
    services_json = Column(JSONB, comment="附加服务费用列表")

    # 原始数据（完整的operation对象）
    raw_data = Column(JSONB, comment="OZON原始交易数据")

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow, comment="记录创建时间")
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, comment="记录更新时间")

    __table_args__ = (
        # 唯一约束：同一个operation_id + item_sku组合只能有一条记录（扁平化后的唯一性）
        UniqueConstraint("shop_id", "operation_id", "item_sku", name="uq_ozon_finance_transaction"),
        # 按店铺+日期查询（高频）
        Index("idx_ozon_finance_shop_date", "shop_id", "operation_date"),
        # 按发货单号查询（关联订单）
        Index("idx_ozon_finance_posting", "posting_number"),
        # 按操作ID查询（去重检查）
        Index("idx_ozon_finance_operation", "operation_id"),
        # 按交易类型和操作类型查询（分类统计）
        Index("idx_ozon_finance_type", "shop_id", "transaction_type", "operation_type"),
    )

    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "shop_id": self.shop_id,
            "operation_id": self.operation_id,
            "operation_type": self.operation_type,
            "operation_type_name": self.operation_type_name,
            "transaction_type": self.transaction_type,
            "posting_number": self.posting_number,
            "operation_date": self.operation_date.isoformat() if self.operation_date else None,
            # 金额字段转为字符串（保持精度）
            "accruals_for_sale": str(self.accruals_for_sale) if self.accruals_for_sale else "0",
            "amount": str(self.amount) if self.amount else "0",
            "delivery_charge": str(self.delivery_charge) if self.delivery_charge else "0",
            "return_delivery_charge": str(self.return_delivery_charge) if self.return_delivery_charge else "0",
            "sale_commission": str(self.sale_commission) if self.sale_commission else "0",
            # 商品明细
            "item_sku": self.item_sku,
            "item_name": self.item_name,
            "item_quantity": self.item_quantity,
            "item_price": str(self.item_price) if self.item_price else None,
            # 发货单信息
            "posting_delivery_schema": self.posting_delivery_schema,
            "posting_warehouse_name": self.posting_warehouse_name,
            # JSON字段
            "services_json": self.services_json,
            # 时间戳
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class OzonFinanceSyncWatermark(Base):
    """财务数据同步水位线（记录同步进度）"""
    __tablename__ = "ozon_finance_sync_watermarks"

    id = Column(Integer, primary_key=True)
    shop_id = Column(Integer, ForeignKey("ozon_shops.id"), nullable=False, unique=True)

    # 最后成功同步的日期
    last_sync_date = Column(DateTime(timezone=True), comment="最后成功同步的日期（UTC）")

    # 同步状态
    sync_status = Column(String(20), default="idle", comment="同步状态: idle/running/failed")
    sync_error = Column(Text, comment="同步错误信息")

    # 统计信息
    total_synced_count = Column(Integer, default=0, comment="总同步交易数")
    last_sync_count = Column(Integer, default=0, comment="最后一次同步的交易数")

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("idx_ozon_finance_watermark_shop", "shop_id"),
    )
