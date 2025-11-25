"""
Ozon 统计相关数据模型
"""
from datetime import datetime, timezone, date
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Column, Integer, BigInteger, Numeric,
    DateTime, Date, ForeignKey, Index, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class OzonDailyStats(Base):
    """
    每日统计汇总表

    用于报表预聚合，每天凌晨由定时任务计算过去30天的数据。
    订单生命周期长（发货到签收可达1个月），需要滚动更新。
    """
    __tablename__ = "ozon_daily_stats"

    id = Column(BigInteger, primary_key=True)
    shop_id = Column(Integer, ForeignKey("ozon_shops.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, comment="统计日期")

    # 订单统计
    order_count = Column(Integer, nullable=False, default=0, comment="订单数")
    delivered_count = Column(Integer, nullable=False, default=0, comment="已签收订单数")
    cancelled_count = Column(Integer, nullable=False, default=0, comment="已取消订单数")

    # 金额统计（CNY，Decimal精度）
    total_sales = Column(Numeric(18, 4), nullable=False, default=Decimal("0"), comment="销售总额(CNY)")
    total_purchase = Column(Numeric(18, 4), nullable=False, default=Decimal("0"), comment="采购成本(CNY)")
    total_profit = Column(Numeric(18, 4), nullable=False, default=Decimal("0"), comment="毛利润(CNY)")
    total_commission = Column(Numeric(18, 4), nullable=False, default=Decimal("0"), comment="平台佣金(CNY)")
    total_logistics = Column(Numeric(18, 4), nullable=False, default=Decimal("0"), comment="物流费用(CNY)")
    total_material_cost = Column(Numeric(18, 4), nullable=False, default=Decimal("0"), comment="物料成本(CNY)")

    # 商品维度（JSONB 存储 TOP 商品）
    top_products = Column(JSONB, comment="TOP商品 [{offer_id, name, quantity, sales}]")

    # 元数据
    generated_at = Column(DateTime(timezone=True), comment="统计生成时间")
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (
        # 唯一约束：每个店铺每天只有一条统计记录
        UniqueConstraint("shop_id", "date", name="uq_ozon_daily_stats_shop_date"),
        # 日期索引：优化按日期范围查询
        Index("idx_ozon_daily_stats_date", "date"),
        # 复合索引：优化店铺+日期范围查询
        Index("idx_ozon_daily_stats_shop_date", "shop_id", "date"),
    )
