"""
一键上架 API路由
从OZON商品页一键采集并上架到OZON
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from decimal import Decimal
import logging

from ef_core.database import get_async_session
from ef_core.api.auth import get_current_user_from_api_key
from ef_core.models.users import User
from ..services.quick_publish_service import QuickPublishService
from ..models import OzonWarehouse, OzonShop
from ..models.watermark import CloudinaryConfig, AliyunOssConfig, WatermarkConfig
from ..services.image_storage_factory import ImageStorageFactory
from sqlalchemy import select, or_

router = APIRouter(prefix="/quick-publish", tags=["ozon-quick-publish"])
logger = logging.getLogger(__name__)


# DTO模型
class DimensionsDTO(BaseModel):
    """商品尺寸重量"""
    weight: int = Field(..., description="重量（克）", gt=0)
    height: int = Field(..., description="高度（毫米）", gt=0)
    width: int = Field(..., description="宽度（毫米）", gt=0)
    length: int = Field(..., description="长度（毫米）", gt=0)


class AttributeDTO(BaseModel):
    """商品属性"""
    attribute_id: int
    value: Optional[str] = None
    dictionary_value_id: Optional[int] = None


class QuickPublishDTO(BaseModel):
    """一键上架DTO"""
    # 店铺和仓库
    shop_id: int = Field(..., description="店铺ID")
    warehouse_ids: List[int] = Field(default_factory=list, description="仓库ID列表（FBS/rFBS）")

    # 用户输入（必填）
    sku: str = Field(..., description="OZON SKU", min_length=1, max_length=50)
    offer_id: str = Field(..., description="商家SKU", min_length=1, max_length=50)
    price: Decimal = Field(..., gt=0, description="销售价格（卢布）")
    stock: int = Field(..., ge=0, description="库存数量")
    category_id: int = Field(..., description="OZON类目ID（必须是叶子类目）")

    # 可选
    old_price: Optional[Decimal] = Field(None, gt=0, description="原价（卢布）")

    # 从页面采集的数据
    ozon_product_id: Optional[str] = Field(None, description="OZON商品ID（用于参考）")
    title: str = Field(..., min_length=1, max_length=500, description="商品标题")
    description: Optional[str] = Field(None, description="商品描述")
    images: List[str] = Field(default_factory=list, max_items=15, description="图片URL列表（最多15张）")
    brand: Optional[str] = Field(None, description="品牌")
    barcode: Optional[str] = Field(None, description="条码")

    # 尺寸重量（OZON必填）
    dimensions: DimensionsDTO = Field(..., description="商品尺寸和重量")

    # 属性（根据类目要求）
    attributes: List[AttributeDTO] = Field(default_factory=list, description="商品属性列表")


class QuickPublishResponseDTO(BaseModel):
    """一键上架响应 (异步版本)"""
    task_id: str = Field(..., description="Celery 任务 ID")
    status: str = Field(default="pending", description="任务状态")
    message: str = Field(..., description="提示信息")
    success: Optional[bool] = Field(None, description="是否成功（已废弃,保留兼容）")
    error: Optional[str] = Field(None, description="错误信息")


class QuickPublishVariantDTO(BaseModel):
    """单个变体的上架数据（仅变体特有字段）"""
    sku: str = Field(..., description="OZON SKU", min_length=1, max_length=50)
    offer_id: str = Field(..., description="商家SKU", min_length=1, max_length=50)
    price: Decimal = Field(..., gt=0, description="销售价格（分）")
    stock: int = Field(..., ge=0, description="库存数量")
    old_price: Optional[Decimal] = Field(None, gt=0, description="原价（分）")
    primary_image: Optional[str] = Field(None, description="变体主图URL（单个图片）")


class QuickPublishBatchDTO(BaseModel):
    """批量上架DTO"""
    # 店铺和仓库（共享）
    shop_id: int = Field(..., description="店铺ID")
    warehouse_ids: List[int] = Field(default_factory=list, description="仓库ID列表（FBS/rFBS）")
    watermark_config_id: Optional[int] = Field(None, description="水印配置ID（可选）")

    # 变体列表
    variants: List[QuickPublishVariantDTO] = Field(..., min_length=1, max_length=1000, description="变体列表（1-1000个，OZON限制）")

    # 商品共享数据
    ozon_product_id: Optional[str] = Field(None, description="OZON商品ID（用于参考）")
    title: str = Field(..., min_length=1, max_length=500, description="商品标题")
    description: Optional[str] = Field(None, description="商品描述")
    images: List[str] = Field(default_factory=list, max_length=15, description="图片URL列表（最多15张）")
    brand: Optional[str] = Field(None, description="品牌")
    barcode: Optional[str] = Field(None, description="条码")
    category_id: int = Field(..., description="OZON类目ID（必须是叶子类目）")

    # 尺寸重量（OZON必填）
    dimensions: DimensionsDTO = Field(..., description="商品尺寸和重量")

    # 属性（根据类目要求）
    attributes: List[AttributeDTO] = Field(default_factory=list, description="商品属性列表")


class QuickPublishBatchResponseDTO(BaseModel):
    """批量上架响应"""
    task_ids: List[str] = Field(..., description="任务ID列表")
    task_count: int = Field(..., description="任务数量")
    message: str = Field(..., description="提示信息")
    success: bool = Field(default=True, description="是否成功")
    error: Optional[str] = Field(None, description="错误信息")


class StepDetailDTO(BaseModel):
    """步骤详情"""
    status: str = Field(..., description="步骤状态 (pending/running/completed/failed/skipped)")
    message: Optional[str] = Field(None, description="步骤消息")
    product_id: Optional[int] = Field(None, description="商品ID (create_product 步骤)")
    total: Optional[int] = Field(None, description="总数 (upload_images 步骤)")
    uploaded: Optional[int] = Field(None, description="已上传数 (upload_images 步骤)")
    storage_type: Optional[str] = Field(None, description="存储类型 (upload_images 步骤)")
    stock: Optional[int] = Field(None, description="库存 (update_stock 步骤)")
    error: Optional[str] = Field(None, description="错误信息")


class TaskStatusResponseDTO(BaseModel):
    """任务状态响应 (Celery 版本)"""
    task_id: str = Field(..., description="任务ID")
    status: str = Field(..., description="任务状态 (pending/running/completed/failed/not_found)")
    current_step: Optional[str] = Field(None, description="当前步骤")
    progress: int = Field(default=0, description="进度百分比 (0-100)")
    steps: Optional[Dict[str, StepDetailDTO]] = Field(None, description="各步骤详情")
    created_at: Optional[str] = Field(None, description="任务创建时间")
    updated_at: Optional[str] = Field(None, description="任务更新时间")
    error: Optional[str] = Field(None, description="错误信息")


# API端点
@router.post("/publish", response_model=QuickPublishResponseDTO)
async def quick_publish(
    dto: QuickPublishDTO,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    一键上架到OZON

    流程：
    1. 验证店铺和仓库
    2. 图片转存到Cloudinary（如果配置）
    3. 调用OZON API导入商品
    4. 返回任务ID供前端轮询状态

    权限：需要有效的API Key
    """
    try:
        # 记录完整的请求数据
        logger.info("=" * 80)
        logger.info(f"一键上架请求 - 用户ID: {user.id}")
        logger.info(f"店铺ID: {dto.shop_id}")
        logger.info(f"仓库IDs: {dto.warehouse_ids}")
        logger.info(f"OZON SKU: {dto.sku}")
        logger.info(f"商家SKU (offer_id): {dto.offer_id}")
        logger.info(f"价格: {dto.price}, 原价: {dto.old_price}")
        logger.info(f"库存: {dto.stock}")
        logger.info(f"类目ID: {dto.category_id}")
        logger.info(f"标题: {dto.title}")
        logger.info(f"品牌: {dto.brand}")
        logger.info(f"条码: {dto.barcode}")
        logger.info(f"图片数量: {len(dto.images)}")
        logger.info(f"图片URLs: {dto.images}")
        logger.info(f"尺寸重量: weight={dto.dimensions.weight}g, h={dto.dimensions.height}mm, w={dto.dimensions.width}mm, l={dto.dimensions.length}mm")
        logger.info(f"属性数量: {len(dto.attributes)}")
        for idx, attr in enumerate(dto.attributes):
            logger.info(f"  属性{idx+1}: id={attr.attribute_id}, value={attr.value}, dict_value_id={attr.dictionary_value_id}")
        logger.info(f"完整DTO: {dto.model_dump() if hasattr(dto, 'model_dump') else dto.dict()}")
        logger.info("=" * 80)

        service = QuickPublishService()
        result = await service.quick_publish(db, dto, user.id)
        return result
    except Exception as e:
        logger.error(f"Quick publish API error: {e}", exc_info=True)
        return QuickPublishResponseDTO(
            task_id="",
            status="error",
            message="上架失败",
            error=str(e)
        )


@router.post("/batch", response_model=QuickPublishBatchResponseDTO)
async def quick_publish_batch(
    dto: QuickPublishBatchDTO,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    批量一键上架（多个变体一次性提交）

    使用场景：
    - 跟卖商品时，有多个变体（如不同颜色、尺寸）
    - 一次性提交所有变体，每个变体独立上架
    - 返回多个任务ID，前端并发轮询各任务进度

    限制：
    - 最多1000个变体（OZON限制）
    - 每个变体创建独立的Celery任务
    - 图片、标题、描述等数据由所有变体共享
    """
    try:
        logger.info("=" * 80)
        logger.info(f"批量上架请求 - 用户ID: {user.id}")
        logger.info(f"店铺ID: {dto.shop_id}, 变体数量: {len(dto.variants)}")
        logger.info(f"仓库IDs: {dto.warehouse_ids}")
        logger.info(f"商品标题: {dto.title}")
        logger.info(f"图片数量: {len(dto.images)}")
        logger.info(f"类目ID: {dto.category_id}")
        for idx, variant in enumerate(dto.variants):
            logger.info(f"  变体{idx+1}: SKU={variant.sku}, offer_id={variant.offer_id}, price={variant.price}, stock={variant.stock}")
        logger.info("=" * 80)

        service = QuickPublishService()
        result = await service.quick_publish_batch(db, dto, user.id)
        return result
    except Exception as e:
        logger.error(f"批量上架失败: {e}", exc_info=True)
        return QuickPublishBatchResponseDTO(
            task_ids=[],
            task_count=0,
            message="批量上架失败",
            success=False,
            error=str(e)
        )


@router.get("/task/{task_id}/status", response_model=TaskStatusResponseDTO)
async def get_task_status(
    task_id: str,
    shop_id: int = Query(..., description="店铺ID (用于权限验证)"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    查询 Celery 任务状态 (一键跟卖异步任务)

    前端需要轮询此接口（建议每 3-5 秒）直到状态为 completed 或 failed

    状态说明：
    - pending: 任务已提交，等待执行
    - running: 任务执行中
    - completed: 任务完成（所有步骤成功）
    - failed: 任务失败（某个步骤失败）
    - not_found: 任务不存在或已过期（Redis 中找不到）

    步骤说明：
    - create_product: 通过 SKU 创建商品
    - upload_images: 上传图片到图库 (Cloudinary/Aliyun OSS)
    - update_images: 更新 OZON 商品图片
    - update_stock: 更新库存

    进度计算：
    - 0-25%: create_product
    - 25-50%: upload_images
    - 50-75%: update_images
    - 75-100%: update_stock
    """
    try:
        service = QuickPublishService()
        status = await service.get_task_status(db, task_id, shop_id)
        return status
    except Exception as e:
        logger.error(f"Get task status error: {e}", exc_info=True)
        return TaskStatusResponseDTO(
            task_id=task_id,
            status="error",
            progress=0,
            error=str(e)
        )


@router.get("/shops/{shop_id}/warehouses")
async def get_shop_warehouses(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    获取店铺的仓库列表

    用于前端下拉框选择仓库
    只返回状态为 created 的可用仓库
    """
    try:
        result = await db.execute(
            select(OzonWarehouse)
            .where(OzonWarehouse.shop_id == shop_id)
            .where(OzonWarehouse.status == 'created')
            .order_by(OzonWarehouse.is_rfbs.desc(), OzonWarehouse.name)
        )
        warehouses = result.scalars().all()

        return {
            "success": True,
            "data": [
                {
                    "warehouse_id": wh.warehouse_id,
                    "name": wh.name,
                    "is_rfbs": wh.is_rfbs,
                    "status": wh.status
                }
                for wh in warehouses
            ]
        }
    except Exception as e:
        logger.error(f"Get warehouses error: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/config")
async def get_quick_publish_config(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    获取一键上架所需的所有配置（店铺、仓库、水印）

    返回格式：
    {
      "success": true,
      "data": {
        "shops": [
          {
            "id": 1,
            "display_name": "店铺1",
            "warehouses": [
              {"id": 1, "name": "FBS仓", "is_rfbs": false},
              {"id": 2, "name": "rFBS仓", "is_rfbs": true}
            ]
          }
        ],
        "watermarks": [
          {"id": 1, "name": "Cloudinary", "type": "cloudinary", "is_default": true},
          {"id": 2, "name": "阿里云OSS", "type": "aliyun_oss", "is_default": false}
        ]
      }
    }

    优化：单次请求获取所有配置，减少网络往返
    """
    try:
        from ef_core.models.users import user_shops

        # 1. 获取店铺列表（根据用户角色和权限）
        if user.role == "admin":
            # admin 返回所有店铺
            stmt = select(OzonShop).where(OzonShop.status == 'active')
        else:
            # 其他用户通过 user_shops 关联表获取授权的店铺
            stmt = select(OzonShop).join(
                user_shops, OzonShop.id == user_shops.c.shop_id
            ).where(user_shops.c.user_id == user.id).where(OzonShop.status == 'active')

        shops_result = await db.execute(stmt.order_by(OzonShop.shop_name))
        shops = shops_result.scalars().all()

        # 2. 获取所有店铺的仓库（批量查询，避免N+1）
        shop_ids = [shop.id for shop in shops]
        if shop_ids:
            warehouses_result = await db.execute(
                select(OzonWarehouse)
                .where(OzonWarehouse.shop_id.in_(shop_ids))
                .where(OzonWarehouse.status == 'created')
                .order_by(OzonWarehouse.shop_id, OzonWarehouse.is_rfbs.desc(), OzonWarehouse.name)
            )
            all_warehouses = warehouses_result.scalars().all()

            # 按店铺ID分组
            warehouses_by_shop = {}
            for wh in all_warehouses:
                if wh.shop_id not in warehouses_by_shop:
                    warehouses_by_shop[wh.shop_id] = []
                warehouses_by_shop[wh.shop_id].append({
                    "id": wh.warehouse_id,
                    "name": wh.name,
                    "is_rfbs": wh.is_rfbs,
                    "status": wh.status
                })
        else:
            warehouses_by_shop = {}

        # 3. 获取水印配置（基于当前激活的图床）
        # 仅返回与当前激活图床匹配的水印配置
        watermarks = []

        # 获取当前激活的图床类型
        active_provider = await ImageStorageFactory.get_active_provider_type(db)

        if active_provider:
            logger.info(f"当前激活的图床类型: {active_provider}")

            # 查询该图床关联的水印配置
            watermark_result = await db.execute(
                select(WatermarkConfig)
                .where(WatermarkConfig.storage_provider == active_provider)
                .order_by(WatermarkConfig.created_at.desc())
            )
            watermark_configs = watermark_result.scalars().all()

            logger.info(f"找到 {len(watermark_configs)} 个水印配置")

            watermarks = [
                {
                    "id": config.id,
                    "name": config.name,
                    "image_url": config.image_url,
                    "is_active": config.is_active,
                    "storage_provider": config.storage_provider
                }
                for config in watermark_configs
            ]
        else:
            logger.warning("没有找到激活的图床配置，返回空水印列表")

        # 4. 组装返回数据
        shops_data = []
        for shop in shops:
            shops_data.append({
                "id": shop.id,
                "display_name": shop.shop_name_cn or shop.shop_name,
                "shop_name": shop.shop_name,
                "warehouses": warehouses_by_shop.get(shop.id, [])
            })

        return {
            "success": True,
            "data": {
                "shops": shops_data,
                "watermarks": watermarks
            }
        }

    except Exception as e:
        logger.error(f"Get quick publish config error: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/categories/search")
async def search_categories(
    path: str = Query(..., description="类目路径（如：'小百货和配饰 > 腕表'）"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    根据类目路径搜索类目ID

    用于从页面面包屑提取的类目路径转换为OZON category_id

    TODO: 需要实现类目缓存表和搜索逻辑
    """
    # 简化实现：返回建议用户手动查找类目ID
    return {
        "success": False,
        "message": "类目搜索功能开发中，请手动输入category_id",
        "hint": "可以在OZON卖家后台查看类目ID"
    }
