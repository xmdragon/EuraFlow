"""
商品采集记录管理路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, Any
from pydantic import BaseModel, Field

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from ..services.collection_record_service import CollectionRecordService

router = APIRouter(prefix="/collection-records", tags=["Collection Records"])


def problem(status: int, code: str, title: str, detail: str | None = None):
    """抛出 Problem Details 格式的错误"""
    raise HTTPException(status_code=status, detail={
        "type": "about:blank",
        "title": title,
        "status": status,
        "detail": detail,
        "code": code
    })


# ============================
# Pydantic Schema 定义
# ============================

class CollectRequest(BaseModel):
    """普通采集请求"""
    source_url: str = Field(..., description="商品来源URL")
    source_product_id: Optional[str] = Field(None, description="来源商品ID")
    product_data: dict[str, Any] = Field(..., description="完整商品数据")
    shop_id: Optional[int] = Field(None, description="店铺ID")


class FollowPdpRequest(BaseModel):
    """跟卖上架请求"""
    shop_id: int = Field(..., description="店铺ID")
    source_url: str = Field(..., description="商品来源URL")
    product_data: dict[str, Any] = Field(..., description="完整商品数据")
    variants: list[dict[str, Any]] = Field(..., description="变体列表")
    warehouse_id: int = Field(..., description="仓库ID")
    watermark_id: Optional[int] = Field(None, description="水印ID")


class UpdateRecordRequest(BaseModel):
    """更新采集记录请求"""
    product_data: dict[str, Any] = Field(..., description="更新的商品数据")


class RecordResponse(BaseModel):
    """采集记录响应"""
    id: int
    user_id: int
    shop_id: Optional[int]
    collection_type: str
    source_url: str
    source_product_id: Optional[str]
    product_data: dict[str, Any]
    listing_status: Optional[str]
    listing_task_id: Optional[str]
    listing_error_message: Optional[str]
    is_read: bool
    created_at: str
    updated_at: str


class RecordListResponse(BaseModel):
    """采集记录列表响应"""
    items: list[RecordResponse]
    total: int
    page: int
    page_size: int


# ============================
# API 端点
# ============================

@router.post("/collect")
async def collect_product(
    request: CollectRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """普通采集商品（不立即上架）

    前置校验：检查商品数据是否包含尺寸和重量
    """
    # 校验尺寸和重量（注意：dimensions 是嵌套对象）
    product_data = request.product_data
    dimensions = product_data.get('dimensions', {})
    required_fields = ['width', 'height', 'length', 'weight']
    missing_fields = [f for f in required_fields if not dimensions.get(f)]

    if missing_fields:
        problem(
            status=422,
            code="MISSING_DIMENSIONS",
            title="Validation Error",
            detail=f"尺寸和重量数据缺失：{', '.join(missing_fields)}"
        )

    # 创建采集记录
    record = await CollectionRecordService.create_collection_record(
        db=db,
        user_id=current_user.id,
        collection_type="collect_only",
        source_url=request.source_url,
        product_data=request.product_data,
        shop_id=request.shop_id,
        source_product_id=request.source_product_id
    )

    return {
        "ok": True,
        "data": {
            "record_id": record.id,
            "message": "商品已采集，请到系统采集记录中查看"
        }
    }


@router.post("/follow-pdp")
async def follow_pdp_listing(
    request: FollowPdpRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """跟卖上架（异步上架）

    业务逻辑：
    1. 创建采集记录（collection_type='follow_pdp', listing_status='pending'）
    2. 触发 Celery 异步任务执行上架
    3. 立即返回（不等待上架结果）
    4. 后台异步任务完成后更新状态
    """
    # 创建采集记录
    record = await CollectionRecordService.create_collection_record(
        db=db,
        user_id=current_user.id,
        collection_type="follow_pdp",
        source_url=request.source_url,
        product_data=request.product_data,
        shop_id=request.shop_id,
        source_product_id=request.product_data.get("product_id")
    )

    # 保存上架请求参数（用于异步任务）
    await CollectionRecordService.update_listing_status(
        db=db,
        record_id=record.id,
        listing_status="pending",
        listing_request_payload={
            "variants": request.variants,
            "warehouse_ids": request.warehouse_ids,
            "watermark_config_id": request.watermark_config_id,
            "images": request.images,
            "videos": request.videos,
            "description": request.description,
            "category_id": request.category_id,
            "brand": request.brand,
            "barcode": request.barcode,
            "dimensions": request.dimensions,
            "attributes": request.attributes,
        }
    )

    # 触发异步上架任务
    from ..tasks.collection_listing_tasks import process_follow_pdp_listing
    task = process_follow_pdp_listing.delay(record.id)

    # 保存 Celery task_id
    await CollectionRecordService.update_listing_status(
        db=db,
        record_id=record.id,
        listing_status="pending",
        listing_task_id=task.id
    )

    return {
        "ok": True,
        "data": {
            "record_id": record.id,
            "task_id": task.id,
            "message": "上架任务已提交，请稍后查看上架记录"
        }
    }


@router.get("")
async def get_records(
    collection_type: str,
    shop_id: Optional[int] = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """查询采集记录列表

    Args:
        collection_type: 采集类型（'follow_pdp' | 'collect_only'）
        shop_id: 店铺ID（可选）
        page: 页码
        page_size: 每页数量
    """
    records, total = await CollectionRecordService.get_records(
        db=db,
        user_id=current_user.id,
        collection_type=collection_type,
        shop_id=shop_id,
        page=page,
        page_size=page_size
    )

    # 转换为响应格式
    items = [
        {
            "id": r.id,
            "user_id": r.user_id,
            "shop_id": r.shop_id,
            "collection_type": r.collection_type,
            "source_url": r.source_url,
            "source_product_id": r.source_product_id,
            "product_data": r.product_data,
            "listing_status": r.listing_status,
            "listing_task_id": r.listing_task_id,
            "listing_error_message": r.listing_error_message,
            "is_read": r.is_read,
            "created_at": r.created_at.isoformat(),
            "updated_at": r.updated_at.isoformat()
        }
        for r in records
    ]

    return {
        "ok": True,
        "data": {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size
        }
    }


@router.get("/{record_id}")
async def get_record(
    record_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """查询单个采集记录"""
    record = await CollectionRecordService.get_record_by_id(
        db=db,
        record_id=record_id,
        user_id=current_user.id
    )

    if not record:
        problem(
            status=404,
            code="RECORD_NOT_FOUND",
            title="Record Not Found",
            detail=f"采集记录不存在: {record_id}"
        )

    return {
        "ok": True,
        "data": {
            "id": record.id,
            "user_id": record.user_id,
            "shop_id": record.shop_id,
            "collection_type": record.collection_type,
            "source_url": record.source_url,
            "source_product_id": record.source_product_id,
            "product_data": record.product_data,
            "listing_status": record.listing_status,
            "listing_task_id": record.listing_task_id,
            "listing_error_message": record.listing_error_message,
            "is_read": record.is_read,
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat()
        }
    }


@router.put("/{record_id}")
async def update_record(
    record_id: int,
    request: UpdateRecordRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """更新采集记录"""
    try:
        record = await CollectionRecordService.update_record(
            db=db,
            record_id=record_id,
            user_id=current_user.id,
            product_data=request.product_data
        )
    except ValueError as e:
        problem(
            status=404,
            code="RECORD_NOT_FOUND",
            title="Record Not Found",
            detail=str(e)
        )

    return {
        "ok": True,
        "data": {
            "record_id": record.id,
            "updated_at": record.updated_at.isoformat()
        }
    }


@router.post("/{record_id}/to-draft")
async def convert_to_draft(
    record_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """将采集记录转换为草稿数据"""
    record = await CollectionRecordService.get_record_by_id(
        db=db,
        record_id=record_id,
        user_id=current_user.id
    )

    if not record:
        problem(
            status=404,
            code="RECORD_NOT_FOUND",
            title="Record Not Found",
            detail=f"采集记录不存在: {record_id}"
        )

    draft_data = CollectionRecordService.convert_to_draft_data(record.product_data)

    return {
        "ok": True,
        "data": {
            "draft_data": draft_data
        }
    }


@router.delete("/{record_id}")
async def delete_record(
    record_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """删除采集记录（软删除）"""
    success = await CollectionRecordService.soft_delete(
        db=db,
        record_id=record_id,
        user_id=current_user.id
    )

    if not success:
        problem(
            status=404,
            code="RECORD_NOT_FOUND",
            title="Record Not Found",
            detail=f"采集记录不存在: {record_id}"
        )

    return {
        "ok": True,
        "data": {
            "message": "记录已删除"
        }
    }
