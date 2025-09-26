"""
选品助手API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form, BackgroundTasks
from typing import Optional, Dict, Any, List
from pathlib import Path
from datetime import datetime, timedelta
import tempfile
import shutil
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
import logging

from ef_core.database import get_async_session
from ..services.product_selection_service import ProductSelectionService
from ..models.product_selection import ProductSelectionItem, ImportHistory

router = APIRouter(prefix="/product-selection", tags=["Product Selection"])
logger = logging.getLogger(__name__)


# DTO 模型
class ProductSearchRequest(BaseModel):
    """商品搜索请求"""
    brand: Optional[str] = None
    rfbs_low_max: Optional[float] = Field(None, description="rFBS(<=1500₽)最大佣金率")
    rfbs_mid_max: Optional[float] = Field(None, description="rFBS(1501-5000₽)最大佣金率")
    fbp_low_max: Optional[float] = Field(None, description="FBP(<=1500₽)最大佣金率")
    fbp_mid_max: Optional[float] = Field(None, description="FBP(1501-5000₽)最大佣金率")
    monthly_sales_min: Optional[int] = Field(None, description="最小月销量")
    monthly_sales_max: Optional[int] = Field(None, description="最大月销量")
    weight_max: Optional[int] = Field(None, description="最大包装重量(克)")
    sort_by: Optional[str] = Field('sales_desc', description="排序方式")
    page: Optional[int] = Field(1, ge=1, description="页码")
    page_size: Optional[int] = Field(20, ge=1, le=100, description="每页数量")


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


# API 端点
@router.post("/import", response_model=ImportResponse)
async def import_products(
    file: UploadFile = File(...),
    strategy: str = Form('update'),
    shop_id: int = Form(1),  # TODO: 从认证获取店铺ID
    auto_update_competitors: bool = Form(True),  # 是否自动更新竞争对手数据
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_async_session)
):
    """
    导入商品数据文件

    Args:
        file: Excel或CSV文件
        strategy: 导入策略 (skip/update/append)
        shop_id: 店铺ID
        auto_update_competitors: 是否自动更新竞争对手数据
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
                user_id=1,  # TODO: 从认证获取用户ID
                validate_only=False
            )

            if result['success']:
                # 如果导入成功且需要自动更新竞争对手数据
                if auto_update_competitors:
                    from ..services.competitor_data_updater import CompetitorDataUpdater

                    # 使用后台任务异步更新竞争对手数据
                    updater = CompetitorDataUpdater(db)
                    background_tasks.add_task(
                        updater.update_all_products,
                        shop_id=shop_id,
                        force=False  # 不强制更新，只更新新导入的商品
                    )

                    # 在返回结果中添加竞争数据更新信息
                    result['competitor_update'] = {
                        'scheduled': True,
                        'message': 'Competitor data update has been scheduled in background'
                    }
                    logger.info(f"Scheduled competitor data update for shop {shop_id}")

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
                user_id=1,
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
        if v is not None and k not in ['sort_by', 'page', 'page_size']
    }

    result = await service.search_products(
        db=db,
        filters=filters,
        sort_by=request.sort_by,
        page=request.page,
        page_size=request.page_size
    )

    return {
        'success': True,
        'data': result
    }


@router.get("/products")
async def get_products(
    brand: Optional[str] = Query(None, description="品牌"),
    rfbs_low_max: Optional[float] = Query(None, description="rFBS(<=1500₽)最大佣金率"),
    rfbs_mid_max: Optional[float] = Query(None, description="rFBS(1501-5000₽)最大佣金率"),
    fbp_low_max: Optional[float] = Query(None, description="FBP(<=1500₽)最大佣金率"),
    fbp_mid_max: Optional[float] = Query(None, description="FBP(1501-5000₽)最大佣金率"),
    monthly_sales_min: Optional[int] = Query(None, description="最小月销量"),
    monthly_sales_max: Optional[int] = Query(None, description="最大月销量"),
    weight_max: Optional[int] = Query(None, description="最大包装重量"),
    sort_by: str = Query('sales_desc', description="排序方式"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取商品列表（GET方法）
    """
    service = ProductSelectionService()

    # 构建筛选条件
    filters = {}
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

    result = await service.search_products(
        db=db,
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
    db: AsyncSession = Depends(get_async_session)
):
    """获取品牌列表"""
    service = ProductSelectionService()
    brands = await service.get_brands(db)

    return {
        'success': True,
        'data': brands
    }


@router.get("/import-history")
async def get_import_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_async_session)
):
    """获取导入历史"""
    service = ProductSelectionService()
    result = await service.get_import_history(
        db=db,
        page=page,
        page_size=page_size
    )

    return {
        'success': True,
        'data': result
    }


@router.post("/competitor-update")
async def update_competitor_data(
    shop_id: int = Query(..., description="店铺ID"),
    product_ids: Optional[List[str]] = Query(None, description="指定商品ID列表"),
    force: bool = Query(False, description="是否强制更新"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_async_session)
):
    """
    更新竞争对手数据
    支持全量更新或指定商品更新
    """
    from ..services.competitor_data_updater import CompetitorDataUpdater

    updater = CompetitorDataUpdater(db)

    # 创建后台任务
    if product_ids:
        # 更新指定商品
        background_tasks.add_task(
            updater.update_specific_products,
            shop_id=shop_id,
            product_ids=product_ids
        )
        message = f"Started updating competitor data for {len(product_ids)} products"
    else:
        # 更新所有商品
        background_tasks.add_task(
            updater.update_all_products,
            shop_id=shop_id,
            force=force
        )
        message = "Started updating competitor data for all products"

    return {
        'success': True,
        'message': message,
        'task': {
            'shop_id': shop_id,
            'product_count': len(product_ids) if product_ids else 'all',
            'force': force,
            'started_at': datetime.utcnow().isoformat()
        }
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
        try:
            # 尝试用product_id作为offer_id调用API
            product_info = await api_client.get_product_info_list(offer_ids=[product_id])
            logger.info(f"成功通过offer_id获取商品信息: {product_id}")
        except Exception as e:
            logger.warning(f"无法从Ozon API获取商品详情: {e}")
            # 如果API调用失败，使用数据库中的信息
            product_info = None

        # 处理商品详情信息
        images = []
        if product_info and product_info.get('result') and product_info['result'].get('items'):
            # 从API获取的数据
            product_detail = product_info['result']['items'][0]
            if product_detail.get('images'):
                for img in product_detail['images']:
                    if isinstance(img, dict) and img.get('file_name'):
                        images.append({
                            'url': f"https://cdn1.ozone.ru/s3/multimedia-c/{img['file_name']}",
                            'file_name': img['file_name'],
                            'default': img.get('default', False)
                        })
                    elif isinstance(img, str):
                        images.append({
                            'url': img,
                            'file_name': img.split('/')[-1] if '/' in img else img,
                            'default': False
                        })
        else:
            # 使用数据库中的图片信息
            if db_product.image_url:
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


@router.get("/competitor-status")
async def get_competitor_update_status(
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取竞争对手数据更新状态
    """
    from sqlalchemy import func, or_
    from ..models.product_selection import ProductSelectionItem
    from datetime import datetime, timedelta

    # 获取统计信息
    stmt = select(
        func.count(ProductSelectionItem.id).label('total'),
        func.count(ProductSelectionItem.competitor_updated_at).label('updated'),
        func.min(ProductSelectionItem.competitor_updated_at).label('oldest_update'),
        func.max(ProductSelectionItem.competitor_updated_at).label('latest_update')
    )

    result = await db.execute(stmt)
    stats = result.first()

    # 计算需要更新的商品数
    threshold = datetime.utcnow() - timedelta(hours=24)
    stmt_outdated = select(func.count(ProductSelectionItem.id)).where(
        or_(
            ProductSelectionItem.competitor_updated_at == None,
            ProductSelectionItem.competitor_updated_at < threshold
        )
    )
    result_outdated = await db.execute(stmt_outdated)
    outdated_count = result_outdated.scalar()

    return {
        'success': True,
        'data': {
            'total_products': stats.total,
            'updated_products': stats.updated,
            'outdated_products': outdated_count,
            'oldest_update': stats.oldest_update.isoformat() if stats.oldest_update else None,
            'latest_update': stats.latest_update.isoformat() if stats.latest_update else None,
            'update_threshold_hours': 24
        }
    }