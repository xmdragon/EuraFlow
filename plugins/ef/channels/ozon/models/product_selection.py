"""
选品助手数据模型
"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime, JSON, Text, Index, UniqueConstraint, ForeignKey, Boolean
from sqlalchemy.sql import func
from datetime import datetime
from decimal import Decimal as D

from ef_core.database import Base


class ProductSelectionItem(Base):
    """选品商品数据模型"""
    __tablename__ = "ozon_product_selection_items"

    id = Column(Integer, primary_key=True, index=True)

    # 用户关联（支持账号隔离）
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True, comment="用户ID")

    # 商品基础信息
    product_id = Column(String(50), nullable=False, index=True, comment="商品ID")
    product_name_ru = Column(String(500), comment="俄文名称")
    product_name_cn = Column(String(500), comment="中文名称")
    ozon_link = Column(Text, comment="商品链接")
    image_url = Column(Text, comment="图片链接")
    category_link = Column(Text, comment="类目链接")

    # 品牌（标准化后存储）
    brand = Column(String(200), index=True, comment="品牌")
    brand_normalized = Column(String(200), index=True, comment="标准化品牌名")

    # 价格信息（使用Numeric存储）
    current_price = Column(Numeric(18, 2), comment="当前价格(RMB分)")
    original_price = Column(Numeric(18, 2), comment="原价(RMB分)")

    # 佣金率信息（百分比）
    rfbs_commission_low = Column(Numeric(5, 2), comment="rFBS(<=1500₽)佣金率")
    rfbs_commission_mid = Column(Numeric(5, 2), comment="rFBS(1501-5000₽)佣金率")
    rfbs_commission_high = Column(Numeric(5, 2), comment="rFBS(>5000₽)佣金率")
    fbp_commission_low = Column(Numeric(5, 2), comment="FBP(<=1500₽)佣金率")
    fbp_commission_mid = Column(Numeric(5, 2), comment="FBP(1501-5000₽)佣金率")
    fbp_commission_high = Column(Numeric(5, 2), comment="FBP(>5000₽)佣金率")

    # 销售数据
    monthly_sales_volume = Column(Integer, index=True, comment="月销量(件)")
    monthly_sales_revenue = Column(Numeric(18, 2), comment="月销售额(RUB)")
    daily_sales_volume = Column(Numeric(10, 2), comment="平均日销量(件)")
    daily_sales_revenue = Column(Numeric(18, 2), comment="平均日销售额(RUB)")
    sales_dynamic_percent = Column(Numeric(10, 2), comment="销售动态(%)")
    conversion_rate = Column(Numeric(5, 2), comment="成交率(%)")

    # 竞争对手数据
    competitor_count = Column(Integer, default=0, comment="跟卖者数量")
    competitor_min_price = Column(Numeric(18, 2), comment="跟卖最低价(RMB分)")
    market_min_price = Column(Numeric(18, 2), comment="市场最低价(RMB分)")
    price_index = Column(Numeric(10, 2), comment="价格指数")

    # 物流信息
    package_weight = Column(Integer, index=True, comment="包装重量(克)")
    package_volume = Column(Numeric(10, 2), comment="包装体积(升)")
    package_length = Column(Integer, comment="包装长度(mm)")
    package_width = Column(Integer, comment="包装宽度(mm)")
    package_height = Column(Integer, comment="包装高度(mm)")

    # 商品评价
    rating = Column(Numeric(3, 2), comment="商品评分")
    review_count = Column(Integer, comment="评价数量")

    # 其他信息
    seller_type = Column(String(50), comment="卖家类型(FBS/FBO)")
    delivery_days = Column(Integer, comment="配送时间(天)")
    availability_percent = Column(Numeric(5, 2), comment="商品可用性(%)")
    ad_cost_share = Column(Numeric(5, 2), comment="广告费用份额(%)")

    # 商品创建日期（在平台上）
    product_created_date = Column(DateTime(timezone=True), comment="商品创建日期")

    # 商品图片信息
    images_data = Column(JSON, comment="商品图片信息列表")
    images_updated_at = Column(DateTime(timezone=True), comment="图片信息更新时间")

    # 批次管理字段
    batch_id = Column(Integer, ForeignKey("ozon_product_selection_import_history.id"), nullable=True, index=True, comment="导入批次ID")
    is_read = Column(Boolean, default=False, nullable=False, comment="是否已读")
    read_at = Column(DateTime(timezone=True), nullable=True, comment="标记已读时间")

    # 系统字段
    created_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=func.now(), onupdate=func.now(), nullable=False)

    # 索引定义
    __table_args__ = (
        Index('idx_brand_price', 'brand_normalized', 'current_price'),
        Index('idx_sales_weight', 'monthly_sales_volume', 'package_weight'),
        Index('idx_commission', 'rfbs_commission_low', 'rfbs_commission_mid',
              'fbp_commission_low', 'fbp_commission_mid'),
        Index('idx_batch_read', 'batch_id', 'is_read'),
    )

    def to_dict(self):
        """转换为字典"""
        return {
            'id': self.id,
            'product_id': self.product_id,
            'product_name_ru': self.product_name_ru,
            'product_name_cn': self.product_name_cn,
            'ozon_link': self.ozon_link,
            'image_url': self.image_url,
            'brand': self.brand,
            'current_price': str(self.current_price) if self.current_price else None,
            'original_price': str(self.original_price) if self.original_price else None,
            'rfbs_commission_low': float(self.rfbs_commission_low) if self.rfbs_commission_low else None,
            'rfbs_commission_mid': float(self.rfbs_commission_mid) if self.rfbs_commission_mid else None,
            'fbp_commission_low': float(self.fbp_commission_low) if self.fbp_commission_low else None,
            'fbp_commission_mid': float(self.fbp_commission_mid) if self.fbp_commission_mid else None,
            'monthly_sales_volume': self.monthly_sales_volume,
            'package_weight': self.package_weight,
            'rating': float(self.rating) if self.rating else None,
            'review_count': self.review_count,
            'seller_type': self.seller_type,
            # 竞争对手数据
            'competitor_count': self.competitor_count,
            'competitor_min_price': str(self.competitor_min_price) if self.competitor_min_price else None,
            'market_min_price': str(self.market_min_price) if self.market_min_price else None,
            'price_index': str(self.price_index) if self.price_index else None,
            # 图片数据
            'images_data': self.images_data,
            'images_updated_at': self.images_updated_at.isoformat() if self.images_updated_at else None,
            # 批次管理
            'batch_id': self.batch_id,
            'is_read': self.is_read,
            'read_at': self.read_at.isoformat() if self.read_at else None,
            # 商品上架时间
            'product_created_date': self.product_created_date.isoformat() if self.product_created_date else None,
            # 系统字段
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class ImportHistory(Base):
    """导入历史记录"""
    __tablename__ = "ozon_product_selection_import_history"

    id = Column(Integer, primary_key=True, index=True)

    # 文件信息
    file_name = Column(String(255), nullable=False, comment="文件名")
    file_type = Column(String(10), nullable=False, comment="文件类型(xlsx/csv)")
    file_size = Column(Integer, comment="文件大小(字节)")

    # 导入信息
    imported_by = Column(Integer, nullable=False, comment="导入用户ID")
    import_time = Column(DateTime(timezone=True), default=func.now(), nullable=False, comment="导入时间")
    import_strategy = Column(String(20), default='update', comment="导入策略(skip/update/append)")

    # 导入结果统计
    total_rows = Column(Integer, default=0, comment="总行数")
    success_rows = Column(Integer, default=0, comment="成功行数")
    failed_rows = Column(Integer, default=0, comment="失败行数")
    updated_rows = Column(Integer, default=0, comment="更新行数")
    skipped_rows = Column(Integer, default=0, comment="跳过行数")

    # 详细日志
    import_log = Column(JSON, comment="导入日志详情")
    error_details = Column(JSON, comment="错误详情")

    # 处理时间
    process_duration = Column(Integer, comment="处理耗时(秒)")

    created_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)

    def to_dict(self):
        """转换为字典"""
        return {
            'id': self.id,
            'file_name': self.file_name,
            'file_type': self.file_type,
            'file_size': self.file_size,
            'imported_by': self.imported_by,
            'import_time': self.import_time.isoformat() if self.import_time else None,
            'import_strategy': self.import_strategy,
            'total_rows': self.total_rows,
            'success_rows': self.success_rows,
            'failed_rows': self.failed_rows,
            'updated_rows': self.updated_rows,
            'skipped_rows': self.skipped_rows,
            'process_duration': self.process_duration,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }