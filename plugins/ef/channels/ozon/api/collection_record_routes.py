"""
商品采集记录管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, Any
from pydantic import BaseModel, Field
from datetime import timedelta
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from ..services.collection_record_service import CollectionRecordService
from ..utils.datetime_utils import get_global_timezone, calculate_date_range

router = APIRouter(prefix="/collection-records", tags=["Collection Records"])
logger = logging.getLogger(__name__)


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
    variants: list[dict[str, Any]] = Field(..., description="变体列表")
    warehouse_id: int = Field(..., description="仓库ID")
    watermark_config_id: Optional[int] = Field(None, description="水印配置ID")
    images: Optional[list[dict[str, Any]]] = Field(None, description="图片列表")
    videos: Optional[list[str]] = Field(None, description="视频列表")
    description: Optional[str] = Field(None, description="商品描述")
    category_id: Optional[int] = Field(None, description="类目ID")
    brand: Optional[str] = Field(None, description="品牌")
    barcode: Optional[str] = Field(None, description="条形码")
    dimensions: Optional[dict[str, Any]] = Field(None, description="尺寸信息")
    attributes: Optional[list[dict[str, Any]]] = Field(None, description="类目特征")
    title: Optional[str] = Field(None, description="商品标题")
    # 采购信息（仅保存到本地，不提交OZON）
    purchase_url: Optional[str] = Field(None, description="采购地址")
    purchase_price: Optional[int] = Field(None, description="采购价（分）")
    purchase_note: Optional[str] = Field(None, description="采购备注")


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
    # 修复：允许值为 0 的字段，只检查是否存在（not None）
    missing_fields = [f for f in required_fields if dimensions.get(f) is None]

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
    # 从 variants 和其他字段构造 product_data（供前端展示用）
    # 转换 variants 数据：分→元（字段名保持与插件一致，使用 primary_image）
    variants_for_display = []
    for v in request.variants:
        price_fen = v.get("price", 0) or 0
        old_price_fen = v.get("old_price")
        variants_for_display.append({
            **v,
            "price": price_fen / 100 if price_fen else None,  # 分→元
            "old_price": old_price_fen / 100 if old_price_fen else None,
        })

    first_variant = variants_for_display[0] if variants_for_display else {}

    product_data_for_display = {
        "title": request.title or first_variant.get("name", ""),
        "images": request.images,
        "price": first_variant.get("price"),  # 用户设置的价格（元）
        "old_price": first_variant.get("old_price"),
        "description": request.description,
        "dimensions": request.dimensions,
        "brand": request.brand,
        "barcode": request.barcode,
        "variants": variants_for_display,  # 保存转换后的变体信息
    }

    # 创建采集记录
    record = await CollectionRecordService.create_collection_record(
        db=db,
        user_id=current_user.id,
        collection_type="follow_pdp",
        source_url=request.source_url,
        product_data=product_data_for_display,
        shop_id=request.shop_id,
        source_product_id=None
    )

    # 保存上架请求参数（用于异步任务）
    await CollectionRecordService.update_listing_status(
        db=db,
        record_id=record.id,
        listing_status="pending",
        listing_request_payload={
            "variants": request.variants,
            "warehouse_id": request.warehouse_id,
            "watermark_config_id": request.watermark_config_id,
            "images": request.images,
            "videos": request.videos,
            "description": request.description,
            "category_id": request.category_id,
            "brand": request.brand,
            "barcode": request.barcode,
            "dimensions": request.dimensions,
            "attributes": request.attributes,
            "title": request.title,  # 商品标题（用于翻译）
            # 采购信息（仅保存到本地，不提交OZON）
            "purchase_url": request.purchase_url,
            "purchase_price": request.purchase_price,
            "purchase_note": request.purchase_note,
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

    Note:
        管理员用户（role='admin' 或拥有 '*' 权限）可查看所有用户的记录
    """
    # 判断是否为管理员
    is_admin = current_user.role == "admin" or "*" in (current_user.permissions or [])

    records, total = await CollectionRecordService.get_records(
        db=db,
        user_id=current_user.id,
        collection_type=collection_type,
        shop_id=shop_id,
        page=page,
        page_size=page_size,
        is_admin=is_admin
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
            "listing_request_payload": r.listing_request_payload,
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


@router.get("/daily-stats")
async def get_listing_daily_stats(
    shop_id: int = Query(..., description="店铺ID"),
    range_type: Optional[str] = Query(
        None, description="时间范围类型：7days/14days/thisMonth/lastMonth/custom"
    ),
    start_date: Optional[str] = Query(
        None, description="开始日期 YYYY-MM-DD（仅 range_type=custom 时使用）"
    ),
    end_date: Optional[str] = Query(
        None, description="结束日期 YYYY-MM-DD（仅 range_type=custom 时使用）"
    ),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取每日上架统计数据（统计商品表，按商品在OZON创建的时间）

    Args:
        shop_id: 店铺ID（必填）
        range_type: 时间范围类型（后端根据用户时区计算日期）
        start_date: 开始日期（仅 custom 模式）
        end_date: 结束日期（仅 custom 模式）
        db: 数据库会话
        current_user: 当前用户

    Returns:
        每日上架数量统计
    """
    from ..models.products import OzonProduct
    from sqlalchemy import select, and_
    from zoneinfo import ZoneInfo

    # 获取全局时区设置
    global_timezone = await get_global_timezone(db)

    try:
        # 使用统一的日期范围计算函数（基于系统全局时区）
        start_datetime_utc, end_datetime_utc = calculate_date_range(
            range_type=range_type or '14days',
            timezone_name=global_timezone,
            custom_start=start_date,
            custom_end=end_date
        )

        # 后续代码需要使用时区对象和日期对象
        tz = ZoneInfo(global_timezone)
        start_date_obj = start_datetime_utc.astimezone(tz).date()
        end_date_obj = end_datetime_utc.astimezone(tz).date()

        # 构建查询条件（使用UTC时间戳范围）
        product_filter = [
            OzonProduct.shop_id == shop_id,
            OzonProduct.ozon_created_at.isnot(None),  # 必须有OZON创建时间
            OzonProduct.ozon_created_at >= start_datetime_utc,
            OzonProduct.ozon_created_at <= end_datetime_utc,
        ]

        # 查询商品数据（不在数据库层面按日期分组，而是查询完整时间戳）
        stats_result = await db.execute(
            select(OzonProduct.ozon_created_at)
            .where(and_(*product_filter))
            .order_by(OzonProduct.ozon_created_at)
        )
        stats_rows = stats_result.scalars().all()

        # 组织数据结构
        # 1. 按日期分组（在Python中转换时区后分组）
        daily_stats = {}
        for ozon_created_at in stats_rows:
            # 将UTC时间转换为全局时区
            created_at_tz = ozon_created_at.astimezone(tz)
            # 提取日期
            date_str = created_at_tz.date().isoformat()

            if date_str not in daily_stats:
                daily_stats[date_str] = 0
            daily_stats[date_str] += 1

        # 2. 生成完整的日期序列（填充缺失日期）
        all_dates = []
        current_date = start_date_obj
        while current_date <= end_date_obj:
            date_str = current_date.isoformat()
            all_dates.append(date_str)
            if date_str not in daily_stats:
                daily_stats[date_str] = 0
            current_date += timedelta(days=1)

        # 计算实际天数
        actual_days = (end_date_obj - start_date_obj).days + 1

        return {
            "ok": True,
            "data": {
                "dates": all_dates,
                "data": daily_stats,
                "total_days": actual_days
            }
        }

    except Exception as e:
        logger.error(f"Failed to get listing daily stats: {e}")
        raise HTTPException(status_code=500, detail=f"获取每日上架统计失败: {str(e)}")


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
            "listing_request_payload": record.listing_request_payload,
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


class MatchAttributesRequest(BaseModel):
    """匹配属性值请求"""
    category_id: int = Field(..., description="类目ID")
    attributes: list[dict[str, Any]] = Field(..., description="属性列表")


@router.post("/match-attributes")
async def match_attributes(
    request: MatchAttributesRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """匹配属性值到字典 value_id

    用于采集转草稿场景，用户选择类目后调用此接口匹配属性值。
    支持多值情况（用 ", " 分隔的多个值）。

    Args:
        category_id: 类目ID
        attributes: 采集的属性列表，格式: [{key, name, value}, ...]

    Returns:
        匹配后的属性列表，格式: [{attribute_id, values: [{dictionary_value_id, value}]}, ...]
    """
    from ..services.catalog_service import match_attribute_values

    matched_attributes = await match_attribute_values(
        db=db,
        category_id=request.category_id,
        attributes=request.attributes
    )

    return {
        "ok": True,
        "data": {
            "matched_attributes": matched_attributes,
            "input_count": len(request.attributes),
            "matched_count": len(matched_attributes)
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


class BatchDeleteRequest(BaseModel):
    """批量删除请求"""
    record_ids: list[int] = Field(..., description="记录ID列表")


class BatchDeleteResponse(BaseModel):
    """批量删除响应"""
    deleted_count: int
    failed_count: int
    failed_ids: list[int]


@router.post("/batch-delete")
async def batch_delete_records(
    request: BatchDeleteRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """批量删除采集记录（软删除）

    Args:
        request: 批量删除请求（包含记录ID列表）

    Returns:
        批量删除结果统计
    """
    deleted_count = 0
    failed_count = 0
    failed_ids = []

    for record_id in request.record_ids:
        try:
            success = await CollectionRecordService.soft_delete(
                db=db,
                record_id=record_id,
                user_id=current_user.id
            )

            if success:
                deleted_count += 1
            else:
                failed_count += 1
                failed_ids.append(record_id)

        except Exception as e:
            logger.error(f"Failed to delete record {record_id}: {e}")
            failed_count += 1
            failed_ids.append(record_id)

    return {
        "ok": True,
        "data": {
            "deleted_count": deleted_count,
            "failed_count": failed_count,
            "failed_ids": failed_ids
        }
    }
