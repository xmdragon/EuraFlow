"""
选品助手API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form, BackgroundTasks, Request
from typing import Optional, Dict, Any, List
from pathlib import Path
from datetime import datetime, timedelta
import tempfile
import shutil
import json
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
import logging
import httpx
from bs4 import BeautifulSoup
import re

from ef_core.database import get_async_session
from ef_core.api.auth import get_current_user, get_current_user_flexible
from ef_core.models.users import User
from ef_core.services.audit_service import AuditService
from ..services.product_selection_service import ProductSelectionService
from ..models.product_selection import ProductSelectionItem, ImportHistory
from ..services.sync_state_manager import get_sync_state_manager
from ..utils.datetime_utils import utcnow
from decimal import Decimal

router = APIRouter(prefix="/product-selection", tags=["Product Selection"])
logger = logging.getLogger(__name__)


# DTO 模型
class ProductSearchRequest(BaseModel):
    """商品搜索请求（使用游标分页）"""
    product_name: Optional[str] = Field(None, description="商品名称")
    brand: Optional[str] = None
    rfbs_low_max: Optional[float] = Field(None, description="rFBS(<=1500₽)最大佣金率")
    rfbs_mid_max: Optional[float] = Field(None, description="rFBS(1501-5000₽)最大佣金率")
    fbp_low_max: Optional[float] = Field(None, description="FBP(<=1500₽)最大佣金率")
    fbp_mid_max: Optional[float] = Field(None, description="FBP(1501-5000₽)最大佣金率")
    monthly_sales_min: Optional[int] = Field(None, description="最小月销量")
    monthly_sales_max: Optional[int] = Field(None, description="最大月销量")
    weight_max: Optional[int] = Field(None, description="最大包装重量(克)")
    competitor_count_min: Optional[int] = Field(None, description="最小跟卖者数量")
    competitor_count_max: Optional[int] = Field(None, description="最大跟卖者数量")
    competitor_min_price_min: Optional[float] = Field(None, description="最低跟卖价下限")
    competitor_min_price_max: Optional[float] = Field(None, description="最低跟卖价上限")
    listing_date_start: Optional[str] = Field(None, description="上架时间晚于（YYYY-MM-DD）")
    batch_id: Optional[int] = Field(None, description="批次ID")
    is_read: Optional[bool] = Field(None, description="是否已读（None=全部,True=已读,False=未读）")
    sort_by: Optional[str] = Field('created_asc', description="排序方式")
    after_id: Optional[int] = Field(0, ge=0, description="游标：上次最后一个商品的ID")
    limit: Optional[int] = Field(20, ge=1, le=100, description="每次加载数量")


class ImportResponse(BaseModel):
    """导入响应"""
    success: bool
    import_id: Optional[int] = None
    total_rows: Optional[int] = None
    success_rows: Optional[int] = None
    failed_rows: Optional[int] = None
    updated_rows: Optional[int] = None
    skipped_rows: Optional[int] = None
    competitor_update: Optional[Dict[str, Any]] = None  # 竞争对手数据更新信息
    duration: Optional[int] = None
    error: Optional[str] = None
    errors: Optional[List[Dict[str, Any]]] = None


class PreviewResponse(BaseModel):
    """预览响应"""
    success: bool
    total_rows: Optional[int] = None
    columns: Optional[List[str]] = None
    preview: Optional[List[Dict[str, Any]]] = None
    column_mapping: Optional[Dict[str, str]] = None
    error: Optional[str] = None
    missing_columns: Optional[List[str]] = None


class ProductUploadItem(BaseModel):
    """单个商品数据（从Tampermonkey脚本上传）"""
    product_id: str
    product_name_ru: Optional[str] = None
    product_name_cn: Optional[str] = None
    brand: Optional[str] = None
    current_price: Optional[float] = None
    original_price: Optional[float] = None
    ozon_link: Optional[str] = None
    image_url: Optional[str] = None
    category_link: Optional[str] = None
    rfbs_commission_low: Optional[float] = None
    rfbs_commission_mid: Optional[float] = None
    rfbs_commission_high: Optional[float] = None
    fbp_commission_low: Optional[float] = None
    fbp_commission_mid: Optional[float] = None
    fbp_commission_high: Optional[float] = None
    monthly_sales_volume: Optional[float] = None
    monthly_sales_revenue: Optional[float] = None
    daily_sales_volume: Optional[float] = None
    daily_sales_revenue: Optional[float] = None
    sales_dynamic_percent: Optional[float] = None
    conversion_rate: Optional[float] = None
    package_weight: Optional[int] = None
    package_volume: Optional[int] = None
    package_length: Optional[int] = None
    package_width: Optional[int] = None
    package_height: Optional[int] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    seller_type: Optional[str] = None
    delivery_days: Optional[int] = None
    availability_percent: Optional[float] = None
    ad_cost_share: Optional[float] = None
    competitor_count: Optional[int] = None
    competitor_min_price: Optional[float] = None

    # 营销分析字段（上品帮）
    card_views: Optional[int] = None
    card_add_to_cart_rate: Optional[float] = None
    search_views: Optional[int] = None
    search_add_to_cart_rate: Optional[float] = None
    click_through_rate: Optional[float] = None
    promo_days: Optional[int] = None
    promo_discount_percent: Optional[float] = None
    promo_conversion_rate: Optional[float] = None
    paid_promo_days: Optional[int] = None
    return_cancel_rate: Optional[float] = None

    # 基础字段（上品帮）
    category_path: Optional[str] = None
    category_level_1: Optional[str] = None
    category_level_2: Optional[str] = None
    avg_price: Optional[float] = None
    listing_date: Optional[str] = None
    listing_days: Optional[int] = None
    seller_mode: Optional[str] = None


class ProductsUploadRequest(BaseModel):
    """批量上传商品请求"""
    products: List[ProductUploadItem]
    batch_name: Optional[str] = Field(None, description="批次名称（用于自动采集，如不提供则自动生成）")
    source_id: Optional[int] = Field(None, description="关联的采集源ID（自动采集时使用）")


class ProductsUploadResponse(BaseModel):
    """批量上传响应"""
    success: bool
    total: int
    success_count: int
    failed_count: int
    errors: Optional[List[Dict[str, Any]]] = None


class MarkAsReadRequest(BaseModel):
    """标记为已读请求"""
    product_ids: List[int] = Field(..., description="商品ID列表")


class MarkAsReadResponse(BaseModel):
    """标记为已读响应"""
    success: bool
    marked_count: int = Field(..., description="成功标记的商品数量")
    message: Optional[str] = None


class BatchDeleteRequest(BaseModel):
    """批量删除批次请求"""
    batch_ids: List[int] = Field(..., description="批次ID列表", min_items=1)


class BatchDeleteResponse(BaseModel):
    """批量删除批次响应"""
    success: bool
    deleted_batches: int = Field(..., description="删除的批次数量")
    deleted_products: int = Field(..., description="删除的商品数量")
    message: str


# API 端点
@router.post("/import", response_model=ImportResponse)
async def import_products(
    request: Request,
    file: UploadFile = File(...),
    strategy: str = Form('update'),
    shop_id: int = Form(...),  # 必须明确指定店铺ID
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """
    导入商品数据文件

    Args:
        file: Excel或CSV文件
        strategy: 导入策略 (skip/update/append)
        shop_id: 店铺ID
    """
    # 检查文件类型
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    file_extension = file.filename.split('.')[-1].lower()
    if file_extension not in ['csv', 'xlsx', 'xls']:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {file_extension}. 仅支持 CSV 和 Excel 文件"
        )

    # 保存临时文件
    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=f'.{file_extension}'
    ) as tmp_file:
        try:
            # 复制上传文件内容到临时文件
            shutil.copyfileobj(file.file, tmp_file)
            tmp_file_path = Path(tmp_file.name)

            # 调用服务层导入
            service = ProductSelectionService()
            result = await service.import_file(
                db=db,
                file_path=tmp_file_path,
                file_type='csv' if file_extension == 'csv' else 'xlsx',
                import_strategy=strategy,
                user_id=current_user.id,
                validate_only=False
            )

            if result['success']:
                # 记录导入选品数据审计日志
                await AuditService.log_action(
                    db=db,
                    user_id=current_user.id,
                    username=current_user.username,
                    module="ozon",
                    action="create",
                    action_display="导入选品数据",
                    table_name="product_selection_items",
                    record_id=str(result.get('import_id', '')),
                    changes={
                        "file_name": {"new": file.filename},
                        "strategy": {"new": strategy},
                        "shop_id": {"new": shop_id},
                        "total_rows": {"new": result.get('total_rows', 0)},
                        "success_rows": {"new": result.get('success_rows', 0)},
                        "failed_rows": {"new": result.get('failed_rows', 0)},
                    },
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                    request_id=getattr(request.state, 'trace_id', None)
                )
                return ImportResponse(**result)
            else:
                raise HTTPException(status_code=400, detail=result.get('error', '导入失败'))

        finally:
            # 清理临时文件
            if tmp_file_path.exists():
                tmp_file_path.unlink()


@router.post("/preview", response_model=PreviewResponse)
async def preview_import(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """
    预览导入文件（不执行实际导入）

    Args:
        file: Excel或CSV文件
    """
    # 检查文件类型
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    file_extension = file.filename.split('.')[-1].lower()
    if file_extension not in ['csv', 'xlsx', 'xls']:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {file_extension}"
        )

    # 保存临时文件
    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=f'.{file_extension}'
    ) as tmp_file:
        try:
            shutil.copyfileobj(file.file, tmp_file)
            tmp_file_path = Path(tmp_file.name)

            # 调用服务层验证
            service = ProductSelectionService()
            result = await service.import_file(
                db=db,
                file_path=tmp_file_path,
                file_type='csv' if file_extension == 'csv' else 'xlsx',
                import_strategy='update',
                user_id=current_user.id,
                validate_only=True  # 仅验证
            )

            if result['success']:
                return PreviewResponse(**result)
            else:
                return PreviewResponse(
                    success=False,
                    error=result.get('error'),
                    missing_columns=result.get('missing_columns')
                )

        finally:
            # 清理临时文件
            if tmp_file_path.exists():
                tmp_file_path.unlink()


@router.post("/products/search")
async def search_products(
    request: ProductSearchRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """
    搜索商品

    Args:
        request: 搜索条件
    """
    service = ProductSelectionService()

    # 构建筛选条件
    filters = {
        k: v for k, v in request.dict().items()
        if v is not None and k not in ['sort_by', 'after_id', 'limit']
    }

    result = await service.search_products(
        db=db,
        user_id=current_user.id,
        filters=filters,
        sort_by=request.sort_by,
        after_id=request.after_id,
        limit=request.limit
    )

    return {
        'success': True,
        'data': result
    }


@router.get("/products")
async def get_products(
    product_name: Optional[str] = Query(None, description="商品名称"),
    brand: Optional[str] = Query(None, description="品牌"),
    rfbs_low_max: Optional[float] = Query(None, description="rFBS(<=1500₽)最大佣金率"),
    rfbs_mid_max: Optional[float] = Query(None, description="rFBS(1501-5000₽)最大佣金率"),
    fbp_low_max: Optional[float] = Query(None, description="FBP(<=1500₽)最大佣金率"),
    fbp_mid_max: Optional[float] = Query(None, description="FBP(1501-5000₽)最大佣金率"),
    monthly_sales_min: Optional[int] = Query(None, description="最小月销量"),
    monthly_sales_max: Optional[int] = Query(None, description="最大月销量"),
    weight_max: Optional[int] = Query(None, description="最大包装重量"),
    competitor_count_min: Optional[int] = Query(None, description="最小跟卖者数量"),
    competitor_count_max: Optional[int] = Query(None, description="最大跟卖者数量"),
    competitor_min_price_min: Optional[float] = Query(None, description="最低跟卖价下限"),
    competitor_min_price_max: Optional[float] = Query(None, description="最低跟卖价上限"),
    listing_date_start: Optional[str] = Query(None, description="上架时间晚于（YYYY-MM-DD）"),
    sort_by: str = Query('created_asc', description="排序方式"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取商品列表（GET方法，支持JWT Token或API Key认证）
    """
    service = ProductSelectionService()

    # 构建筛选条件
    filters = {}
    if product_name:
        filters['product_name'] = product_name
    if brand:
        filters['brand'] = brand
    if rfbs_low_max is not None:
        filters['rfbs_low_max'] = rfbs_low_max
    if rfbs_mid_max is not None:
        filters['rfbs_mid_max'] = rfbs_mid_max
    if fbp_low_max is not None:
        filters['fbp_low_max'] = fbp_low_max
    if fbp_mid_max is not None:
        filters['fbp_mid_max'] = fbp_mid_max
    if monthly_sales_min is not None:
        filters['monthly_sales_min'] = monthly_sales_min
    if monthly_sales_max is not None:
        filters['monthly_sales_max'] = monthly_sales_max
    if weight_max is not None:
        filters['weight_max'] = weight_max
    if competitor_count_min is not None:
        filters['competitor_count_min'] = competitor_count_min
    if competitor_count_max is not None:
        filters['competitor_count_max'] = competitor_count_max
    if competitor_min_price_min is not None:
        filters['competitor_min_price_min'] = competitor_min_price_min
    if competitor_min_price_max is not None:
        filters['competitor_min_price_max'] = competitor_min_price_max
    if listing_date_start:
        filters['listing_date_start'] = listing_date_start

    result = await service.search_products(
        db=db,
        user_id=current_user.id,
        filters=filters,
        sort_by=sort_by,
        page=page,
        page_size=page_size
    )

    return {
        'success': True,
        'data': result
    }


@router.get("/brands")
async def get_brands(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """获取品牌列表"""
    service = ProductSelectionService()
    brands = await service.get_brands(db, user_id=current_user.id)

    return {
        'success': True,
        'data': brands
    }


@router.get("/import-history")
async def get_import_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """获取导入历史"""
    service = ProductSelectionService()
    result = await service.get_import_history(
        db=db,
        user_id=current_user.id,
        page=page,
        page_size=page_size
    )

    return {
        'success': True,
        'data': result
    }


@router.post("/products/mark-as-read", response_model=MarkAsReadResponse)
async def mark_products_as_read(
    http_request: Request,
    mark_data: MarkAsReadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """
    批量标记商品为已读

    Args:
        mark_data: 包含商品ID列表的请求
    """
    try:
        from sqlalchemy import update

        # 更新商品为已读状态
        result = await db.execute(
            update(ProductSelectionItem)
            .where(
                ProductSelectionItem.id.in_(mark_data.product_ids),
                ProductSelectionItem.user_id == current_user.id
            )
            .values(
                is_read=True,
                read_at=utcnow()
            )
        )

        await db.commit()
        marked_count = result.rowcount

        logger.info(f"用户 {current_user.id} 标记了 {marked_count} 个商品为已读")

        # 记录标记已读审计日志
        await AuditService.log_action(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            module="ozon",
            action="update",
            action_display="标记选品已读",
            table_name="product_selection_items",
            record_id=",".join(str(pid) for pid in mark_data.product_ids[:10]),  # 最多记录前10个ID
            changes={
                "marked_count": {"new": marked_count},
                "product_ids_count": {"new": len(mark_data.product_ids)},
            },
            ip_address=http_request.client.host if http_request.client else None,
            user_agent=http_request.headers.get("user-agent"),
            request_id=getattr(http_request.state, 'trace_id', None)
        )

        return MarkAsReadResponse(
            success=True,
            marked_count=marked_count,
            message=f"成功标记 {marked_count} 个商品为已读"
        )

    except Exception as e:
        logger.error(f"标记商品为已读失败: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"标记失败: {str(e)}")


@router.delete("/batch/{batch_id}")
async def delete_batch(
    request: Request,
    batch_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """
    删除指定批次的数据

    Args:
        batch_id: 批次ID

    Returns:
        删除结果
    """
    try:
        service = ProductSelectionService()
        result = await service.delete_batch(
            db=db,
            batch_id=batch_id,
            user_id=current_user.id
        )

        if not result['success']:
            raise HTTPException(status_code=404, detail=result.get('error', '删除失败'))

        # 记录删除批次审计日志
        await AuditService.log_delete(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            module="ozon",
            table_name="product_selection_items",
            record_id=str(batch_id),
            deleted_data={
                "batch_id": batch_id,
                "deleted_products": result.get('deleted_products', 0),
            },
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_id=getattr(request.state, 'trace_id', None)
        )

        return {
            "success": True,
            "message": result.get('message', '批次删除完成'),
            "data": {
                "batch_id": result['batch_id'],
                "deleted_products": result['deleted_products']
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting batch {batch_id}: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batches/delete", response_model=BatchDeleteResponse)
async def delete_batches(
    http_request: Request,
    delete_data: BatchDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """
    批量删除多个批次的数据

    Args:
        delete_data: 包含批次ID列表的请求

    Returns:
        批量删除结果
    """
    try:
        service = ProductSelectionService()
        result = await service.delete_batches(
            db=db,
            batch_ids=delete_data.batch_ids,
            user_id=current_user.id
        )

        if not result['success']:
            raise HTTPException(status_code=400, detail=result.get('error', '批量删除失败'))

        # 记录批量删除批次审计日志
        await AuditService.log_delete(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            module="ozon",
            table_name="product_selection_items",
            record_id=",".join(str(bid) for bid in delete_data.batch_ids[:10]),
            deleted_data={
                "batch_ids": delete_data.batch_ids,
                "deleted_batches": result.get('deleted_batches', 0),
                "deleted_products": result.get('deleted_products', 0),
            },
            ip_address=http_request.client.host if http_request.client else None,
            user_agent=http_request.headers.get("user-agent"),
            request_id=getattr(http_request.state, 'trace_id', None)
        )

        return BatchDeleteResponse(
            success=True,
            deleted_batches=result['deleted_batches'],
            deleted_products=result['deleted_products'],
            message=result['message']
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting batches {delete_data.batch_ids}: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"批量删除失败: {str(e)}")


@router.post("/clear-all-data")
async def clear_all_data(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """
    清空当前用户的所有选品数据
    """
    try:
        service = ProductSelectionService()
        result = await service.clear_user_data(db, user_id=current_user.id)

        # 记录清空选品数据审计日志（危险操作）
        await AuditService.log_delete(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            module="ozon",
            table_name="product_selection_items",
            record_id="ALL",
            deleted_data={
                "action": "clear_all_data",
                "deleted_count": result.get('deleted_count', 0),
            },
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_id=getattr(request.state, 'trace_id', None),
            notes="危险操作：清空所有选品数据"
        )

        return {
            "success": True,
            "message": result.get('message', '数据清空完成'),
            "data": result
        }
    except Exception as e:
        logger.error(f"Error clearing user data: {e}")
        await db.rollback()
        return {"success": False, "error": str(e)}


@router.post("/clear-all-competitor-data")
async def clear_all_competitor_data(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """
    清除所有产品的竞争者数据
    """
    try:
        from sqlalchemy import update, func

        # 获取受影响的记录数
        count_result = await db.execute(
            select(func.count()).select_from(ProductSelectionItem).where(
                ProductSelectionItem.competitor_count.isnot(None)
            )
        )
        affected_count = count_result.scalar() or 0

        await db.execute(
            update(ProductSelectionItem)
            .values(
                competitor_count=None,
                competitor_min_price=None,
                market_min_price=None,
                price_index=None
            )
        )
        await db.commit()

        # 记录清空竞品数据审计日志（危险操作）
        await AuditService.log_delete(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            module="ozon",
            table_name="product_selection_items",
            record_id="ALL_COMPETITOR",
            deleted_data={
                "action": "clear_all_competitor_data",
                "affected_count": affected_count,
            },
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_id=getattr(request.state, 'trace_id', None),
            notes="危险操作：清空所有竞品数据"
        )

        return {
            "success": True,
            "message": "All competitor data has been cleared"
        }
    except Exception as e:
        logger.error(f"Error clearing competitor data: {e}")
        await db.rollback()
        return {"success": False, "error": str(e)}


@router.post("/browser-extension/competitor-data")
async def receive_browser_extension_data(
    data: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
):
    """
    接收浏览器扩展发送的竞争者数据

    Args:
        data: 包含 product_id, competitor_count, competitor_min_price, sellers 的数据
        db: 数据库会话

    Returns:
        操作结果
    """
    try:
        product_id = data.get("product_id")
        if not product_id:
            return {"success": False, "error": "Missing product_id"}

        # 更新数据库中的竞争者数据
        from sqlalchemy import update
        from decimal import Decimal

        update_data = {}

        if "competitor_count" in data:
            update_data["competitor_count"] = data["competitor_count"]

        if "competitor_min_price" in data and data["competitor_min_price"]:
            update_data["competitor_min_price"] = Decimal(str(data["competitor_min_price"]))

        if update_data:
            await db.execute(
                update(ProductSelectionItem)
                .where(ProductSelectionItem.product_id == product_id)
                .values(**update_data)
            )
            await db.commit()

            logger.info(f"Updated competitor data for product {product_id} from browser extension")

            return {
                "success": True,
                "message": f"Updated competitor data for product {product_id}",
                "data": {
                    "product_id": product_id,
                    "competitor_count": data.get("competitor_count"),
                    "competitor_min_price": data.get("competitor_min_price")
                }
            }

        return {"success": False, "error": "No data to update"}

    except Exception as e:
        logger.error(f"Error receiving browser extension data: {e}")
        return {"success": False, "error": str(e)}


@router.get("/sync-status")
async def get_sync_status(
    shop_id: int = Query(..., description="店铺ID")
):
    """
    获取数据同步状态
    """
    sync_manager = get_sync_state_manager()
    status = await sync_manager.get_sync_status(shop_id)

    return {
        'success': True,
        'data': status
    }


@router.get("/product/{product_id}/detail")
async def get_product_detail(
    product_id: str,
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取商品详细信息（包括所有图片）
    """
    from ..api.client import OzonAPIClient
    from ..models.ozon_shops import OzonShop
    from sqlalchemy import select

    try:
        # 获取默认店铺（这里简化处理，实际应该从用户上下文获取）
        shop_query = select(OzonShop).where(OzonShop.id == 1)
        result = await db.execute(shop_query)
        shop = result.scalar_one_or_none()

        if not shop:
            raise HTTPException(status_code=404, detail="店铺不存在")

        # 创建API客户端
        api_client = OzonAPIClient(shop.client_id, shop.api_key_enc)

        # 首先从数据库获取商品信息，看是否存在对应的offer_id
        from sqlalchemy import select
        stmt = select(ProductSelectionItem).where(ProductSelectionItem.product_id == product_id)
        result = await db.execute(stmt)
        db_product = result.scalar_one_or_none()

        if not db_product:
            raise HTTPException(status_code=404, detail="商品在选品数据库中不存在")

        # 获取商品详细信息 - 优先使用数据库中的信息构造基本响应
        # 在生产环境中，可以尝试调用Ozon API获取更多详情
        product_info = None
        try:
            # 尝试多种方式获取商品信息
            # 1. 先尝试使用product_id作为整数ID
            if product_id.isdigit():
                try:
                    logger.info(f"[DEBUG] 尝试使用product_id获取商品信息: {product_id}")
                    product_info = await api_client.get_product_info_list(product_ids=[int(product_id)])
                    import json
                    logger.info(f"[DEBUG] API响应: {json.dumps(product_info, ensure_ascii=False, indent=2) if product_info else 'None'}")
                    if product_info and product_info.get('result') and product_info['result'].get('items'):
                        logger.info(f"成功通过product_id获取商品信息: {product_id}")
                        logger.info(f"[DEBUG] items数量: {len(product_info['result']['items'])}")
                except Exception as e:
                    logger.error(f"无法通过product_id获取: {e}", exc_info=True)

            # 2. 如果失败，尝试使用product_id作为offer_id
            if not product_info or not product_info.get('result', {}).get('items'):
                try:
                    logger.info(f"[DEBUG] 尝试使用offer_id获取商品信息: {product_id}")
                    product_info = await api_client.get_product_info_list(offer_ids=[product_id])
                    import json
                    logger.info(f"[DEBUG] API响应: {json.dumps(product_info, ensure_ascii=False, indent=2) if product_info else 'None'}")
                    if product_info and product_info.get('result') and product_info['result'].get('items'):
                        logger.info(f"成功通过offer_id获取商品信息: {product_id}")
                except Exception as e:
                    logger.error(f"无法通过offer_id获取: {e}", exc_info=True)

            # 3. 尝试使用v2 API的get_product_info方法
            if not product_info or not product_info.get('result', {}).get('items'):
                try:
                    logger.info(f"[DEBUG] 尝试使用v2 API的product_id获取商品信息: {product_id}")
                    v2_info = await api_client.get_product_info(product_id=int(product_id))
                    import json
                    logger.info(f"[DEBUG] v2 API响应: {json.dumps(v2_info, ensure_ascii=False, indent=2) if v2_info else 'None'}")
                    if v2_info and 'result' in v2_info:
                        # 转换v2格式到v3格式
                        product_info = {
                            'result': {
                                'items': [v2_info['result']] if v2_info['result'] else []
                            }
                        }
                        logger.info(f"成功通过v2 API获取商品信息: {product_id}")
                except Exception as e:
                    logger.error(f"无法通过v2 API获取: {e}", exc_info=True)

                # 4. 如果仍然失败，尝试使用offer_id
                if not product_info or not product_info.get('result', {}).get('items'):
                    try:
                        logger.info(f"[DEBUG] 尝试使用v2 API的offer_id获取商品信息: {product_id}")
                        v2_info = await api_client.get_product_info(offer_id=product_id)
                        import json
                        logger.info(f"[DEBUG] v2 API (offer_id)响应: {json.dumps(v2_info, ensure_ascii=False, indent=2) if v2_info else 'None'}")
                        if v2_info and 'result' in v2_info:
                            # 转换v2格式到v3格式
                            product_info = {
                                'result': {
                                    'items': [v2_info['result']] if v2_info['result'] else []
                                }
                            }
                            logger.info(f"成功通过v2 API (offer_id)获取商品信息: {product_id}")
                    except Exception as e:
                        logger.error(f"无法通过v2 API (offer_id)获取: {e}", exc_info=True)

            # 3. 如果仍然失败，尝试使用SKU
            if not product_info or not product_info.get('result', {}).get('items'):
                if product_id.isdigit():
                    try:
                        logger.info(f"[DEBUG] 尝试使用SKU获取商品信息: {product_id}")
                        product_info = await api_client.get_product_info_list(skus=[int(product_id)])
                        import json
                        logger.info(f"[DEBUG] API响应: {json.dumps(product_info, ensure_ascii=False, indent=2) if product_info else 'None'}")
                        if product_info and product_info.get('result') and product_info['result'].get('items'):
                            logger.info(f"成功通过SKU获取商品信息: {product_id}")
                    except Exception as e:
                        logger.error(f"无法通过SKU获取: {e}", exc_info=True)

        except Exception as e:
            logger.warning(f"无法从Ozon API获取商品详情: {e}")
            # 如果API调用失败，使用数据库中的信息
            product_info = None


        # 处理商品详情信息
        images = []
        processed_files = set()  # 用于去重

        if product_info and product_info.get('result') and product_info['result'].get('items'):
            # 从API获取的数据
            product_detail = product_info['result']['items'][0]

            # 记录完整响应用于调试
            logger.info(f"商品详情响应字段: {list(product_detail.keys())}")

            # 构建图片URL的辅助函数
            def build_image_urls(file_name: str, is_primary: bool = False) -> list:
                """为文件名构建多个可能的CDN URL"""
                urls = []
                if not file_name:
                    return urls

                if file_name.startswith('http'):
                    return [file_name]

                # OZON使用多个CDN域名和路径模式
                cdn_patterns = [
                    'https://cdn1.ozone.ru/s3/multimedia-{}/{}',
                    'https://cdn1.ozon.ru/multimedia/{}/{}',
                    'https://cdn1.ozone.ru/s3/multimedia/{}',
                    'https://cdn1.ozon.ru/multimedia/{}',
                    'https://ir.ozone.ru/s3/multimedia-{}/{}',
                    'https://ir.ozone.ru/multimedia/{}/{}',
                ]

                # 尝试不同的子路径
                sub_paths = ['1', 'c', 'a', 'b', '2', '3', '4', '5', '6', '7', '8', '9', '0']

                for pattern in cdn_patterns:
                    if '{}/' in pattern:  # 需要子路径的模式
                        for sub in sub_paths:
                            urls.append(pattern.format(sub, file_name))
                            if is_primary:  # 主图只生成几个URL
                                break
                    else:  # 不需要子路径的模式
                        urls.append(pattern.format(file_name))

                return urls[:3] if is_primary else urls[:1]  # 主图返回多个URL尝试，其他图片返回一个

            # 1. 处理primary_image（主图）
            if product_detail.get('primary_image'):
                primary_img = product_detail['primary_image']
                if primary_img and primary_img not in processed_files:
                    urls = build_image_urls(primary_img, is_primary=True)
                    for url in urls:
                        images.append({
                            'url': url,
                            'file_name': primary_img.split('/')[-1] if '/' in primary_img else primary_img,
                            'default': True
                        })
                    processed_files.add(primary_img)

            # 2. 处理images数组（所有图片）
            if product_detail.get('images'):
                logger.info(f"找到images字段，包含 {len(product_detail['images'])} 个图片")
                for idx, img in enumerate(product_detail['images']):
                    file_name = None
                    is_default = False

                    if isinstance(img, dict):
                        file_name = img.get('file_name') or img.get('url') or img.get('image')
                        is_default = img.get('default', False) or img.get('is_primary', False)
                    elif isinstance(img, str):
                        file_name = img
                        is_default = idx == 0

                    if file_name and file_name not in processed_files:
                        urls = build_image_urls(file_name)
                        for url in urls:
                            images.append({
                                'url': url,
                                'file_name': file_name.split('/')[-1] if '/' in file_name else file_name,
                                'default': is_default
                            })
                        processed_files.add(file_name)

            # 3. 处理media字段（可能包含额外的图片）
            if product_detail.get('media'):
                logger.info(f"找到media字段")
                if isinstance(product_detail['media'], list):
                    for media_item in product_detail['media']:
                        if isinstance(media_item, dict):
                            file_name = media_item.get('file') or media_item.get('url') or media_item.get('file_name')
                            if file_name and file_name not in processed_files:
                                urls = build_image_urls(file_name)
                                for url in urls:
                                    images.append({
                                        'url': url,
                                        'file_name': file_name.split('/')[-1] if '/' in file_name else file_name,
                                        'default': False
                                    })
                                processed_files.add(file_name)

            # 4. 处理photos字段（某些API版本返回）
            if product_detail.get('photos'):
                logger.info(f"找到photos字段")
                if isinstance(product_detail['photos'], list):
                    for photo in product_detail['photos']:
                        file_name = None
                        if isinstance(photo, dict):
                            file_name = photo.get('url') or photo.get('file_name')
                        elif isinstance(photo, str):
                            file_name = photo

                        if file_name and file_name not in processed_files:
                            urls = build_image_urls(file_name)
                            for url in urls:
                                images.append({
                                    'url': url,
                                    'file_name': file_name.split('/')[-1] if '/' in file_name else file_name,
                                    'default': False
                                })
                            processed_files.add(file_name)

            # 5. 处理color_image字段（颜色图片）
            if product_detail.get('color_image'):
                color_img = product_detail['color_image']
                if color_img and color_img not in processed_files:
                    urls = build_image_urls(color_img)
                    for url in urls:
                        images.append({
                            'url': url,
                            'file_name': color_img.split('/')[-1] if '/' in color_img else color_img,
                            'default': False
                        })
                    processed_files.add(color_img)

            logger.info(f"商品 {product_id} 共找到 {len(images)} 个图片URL")

            # 如果成功获取到图片，更新数据库缓存
            if images:
                try:
                    import json
                    from datetime import datetime
                    db_product.images_data = images
                    db_product.images_updated_at = utcnow()
                    await db.commit()
                    logger.info(f"已更新商品 {product_id} 的图片缓存")
                except Exception as e:
                    logger.warning(f"更新图片缓存失败: {e}")
                    await db.rollback()

        # 如果API没有返回图片，尝试使用缓存的图片数据
        if not images and db_product.images_data:
            try:
                import json
                images_data = json.loads(db_product.images_data) if isinstance(db_product.images_data, str) else db_product.images_data
                if isinstance(images_data, list):
                    for img_data in images_data:
                        if isinstance(img_data, dict) and img_data.get('url'):
                            images.append({
                                'url': img_data['url'],
                                'file_name': img_data.get('file_name', 'image.jpg'),
                                'default': img_data.get('default', False)
                            })
                    logger.info(f"使用缓存的图片数据，共 {len(images)} 个图片")
            except Exception as e:
                logger.warning(f"解析images_data失败: {e}")

        # 如果仍然没有图片，使用单个图片URL
        if not images and db_product.image_url:
            images.append({
                'url': db_product.image_url,
                'file_name': 'main_image.jpg',
                'default': True
            })

        return {
            'success': True,
            'data': {
                'product_id': int(product_id),
                'offer_id': product_id,
                'name': db_product.product_name_cn or db_product.product_name_ru,
                'description': f"品牌: {db_product.brand or 'N/A'}",
                'images': images,
                'brand': db_product.brand,
                'category_id': 0,
                'barcode': '',
                'price': str(db_product.current_price) if db_product.current_price else '0',
                'old_price': str(db_product.original_price) if db_product.original_price else '',
                'status': 'active'
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取商品详细信息失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取商品详细信息失败")


@router.post("/upload", response_model=ProductsUploadResponse)
async def upload_products(
    http_request: Request,
    upload_data: ProductsUploadRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    批量上传商品数据（JWT Token认证）

    **认证方式**：在Header中传递 `Authorization: Bearer <token>`

    **速率限制**：每分钟最多10次请求，单次最多1000条商品

    **权限要求**：product_selection:write
    """

    # 检查数据量
    if len(upload_data.products) > 1000:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "PAYLOAD_TOO_LARGE",
                "message": "单次上传最多支持1000条商品"
            }
        )

    if len(upload_data.products) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "EMPTY_PAYLOAD",
                "message": "商品列表不能为空"
            }
        )

    try:
        import time
        start_time = time.time()

        service = ProductSelectionService()
        success_count = 0
        failed_count = 0
        errors = []

        # 转换数据格式并批量处理
        batch_items = []
        for idx, product in enumerate(upload_data.products):
            try:
                # 转换为内部数据格式
                cleaned_data = {
                    'user_id': current_user.id,
                    'product_id': product.product_id,
                    'product_name_ru': product.product_name_ru,
                    'product_name_cn': product.product_name_cn,
                    'brand': product.brand or 'без бренда',
                    'brand_normalized': service.normalize_brand(product.brand) if product.brand else 'NO_BRAND',
                    'ozon_link': product.ozon_link,
                    'image_url': product.image_url,
                    'category_link': product.category_link,
                }

                # 价格字段（转换为Decimal）
                if product.current_price is not None:
                    cleaned_data['current_price'] = Decimal(str(product.current_price))
                if product.original_price is not None:
                    cleaned_data['original_price'] = Decimal(str(product.original_price))

                # 佣金字段
                if product.rfbs_commission_low is not None:
                    cleaned_data['rfbs_commission_low'] = Decimal(str(product.rfbs_commission_low))
                if product.rfbs_commission_mid is not None:
                    cleaned_data['rfbs_commission_mid'] = Decimal(str(product.rfbs_commission_mid))
                if product.rfbs_commission_high is not None:
                    cleaned_data['rfbs_commission_high'] = Decimal(str(product.rfbs_commission_high))
                if product.fbp_commission_low is not None:
                    cleaned_data['fbp_commission_low'] = Decimal(str(product.fbp_commission_low))
                if product.fbp_commission_mid is not None:
                    cleaned_data['fbp_commission_mid'] = Decimal(str(product.fbp_commission_mid))
                if product.fbp_commission_high is not None:
                    cleaned_data['fbp_commission_high'] = Decimal(str(product.fbp_commission_high))

                # 销量和销售额
                if product.monthly_sales_volume is not None:
                    cleaned_data['monthly_sales_volume'] = int(product.monthly_sales_volume)  # 数据库是Integer
                if product.monthly_sales_revenue is not None:
                    cleaned_data['monthly_sales_revenue'] = Decimal(str(product.monthly_sales_revenue))
                if product.daily_sales_volume is not None:
                    cleaned_data['daily_sales_volume'] = Decimal(str(product.daily_sales_volume))  # 数据库是Numeric
                if product.daily_sales_revenue is not None:
                    cleaned_data['daily_sales_revenue'] = Decimal(str(product.daily_sales_revenue))

                # 百分比字段
                if product.sales_dynamic_percent is not None:
                    cleaned_data['sales_dynamic_percent'] = Decimal(str(product.sales_dynamic_percent))
                if product.conversion_rate is not None:
                    cleaned_data['conversion_rate'] = Decimal(str(product.conversion_rate))
                if product.availability_percent is not None:
                    cleaned_data['availability_percent'] = Decimal(str(product.availability_percent))
                if product.ad_cost_share is not None:
                    cleaned_data['ad_cost_share'] = Decimal(str(product.ad_cost_share))
                if product.rating is not None:
                    cleaned_data['rating'] = Decimal(str(product.rating))

                # 包装信息
                if product.package_weight is not None:
                    cleaned_data['package_weight'] = product.package_weight
                if product.package_volume is not None:
                    cleaned_data['package_volume'] = product.package_volume
                if product.package_length is not None:
                    cleaned_data['package_length'] = product.package_length
                if product.package_width is not None:
                    cleaned_data['package_width'] = product.package_width
                if product.package_height is not None:
                    cleaned_data['package_height'] = product.package_height

                # 其他字段
                if product.review_count is not None:
                    cleaned_data['review_count'] = product.review_count
                if product.delivery_days is not None:
                    cleaned_data['delivery_days'] = product.delivery_days
                if product.seller_type:
                    cleaned_data['seller_type'] = product.seller_type

                # 竞争者数据
                if product.competitor_count is not None:
                    cleaned_data['competitor_count'] = product.competitor_count
                if product.competitor_min_price is not None:
                    cleaned_data['competitor_min_price'] = Decimal(str(product.competitor_min_price))

                # 日期字段 - 使用 listing_date (已替换废弃的 product_created_date)
                if product.listing_date:
                    try:
                        import pandas as pd
                        parsed = pd.to_datetime(product.listing_date, errors='coerce')
                        if not pd.isna(parsed):
                            cleaned_data['listing_date'] = parsed.to_pydatetime()
                    except:
                        pass

                # 营销分析字段（上品帮新增）
                if product.card_views is not None:
                    cleaned_data['card_views'] = product.card_views
                if product.card_add_to_cart_rate is not None:
                    cleaned_data['card_add_to_cart_rate'] = Decimal(str(product.card_add_to_cart_rate))
                if product.search_views is not None:
                    cleaned_data['search_views'] = product.search_views
                if product.search_add_to_cart_rate is not None:
                    cleaned_data['search_add_to_cart_rate'] = Decimal(str(product.search_add_to_cart_rate))
                if product.click_through_rate is not None:
                    cleaned_data['click_through_rate'] = Decimal(str(product.click_through_rate))
                if product.promo_days is not None:
                    cleaned_data['promo_days'] = product.promo_days
                if product.promo_discount_percent is not None:
                    cleaned_data['promo_discount_percent'] = Decimal(str(product.promo_discount_percent))
                if product.promo_conversion_rate is not None:
                    cleaned_data['promo_conversion_rate'] = Decimal(str(product.promo_conversion_rate))
                if product.paid_promo_days is not None:
                    cleaned_data['paid_promo_days'] = product.paid_promo_days
                if product.return_cancel_rate is not None:
                    cleaned_data['return_cancel_rate'] = Decimal(str(product.return_cancel_rate))

                # 基础字段（上品帮新增）
                if product.category_path:
                    cleaned_data['category_path'] = product.category_path
                    # 自动拆分一级和二级类目（格式：一级 > 二级）
                    if ('非热销' not in product.category_path and
                        '无数据' not in product.category_path and
                        '>' in product.category_path):
                        parts = [p.strip() for p in product.category_path.split('>')]
                        if len(parts) >= 1:
                            cleaned_data['category_level_1'] = parts[0]
                        if len(parts) >= 2:
                            cleaned_data['category_level_2'] = parts[1]
                if product.avg_price is not None:
                    cleaned_data['avg_price'] = Decimal(str(product.avg_price))
                if product.seller_mode:
                    cleaned_data['seller_mode'] = product.seller_mode
                if product.listing_date:
                    try:
                        import pandas as pd
                        parsed = pd.to_datetime(product.listing_date, errors='coerce')
                        if not pd.isna(parsed):
                            cleaned_data['listing_date'] = parsed.to_pydatetime()
                    except:
                        pass
                if product.listing_days is not None:
                    cleaned_data['listing_days'] = product.listing_days

                batch_items.append(cleaned_data)

            except Exception as e:
                failed_count += 1
                errors.append({
                    'index': idx,
                    'product_id': product.product_id,
                    'error': str(e)
                })
                logger.warning(f"转换商品数据失败: product_id={product.product_id}, error={e}")

        # 批量插入/更新
        if batch_items:
            result = await service._batch_upsert(
                db=db,
                items=batch_items,
                strategy='update',  # 默认更新策略
                user_id=current_user.id
            )
            success_count += result['success'] + result['updated']
            failed_count += result['skipped']

            # 创建导入历史记录
            process_duration = int(time.time() - start_time)
            import_time_str = datetime.now().strftime('%Y%m%d_%H%M%S')

            # 使用自定义批次名或默认名称
            if upload_data.batch_name:
                file_name = f"自动采集 - {upload_data.batch_name}"
            else:
                file_name = f"浏览器插件导入 - {import_time_str}"

            import_history = ImportHistory(
                file_name=file_name,
                file_type="api",
                file_size=0,
                imported_by=current_user.id,
                import_strategy="update",
                total_rows=len(upload_data.products),
                success_rows=result['success'],
                failed_rows=failed_count,
                updated_rows=result['updated'],
                skipped_rows=result['skipped'],
                process_duration=process_duration,
                import_log={
                    "source": "browser_extension",
                    "current_user_id": current_user.id,
                    "batch_name": upload_data.batch_name,
                    "source_id": upload_data.source_id
                },
                error_details=errors[:100] if errors else []
            )

            db.add(import_history)
            await db.flush()  # 获取 import_history.id

            # 更新商品的 batch_id（关联到导入批次）
            from sqlalchemy import update
            if result['success'] > 0 or result['updated'] > 0:
                # 获取刚刚插入/更新的商品ID列表
                product_ids_to_update = [item['product_id'] for item in batch_items]
                await db.execute(
                    update(ProductSelectionItem)
                    .where(
                        ProductSelectionItem.user_id == current_user.id,
                        ProductSelectionItem.product_id.in_(product_ids_to_update)
                    )
                    .values(batch_id=import_history.id)
                )

            # 提交事务
            await db.commit()

        logger.info(
            f"API Key批量上传完成: user_id={current_user.id}, "
            f"total={len(upload_data.products)}, success={success_count}, failed={failed_count}"
        )

        # 记录API上传选品数据审计日志
        await AuditService.log_action(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            module="ozon",
            action="create",
            action_display="API上传选品数据",
            table_name="product_selection_items",
            record_id=str(import_history.id) if batch_items else "",
            changes={
                "source": {"new": "browser_extension"},
                "batch_name": {"new": upload_data.batch_name or "浏览器插件导入"},
                "total_products": {"new": len(upload_data.products)},
                "success_count": {"new": success_count},
                "failed_count": {"new": failed_count},
            },
            ip_address=http_request.client.host if http_request.client else None,
            user_agent=http_request.headers.get("user-agent"),
            request_id=getattr(http_request.state, 'trace_id', None)
        )

        return ProductsUploadResponse(
            success=True,
            total=len(upload_data.products),
            success_count=success_count,
            failed_count=failed_count,
            errors=errors[:10] if errors else None  # 只返回前10个错误
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"批量上传失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "UPLOAD_ERROR",
                "message": f"上传失败: {str(e)}"
            }
        )


# DTO 模型 - 标签反查
class TagLookupRequest(BaseModel):
    """标签反查请求"""
    sku: str = Field(..., description="商品 SKU")


class ProductInfoResponse(BaseModel):
    """商品信息响应"""
    sku: str
    name: str
    image_url: Optional[str] = None
    link: str
    card_price: Optional[str] = None
    price: Optional[str] = None
    original_price: Optional[str] = None
    seller_name: Optional[str] = None


class ProductTagResponse(BaseModel):
    """商品标签响应"""
    text: str
    link: str


class TagLookupResponse(BaseModel):
    """标签反查响应"""
    product: ProductInfoResponse
    tags: List[ProductTagResponse]
    warning: Optional[str] = None


@router.post("/tag-lookup")
async def tag_lookup(
    request: TagLookupRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """
    标签反查接口

    根据商品 SKU 获取 OZON 商品页面的标签信息

    需要用户已同步 OZON Cookie（通过浏览器扩展）
    """
    from ..services.ozon_buyer_client import (
        fetch_product_with_tags,
        CookieExpiredError,
        ProductNotFoundError,
        AntibotDetectedError,
        OzonBuyerClientError,
    )

    # 检查用户是否有 OZON Session
    if not current_user.ozon_session_enc:
        return {
            "ok": False,
            "error": "请先使用浏览器扩展同步 OZON Cookie"
        }

    # 解析 Session 数据
    try:
        session_data = json.loads(current_user.ozon_session_enc)
    except json.JSONDecodeError:
        return {
            "ok": False,
            "error": "OZON Cookie 数据格式错误，请重新同步"
        }

    # 验证 Cookie 是否有效
    cookies = session_data.get('cookies', [])
    if not cookies:
        return {
            "ok": False,
            "error": "OZON Cookie 为空，请重新同步"
        }

    try:
        # 调用标签反查服务
        result = await fetch_product_with_tags(request.sku, session_data)

        # 构建响应
        return {
            "ok": True,
            "data": {
                "product": {
                    "sku": result.product.sku,
                    "name": result.product.name,
                    "image_url": result.product.image_url,
                    "link": result.product.link,
                    "card_price": result.product.card_price,
                    "price": result.product.price,
                    "original_price": result.product.original_price,
                    "seller_name": result.product.seller_name,
                    "seller_link": result.product.seller_link,
                },
                "tags": [
                    {"text": tag.text, "link": tag.link}
                    for tag in result.tags
                ],
                "warning": result.warning,
            }
        }

    except CookieExpiredError as e:
        logger.warning(f"标签反查 Cookie 过期: user_id={current_user.id}, error={e}")
        return {
            "ok": False,
            "error": "OZON Cookie 已过期，请使用浏览器扩展重新同步"
        }
    except ProductNotFoundError:
        return {
            "ok": False,
            "error": "商品不存在"
        }
    except AntibotDetectedError:
        logger.warning(f"标签反查触发反爬虫: user_id={current_user.id}")
        return {
            "ok": False,
            "error": "请求被 OZON 拒绝，请稍后重试"
        }
    except OzonBuyerClientError as e:
        logger.error(f"标签反查失败: user_id={current_user.id}, error={e}")
        return {
            "ok": False,
            "error": f"查询失败: {str(e)}"
        }
    except Exception as e:
        logger.error(f"标签反查异常: user_id={current_user.id}, error={e}", exc_info=True)
        return {
            "ok": False,
            "error": "服务器内部错误"
        }

