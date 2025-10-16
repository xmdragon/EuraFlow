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
from ..models import OzonWarehouse
from sqlalchemy import select

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
