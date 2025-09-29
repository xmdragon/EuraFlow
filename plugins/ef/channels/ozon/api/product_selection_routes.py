"""
选品助手API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form, BackgroundTasks
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
from ..services.product_selection_service import ProductSelectionService
from ..models.product_selection import ProductSelectionItem, ImportHistory
from ..services.sync_state_manager import get_sync_state_manager

router = APIRouter(prefix="/product-selection", tags=["Product Selection"])
logger = logging.getLogger(__name__)


# DTO 模型
class ProductSearchRequest(BaseModel):
    """商品搜索请求"""
    product_name: Optional[str] = Field(None, description="商品名称")
    brand: Optional[str] = None
    rfbs_low_max: Optional[float] = Field(None, description="rFBS(<=1500₽)最大佣金率")
    rfbs_mid_max: Optional[float] = Field(None, description="rFBS(1501-5000₽)最大佣金率")
    fbp_low_max: Optional[float] = Field(None, description="FBP(<=1500₽)最大佣金率")
    fbp_mid_max: Optional[float] = Field(None, description="FBP(1501-5000₽)最大佣金率")
    monthly_sales_min: Optional[int] = Field(None, description="最小月销量")
    monthly_sales_max: Optional[int] = Field(None, description="最大月销量")
    weight_max: Optional[int] = Field(None, description="最大包装重量(克)")
    sort_by: Optional[str] = Field('created_desc', description="排序方式")
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
                user_id=1,  # TODO: 从认证获取用户ID
                validate_only=False
            )

            if result['success']:
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
    product_name: Optional[str] = Query(None, description="商品名称"),
    brand: Optional[str] = Query(None, description="品牌"),
    rfbs_low_max: Optional[float] = Query(None, description="rFBS(<=1500₽)最大佣金率"),
    rfbs_mid_max: Optional[float] = Query(None, description="rFBS(1501-5000₽)最大佣金率"),
    fbp_low_max: Optional[float] = Query(None, description="FBP(<=1500₽)最大佣金率"),
    fbp_mid_max: Optional[float] = Query(None, description="FBP(1501-5000₽)最大佣金率"),
    monthly_sales_min: Optional[int] = Query(None, description="最小月销量"),
    monthly_sales_max: Optional[int] = Query(None, description="最大月销量"),
    weight_max: Optional[int] = Query(None, description="最大包装重量"),
    sort_by: str = Query('created_desc', description="排序方式"),
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


@router.post("/clear-all-competitor-data")
async def clear_all_competitor_data(
    db: AsyncSession = Depends(get_async_session)
):
    """
    清除所有产品的竞争者数据
    """
    try:
        from sqlalchemy import update

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
                    db_product.images_updated_at = datetime.utcnow()
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


