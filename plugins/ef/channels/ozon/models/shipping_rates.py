"""
OZON 物流费率表
存储各物流服务商的费率配置信息
"""
from datetime import datetime, timezone

from sqlalchemy import Column, String, Integer, BigInteger, Boolean, DateTime, Index

from ef_core.database import Base


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class OzonShippingRate(Base):
    """OZON 物流费率配置"""
    __tablename__ = "ozon_shipping_rates"

    id = Column(BigInteger, primary_key=True)

    # 基础分类
    size_group = Column(String(50), nullable=False, comment="评分组: Extra Small/Budget/Small/Big/Premium Small/Premium Big")
    service_level = Column(String(20), nullable=False, comment="服务等级: Express/Standard/Economy")
    logistics_provider = Column(String(50), nullable=False, comment="第三方物流: RETS/ZTO/Ural/CEL 等")
    delivery_method = Column(String(100), nullable=False, comment="配送方式名称")

    # 评级和时效
    ozon_rating = Column(Integer, comment="Ozon评级 (1-15)")
    transit_days = Column(String(20), comment="时效限制: 5-10, 10-15 等")

    # 费率
    rate = Column(String(100), comment="费率: ¥2,9 + ¥0,045/1g")

    # 限制条件
    battery_allowed = Column(Boolean, default=False, comment="是否允许电池")
    liquid_allowed = Column(Boolean, default=False, comment="是否允许液体")
    size_limit = Column(String(200), comment="尺寸限制")
    weight_min_g = Column(Integer, comment="最小重量(克)")
    weight_max_g = Column(Integer, comment="最大重量(克)")

    # 货值限制
    value_limit_rub = Column(String(50), comment="货值限制(卢布)")
    value_limit_cny = Column(String(50), comment="货值限制(人民币)")
    value_limit_usd = Column(String(50), comment="货值限制(美元)")
    value_limit_eur = Column(String(50), comment="货值限制(欧元)")

    # 计费方式
    billing_type = Column(String(50), comment="计费类型: 实际重量/最大实际重量与体积重量")
    volume_weight_calc = Column(String(100), comment="体积重量计算方式")
    loss_compensation_rub = Column(Integer, comment="丢失赔偿上限(卢布)")

    # 时间戳
    created_at = Column(DateTime(timezone=True), default=utcnow, comment="创建时间")

    __table_args__ = (
        Index("idx_shipping_rates_provider", "logistics_provider"),
        Index("idx_shipping_rates_size_service", "size_group", "service_level"),
    )
