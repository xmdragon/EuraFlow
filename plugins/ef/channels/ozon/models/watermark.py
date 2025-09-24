"""
水印相关数据模型
"""

from datetime import datetime
from typing import Optional, Dict, Any, List
from decimal import Decimal
from uuid import uuid4
from sqlalchemy import (
    BigInteger,
    String,
    Text,
    DateTime,
    JSON,
    Boolean,
    ForeignKey,
    UniqueConstraint,
    func,
    Numeric,
    Integer,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ef_core.models.base import Base


class WatermarkConfig(Base):
    """水印配置模型"""

    __tablename__ = "watermark_configs"

    # 主键
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="配置ID")

    # 店铺关联
    shop_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ozon_shops.id", ondelete="CASCADE"), nullable=False, comment="店铺ID"
    )

    # 水印信息
    name: Mapped[str] = mapped_column(String(100), nullable=False, comment="水印名称")
    cloudinary_public_id: Mapped[str] = mapped_column(Text, nullable=False, comment="Cloudinary中的public_id")
    image_url: Mapped[str] = mapped_column(Text, nullable=False, comment="水印图片URL")
    color_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="white", comment="水印颜色类型: white, blue, transparent"
    )

    # 水印参数
    scale_ratio: Mapped[Decimal] = mapped_column(
        Numeric(5, 3), default=Decimal("0.1"), nullable=False, comment="水印缩放比例"
    )
    opacity: Mapped[Decimal] = mapped_column(
        Numeric(3, 2), default=Decimal("0.8"), nullable=False, comment="水印透明度"
    )
    margin_pixels: Mapped[int] = mapped_column(Integer, default=20, nullable=False, comment="水印边距(像素)")

    # 允许的位置
    positions: Mapped[Optional[List[str]]] = mapped_column(
        JSON, default=["bottom_right"], nullable=True, comment="允许的水印位置"
    )

    # 状态
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, comment="是否激活")

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, comment="更新时间"
    )

    # 关系
    tasks: Mapped[List["WatermarkTask"]] = relationship("WatermarkTask", back_populates="watermark_config")


class CloudinaryConfig(Base):
    """Cloudinary配置模型（加密存储凭证）"""

    __tablename__ = "cloudinary_configs"
    __table_args__ = (UniqueConstraint("shop_id", name="uq_cloudinary_config_shop"),)

    # 主键
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="配置ID")

    # 店铺关联
    shop_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ozon_shops.id", ondelete="CASCADE"), nullable=False, comment="店铺ID"
    )

    # Cloudinary凭证
    cloud_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="Cloud Name")
    api_key: Mapped[str] = mapped_column(String(100), nullable=False, comment="API Key")
    api_secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False, comment="加密的API Secret")

    # 配置参数
    folder_prefix: Mapped[str] = mapped_column(
        String(50), default="euraflow", nullable=False, comment="文件夹前缀"
    )
    auto_cleanup_days: Mapped[int] = mapped_column(
        Integer, default=30, nullable=False, comment="自动清理天数"
    )

    # 使用统计
    last_quota_check: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="最后配额检查时间"
    )
    storage_used_bytes: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True, comment="已使用存储(字节)"
    )
    bandwidth_used_bytes: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True, comment="已使用带宽(字节)"
    )

    # 状态
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, comment="是否激活")
    last_test_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="最后测试连接时间"
    )
    last_test_success: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True, comment="最后测试是否成功"
    )

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, comment="更新时间"
    )


class WatermarkTask(Base):
    """水印任务模型"""

    __tablename__ = "watermark_tasks"
    __table_args__ = (
        UniqueConstraint(
            "shop_id",
            "product_id",
            "status",
            name="uq_watermark_task_processing",
            postgresql_where="status IN ('pending', 'processing')",
        ),
    )

    # 主键 (使用UUID)
    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
        comment="任务ID"
    )

    # 关联
    shop_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ozon_shops.id", ondelete="CASCADE"), nullable=False, comment="店铺ID"
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ozon_products.id", ondelete="CASCADE"), nullable=False, comment="商品ID"
    )
    watermark_config_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("watermark_configs.id", ondelete="SET NULL"), nullable=True, comment="水印配置ID"
    )

    # 任务信息
    task_type: Mapped[str] = mapped_column(
        String(20), nullable=False, comment="任务类型: apply(应用水印), restore(还原原图)"
    )
    status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        nullable=False,
        comment="任务状态: pending, processing, completed, failed, cancelled",
    )

    # 图片数据
    original_images: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True, comment="原始图片URL备份"
    )
    processed_images: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True, comment="处理后图片URL"
    )
    cloudinary_public_ids: Mapped[Optional[List[str]]] = mapped_column(
        JSON, nullable=True, comment="Cloudinary public_id列表(用于清理)"
    )

    # 处理元数据
    processing_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True, comment="处理详情(位置选择、参数等)"
    )

    # 错误处理
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="错误信息")
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="重试次数")
    max_retries: Mapped[int] = mapped_column(Integer, default=3, nullable=False, comment="最大重试次数")

    # 批处理信息
    batch_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True, comment="批次ID(用于批量操作)"
    )
    batch_total: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="批次总数")
    batch_position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="批次中的位置")

    # 时间戳
    processing_started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="处理开始时间"
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="完成时间"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, comment="更新时间"
    )

    # 关系
    watermark_config: Mapped[Optional["WatermarkConfig"]] = relationship(
        "WatermarkConfig", back_populates="tasks"
    )