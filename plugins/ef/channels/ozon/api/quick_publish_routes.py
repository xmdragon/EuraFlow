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
from ..models.watermark import CloudinaryConfig, AliyunOssConfig
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
    """一键上架响应"""
    success: bool
    task_id: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None


class TaskStatusResponseDTO(BaseModel):
    """任务状态响应"""
    success: bool
    task_id: str
    status: str  # pending/processing/imported/failed
    items: Optional[List[Dict[str, Any]]] = None
    error: Optional[str] = None


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
        service = QuickPublishService()
        result = await service.quick_publish(db, dto, user.id)
        return result
    except Exception as e:
        logger.error(f"Quick publish API error: {e}", exc_info=True)
        return QuickPublishResponseDTO(
            success=False,
            error=str(e)
        )


@router.get("/task/{task_id}/status", response_model=TaskStatusResponseDTO)
async def get_task_status(
    task_id: str,
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    查询OZON导入任务状态

    前端需要轮询此接口（每5秒）直到状态为 imported 或 failed

    状态说明：
    - pending: 等待处理
    - processing: 处理中
    - imported: 导入成功
    - failed: 导入失败
    """
    try:
        service = QuickPublishService()
        status = await service.get_task_status(db, task_id, shop_id)
        return status
    except Exception as e:
        logger.error(f"Get task status error: {e}", exc_info=True)
        return TaskStatusResponseDTO(
            success=False,
            task_id=task_id,
            status="error",
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

        # 3. 获取水印配置（Cloudinary + Aliyun OSS）- 全局配置
        # 只返回激活且可用的图床，is_default标识当前激活的图床
        watermarks = []

        # Cloudinary配置（全局配置，不按用户分）
        cloudinary_result = await db.execute(
            select(CloudinaryConfig).where(CloudinaryConfig.is_active == True)
        )
        cloudinary_config = cloudinary_result.scalar_one_or_none()
        if cloudinary_config:
            watermarks.append({
                "id": f"cloudinary_{cloudinary_config.id}",
                "name": "Cloudinary",
                "type": "cloudinary",
                "is_default": cloudinary_config.is_default,
                "is_active": True  # 已通过查询条件确保
            })

        # Aliyun OSS配置（全局配置，单例模式）
        aliyun_result = await db.execute(
            select(AliyunOssConfig).where(AliyunOssConfig.enabled == True)
        )
        aliyun_config = aliyun_result.scalar_one_or_none()
        if aliyun_config:
            watermarks.append({
                "id": f"aliyun_{aliyun_config.id}",
                "name": "阿里云OSS",
                "type": "aliyun_oss",
                "is_default": aliyun_config.is_default,
                "is_active": True  # 已通过查询条件确保
            })

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
