"""
浏览器扩展专用 API 路由

统一管理浏览器扩展使用的所有 API，便于权限分配
所有端点使用 /extension 前缀

核心逻辑复用现有服务，本文件仅作为统一入口
"""
from fastapi import APIRouter, Depends, Query, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
import logging

from ef_core.database import get_async_session
from ef_core.api.auth import get_current_user_from_api_key
from ef_core.models.users import User, user_shops, UserSettings

from ..models import OzonShop, OzonWarehouse
from ..models.watermark import WatermarkConfig
from ..services.image_storage_factory import ImageStorageFactory
from ..services.quick_publish_service import QuickPublishService

router = APIRouter(prefix="/extension", tags=["ozon-extension"])
logger = logging.getLogger(__name__)


# ============================================================================
# 连接测试
# ============================================================================

@router.get("/ping")
async def ping(user: User = Depends(get_current_user_from_api_key)):
    """
    测试 API 连接

    返回当前用户信息，用于验证 API Key 有效性
    """
    return {
        "status": "ok",
        "username": user.username,
        "user_id": user.id
    }


# ============================================================================
# 配置获取（复用原 quick_publish_routes 逻辑）
# ============================================================================

@router.get("/config")
async def get_extension_config(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    获取扩展所需的所有配置（店铺、仓库、水印）

    返回格式：
    {
      "success": true,
      "data": {
        "shops": [...],
        "watermarks": [...]
      }
    }
    """
    try:
        # 获取用户的店铺名称显示格式设置
        settings_result = await db.execute(
            select(UserSettings).where(UserSettings.user_id == user.id)
        )
        user_settings = settings_result.scalar_one_or_none()
        shop_name_format = user_settings.display_shop_name_format if user_settings else 'both'

        # 1. 获取店铺列表（根据用户角色和权限）
        if user.role == "admin":
            stmt = select(OzonShop).where(OzonShop.status == 'active')
        else:
            stmt = select(OzonShop).join(
                user_shops, OzonShop.id == user_shops.c.shop_id
            ).where(user_shops.c.user_id == user.id).where(OzonShop.status == 'active')

        shops_result = await db.execute(stmt.order_by(OzonShop.shop_name))
        shops = shops_result.scalars().all()

        # 2. 批量获取所有店铺的仓库
        shop_ids = [shop.id for shop in shops]
        warehouses_by_shop = {}
        if shop_ids:
            warehouses_result = await db.execute(
                select(OzonWarehouse)
                .where(OzonWarehouse.shop_id.in_(shop_ids))
                .where(OzonWarehouse.status == 'created')
                .order_by(OzonWarehouse.shop_id, OzonWarehouse.created_at)
            )
            for wh in warehouses_result.scalars().all():
                if wh.shop_id not in warehouses_by_shop:
                    warehouses_by_shop[wh.shop_id] = []
                warehouses_by_shop[wh.shop_id].append({
                    "id": wh.warehouse_id,
                    "name": wh.name,
                    "is_rfbs": wh.is_rfbs,
                    "status": wh.status
                })

        # 3. 获取水印配置（基于当前激活的图床）
        watermarks = []
        active_provider = await ImageStorageFactory.get_active_provider_type(db)
        if active_provider:
            watermark_result = await db.execute(
                select(WatermarkConfig)
                .where(WatermarkConfig.storage_provider == active_provider)
                .order_by(WatermarkConfig.created_at.desc())
            )
            watermarks = [
                {
                    "id": config.id,
                    "name": config.name,
                    "image_url": config.image_url,
                    "is_active": config.is_active,
                    "storage_provider": config.storage_provider
                }
                for config in watermark_result.scalars().all()
            ]

        # 4. 格式化店铺名称
        def format_shop_display_name(shop_obj, fmt: str) -> str:
            if fmt == 'ru':
                return shop_obj.shop_name
            elif fmt == 'cn':
                return shop_obj.shop_name_cn or shop_obj.shop_name
            else:  # both
                if shop_obj.shop_name_cn:
                    return f"{shop_obj.shop_name}【{shop_obj.shop_name_cn}】"
                return shop_obj.shop_name

        shops_data = [
            {
                "id": shop.id,
                "display_name": format_shop_display_name(shop, shop_name_format),
                "shop_name": shop.shop_name,
                "shop_name_cn": shop.shop_name_cn or "",
                "client_id": shop.client_id,
                "warehouses": warehouses_by_shop.get(shop.id, [])
            }
            for shop in shops
        ]

        return {
            "success": True,
            "data": {
                "shops": shops_data,
                "watermarks": watermarks
            }
        }

    except Exception as e:
        logger.error(f"Get extension config error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# ============================================================================
# 任务状态查询（复用 QuickPublishService）
# ============================================================================

@router.get("/tasks/{task_id}/status")
async def get_task_status(
    task_id: str,
    shop_id: Optional[int] = Query(None, description="店铺ID（可选）"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    查询 Celery 任务状态（跟卖上架任务）

    状态说明：
    - pending: 任务已提交，等待执行
    - running: 任务执行中
    - completed: 任务完成
    - failed: 任务失败
    - not_found: 任务不存在或已过期
    """
    try:
        service = QuickPublishService()
        return await service.get_task_status(db, task_id, shop_id)
    except Exception as e:
        logger.error(f"Get task status error: {e}", exc_info=True)
        return {
            "task_id": task_id,
            "status": "error",
            "progress": 0,
            "error": str(e)
        }


# ============================================================================
# 商品采集（复用 CollectionRecordService）
# ============================================================================

@router.post("/products/collect")
async def collect_product(
    data: dict,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    采集商品到采集记录（不立即上架）
    """
    from ..services.collection_record_service import CollectionRecordService
    from ef_core.api.error import problem

    try:
        source_url = data.get("source_url")
        product_data = data.get("product_data", {})

        # 校验尺寸和重量
        dimensions = product_data.get('dimensions', {})
        required_fields = ['width', 'height', 'length', 'weight']
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
            user_id=user.id,
            collection_type="collect_only",
            source_url=source_url,
            product_data=product_data,
            shop_id=data.get("shop_id"),
            source_product_id=data.get("source_product_id")
        )

        return {
            "ok": True,
            "data": {
                "record_id": record.id,
                "message": "商品已采集，请到系统采集记录中查看"
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Collect product error: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


# ============================================================================
# 商品上传（复用 ProductSelectionService）
# ============================================================================

@router.post("/products/upload")
async def upload_products(
    data: dict,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    上传商品数据到采集记录
    """
    from ..services.product_selection_service import ProductSelectionService
    from decimal import Decimal

    try:
        products = data.get("products", [])
        batch_name = data.get("batch_name")
        source_id = data.get("source_id")

        if len(products) > 1000:
            raise HTTPException(
                status_code=400,
                detail={"code": "PAYLOAD_TOO_LARGE", "message": "单次上传最多支持1000条商品"}
            )

        if len(products) == 0:
            raise HTTPException(
                status_code=400,
                detail={"code": "EMPTY_PAYLOAD", "message": "商品列表不能为空"}
            )

        service = ProductSelectionService()
        success_count = 0
        failed_count = 0
        errors = []

        # 转换数据格式并批量处理
        batch_items = []
        for idx, product in enumerate(products):
            try:
                cleaned_data = {
                    'user_id': user.id,
                    'product_id': product.get('product_id'),
                    'product_name_ru': product.get('product_name_ru'),
                    'product_name_cn': product.get('product_name_cn'),
                    'brand': product.get('brand') or 'без бренда',
                    'brand_normalized': service.normalize_brand(product.get('brand')) if product.get('brand') else 'NO_BRAND',
                    'ozon_link': product.get('ozon_link'),
                    'image_url': product.get('image_url'),
                    'category_link': product.get('category_link'),
                }

                # 价格字段
                if product.get('current_price') is not None:
                    cleaned_data['current_price'] = Decimal(str(product['current_price']))
                if product.get('original_price') is not None:
                    cleaned_data['original_price'] = Decimal(str(product['original_price']))

                # 佣金字段
                for field in ['rfbs_commission_low', 'rfbs_commission_mid', 'rfbs_commission_high',
                              'fbs_commission_low', 'fbs_commission_mid', 'fbs_commission_high']:
                    if product.get(field) is not None:
                        cleaned_data[field] = Decimal(str(product[field]))

                # 其他字段
                for field in ['monthly_sales', 'yearly_sales', 'seller_count', 'review_count',
                              'category1', 'category2', 'category3', 'category1_id', 'category2_id', 'category3_id',
                              'product_sku', 'rating']:
                    if product.get(field) is not None:
                        cleaned_data[field] = product[field]

                # 日期字段
                if product.get('product_created_date'):
                    from datetime import datetime
                    try:
                        cleaned_data['product_created_date'] = datetime.fromisoformat(
                            product['product_created_date'].replace('Z', '+00:00')
                        )
                    except Exception:
                        pass

                batch_items.append(cleaned_data)
            except Exception as e:
                failed_count += 1
                errors.append({"index": idx, "error": str(e)})

        # 批量保存
        if batch_items:
            saved_count = await service.batch_save_products(db, batch_items, batch_name, source_id)
            success_count = saved_count

        return {
            "success": True,
            "total": len(products),
            "success_count": success_count,
            "failed_count": failed_count,
            "errors": errors if errors else None
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload products error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# ============================================================================
# 跟卖上架（复用 collection_record_routes 逻辑）
# ============================================================================

@router.post("/products/follow-pdp")
async def follow_pdp(
    data: dict,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    跟卖上架（从 PDP 页面直接上架）
    """
    from ..services.collection_record_service import CollectionRecordService
    from ..tasks.collection_listing_tasks import process_follow_pdp_listing

    try:
        # 从 variants 和其他字段构造 product_data
        variants = data.get("variants", [])
        variants_for_display = []
        for v in variants:
            variant_images = v.get("images", [])
            if variant_images and isinstance(variant_images[0], str):
                variant_images = [{"url": url} for url in variant_images]
            variants_for_display.append({
                **v,
                "images": variant_images,
            })

        first_variant = variants_for_display[0] if variants_for_display else {}

        # 从第一个变体提取图片
        first_variant_images = first_variant.get("images", [])
        if first_variant.get("primary_image"):
            product_images = [{"url": first_variant["primary_image"], "is_primary": True}]
            product_images.extend(first_variant_images)
        else:
            product_images = first_variant_images

        product_data_for_display = {
            "title": data.get("title") or first_variant.get("name", ""),
            "images": product_images,
            "price": first_variant.get("price"),
            "old_price": first_variant.get("old_price"),
            "description": data.get("description"),
            "dimensions": data.get("dimensions"),
            "brand": data.get("brand"),
            "barcode": data.get("barcode"),
            "variants": variants_for_display,
        }

        # 创建采集记录
        record = await CollectionRecordService.create_collection_record(
            db=db,
            user_id=user.id,
            collection_type="follow_pdp",
            source_url=data.get("source_url"),
            product_data=product_data_for_display,
            shop_id=data.get("shop_id"),
            source_product_id=None
        )

        # 保存上架请求参数
        await CollectionRecordService.update_listing_status(
            db=db,
            record_id=record.id,
            listing_status="pending",
            listing_request_payload={
                "variants": variants,
                "warehouse_id": data.get("warehouse_id"),
                "watermark_config_id": data.get("watermark_config_id"),
                "videos": data.get("videos"),
                "description": data.get("description"),
                "category_id": data.get("category_id"),
                "brand": data.get("brand"),
                "barcode": data.get("barcode"),
                "dimensions": data.get("dimensions"),
                "attributes": data.get("attributes"),
                "title": data.get("title"),
                "purchase_url": data.get("purchase_url"),
                "purchase_price": data.get("purchase_price"),
                "purchase_note": data.get("purchase_note"),
            }
        )

        # 触发异步上架任务
        task = process_follow_pdp_listing.delay(record.id)

        return {
            "ok": True,
            "data": {
                "record_id": record.id,
                "task_id": task.id,
                "message": "上架任务已提交，请稍后查看上架记录"
            }
        }
    except Exception as e:
        logger.error(f"Follow PDP error: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


# ============================================================================
# 类目查询
# ============================================================================

@router.get("/categories/by-name")
async def get_category_by_name(
    name_ru: str = Query(..., description="俄文类目名称"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    根据俄文类目名称查询完整三级类目
    """
    from ..models.ozon_category import OzonCategory

    try:
        result = await db.execute(
            select(OzonCategory).where(OzonCategory.type_name_ru == name_ru)
        )
        category = result.scalar_one_or_none()

        if not category:
            return {"success": False, "data": None}

        return {
            "success": True,
            "data": {
                "category1": category.category1,
                "category1Id": category.category1_id,
                "category2": category.category2,
                "category2Id": category.category2_id,
                "category3": category.category3,
                "category3Id": category.category3_id,
                "fullPath": f"{category.category1} > {category.category2} > {category.category3}" if category.category3 else None
            }
        }
    except Exception as e:
        logger.error(f"Get category by name error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# ============================================================================
# 采集源队列
# ============================================================================

@router.get("/collection-sources/next")
async def get_next_collection_source(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    获取下一个待采集的地址
    """
    from ..models.collection_source import CollectionSource
    from datetime import datetime, timedelta

    try:
        # 优先返回超过 7 天未采集的地址
        seven_days_ago = datetime.utcnow() - timedelta(days=7)

        result = await db.execute(
            select(CollectionSource)
            .where(CollectionSource.is_active == True)
            .where(
                (CollectionSource.last_collected_at == None) |
                (CollectionSource.last_collected_at < seven_days_ago)
            )
            .order_by(CollectionSource.priority.desc(), CollectionSource.last_collected_at.asc().nullsfirst())
            .limit(1)
        )
        source = result.scalar_one_or_none()

        if not source:
            return {"success": True, "data": None}

        return {
            "success": True,
            "data": {
                "id": source.id,
                "source_type": source.source_type,
                "source_url": source.source_url,
                "source_path": source.source_path,
                "display_name": source.display_name,
                "target_count": source.target_count,
                "priority": source.priority
            }
        }
    except Exception as e:
        logger.error(f"Get next collection source error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.put("/collection-sources/{source_id}/status")
async def update_collection_source_status(
    source_id: int,
    data: dict,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    更新采集源状态
    """
    from ..models.collection_source import CollectionSource
    from datetime import datetime

    try:
        result = await db.execute(
            select(CollectionSource).where(CollectionSource.id == source_id)
        )
        source = result.scalar_one_or_none()

        if not source:
            raise HTTPException(status_code=404, detail="采集源不存在")

        status = data.get("status")
        product_count = data.get("product_count")
        error_message = data.get("error_message")

        if status == "collecting":
            source.status = "collecting"
        elif status == "completed":
            source.status = "idle"
            source.last_collected_at = datetime.utcnow()
            if product_count is not None:
                source.total_collected = (source.total_collected or 0) + product_count
        elif status == "failed":
            source.status = "failed"
            source.last_error = error_message

        await db.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update collection source status error: {e}", exc_info=True)
        await db.rollback()
        return {"success": False, "error": str(e)}


# ============================================================================
# Cookie 上传（复用 shop_routes 逻辑）
# ============================================================================

@router.post("/session/upload")
async def upload_session(
    data: dict,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    上传浏览器 Session Cookie

    浏览器扩展定期调用此接口上传最新的 OZON Cookie，
    后端使用这些 Cookie 访问 OZON 页面执行同步任务。
    """
    import json
    from ef_core.utils.datetime_utils import utcnow

    try:
        cookies = data.get("cookies", [])
        user_agent = data.get("user_agent")

        if not cookies:
            raise HTTPException(
                status_code=400,
                detail={"code": "EMPTY_COOKIES", "message": "Cookie 列表不能为空"}
            )

        # 将 Cookie 转换为 JSON 字符串
        cookies_data = {
            "cookies": cookies,
            "user_agent": user_agent,
            "uploaded_at": utcnow().isoformat()
        }
        cookies_json = json.dumps(cookies_data, ensure_ascii=False)

        # 更新用户的 Cookie
        user.ozon_session_cookies = cookies_json
        user.ozon_session_updated_at = utcnow()

        await db.commit()

        return {
            "success": True,
            "message": "Session cookies uploaded successfully",
            "cookie_count": len(cookies)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload session error: {e}", exc_info=True)
        await db.rollback()
        return {"success": False, "error": str(e)}


# ============================================================================
# 同步状态查询（复用 shop_routes 逻辑）
# ============================================================================

@router.get("/sync-status")
async def get_sync_status(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    查询后端同步任务执行状态

    浏览器扩展在执行任务前调用此接口，检查后端是否已成功执行。
    如果后端已成功，扩展可以跳过执行。
    """
    from ..models import OzonWebSyncLog
    from datetime import timedelta
    from ef_core.utils.datetime_utils import utcnow

    try:
        now = utcnow()

        async def get_last_success(task_type: str):
            stmt = select(OzonWebSyncLog).where(
                OzonWebSyncLog.user_id == user.id,
                OzonWebSyncLog.task_type == task_type,
                OzonWebSyncLog.status == "success"
            ).order_by(OzonWebSyncLog.completed_at.desc()).limit(1)
            result = await db.execute(stmt)
            return result.scalar_one_or_none()

        # 1. 促销清理状态（检查今天是否已执行）
        promo_log = await get_last_success("promo_cleaner")
        promo_today_executed = False
        if promo_log and promo_log.completed_at:
            beijing_now = now + timedelta(hours=8)
            beijing_completed = promo_log.completed_at + timedelta(hours=8)
            promo_today_executed = beijing_now.date() == beijing_completed.date()

        # 2. 账单同步状态（检查当前窗口期是否已执行）
        invoice_log = await get_last_success("invoice_sync")
        invoice_window_executed = False
        if invoice_log and invoice_log.completed_at:
            # 简化：7天内执行过即认为已同步
            invoice_window_executed = (now - invoice_log.completed_at).days < 7

        # 3. 余额同步状态（检查当前小时是否已执行）
        balance_log = await get_last_success("balance_sync")
        balance_hour_executed = False
        if balance_log and balance_log.completed_at:
            balance_hour_executed = (
                now.date() == balance_log.completed_at.date() and
                now.hour == balance_log.completed_at.hour
            )

        return {
            "promo_cleaner": {
                "executed": promo_today_executed,
                "last_run": promo_log.completed_at.isoformat() if promo_log and promo_log.completed_at else None
            },
            "invoice_sync": {
                "executed": invoice_window_executed,
                "last_run": invoice_log.completed_at.isoformat() if invoice_log and invoice_log.completed_at else None
            },
            "balance_sync": {
                "executed": balance_hour_executed,
                "last_run": balance_log.completed_at.isoformat() if balance_log and balance_log.completed_at else None
            }
        }
    except Exception as e:
        logger.error(f"Get sync status error: {e}", exc_info=True)
        return {"error": str(e)}


# ============================================================================
# 店铺余额更新（复用 finance_routes 逻辑）
# ============================================================================

@router.post("/shop-balance/update")
async def update_shop_balance(
    data: dict,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    更新店铺当前余额（由浏览器扩展调用）
    """
    from datetime import datetime
    from decimal import Decimal

    try:
        client_id = data.get("client_id")
        balance_rub = data.get("balance_rub")

        if not client_id:
            raise HTTPException(status_code=400, detail="client_id is required")

        # 查找店铺
        stmt = select(OzonShop).where(OzonShop.client_id == client_id)
        result = await db.execute(stmt)
        shop = result.scalar_one_or_none()

        if not shop:
            raise HTTPException(status_code=404, detail=f"Shop not found: {client_id}")

        # 更新余额
        shop.current_balance_rub = Decimal(str(balance_rub)) if balance_rub is not None else None
        shop.balance_updated_at = datetime.utcnow()

        await db.commit()

        logger.info(f"Shop balance updated: shop_id={shop.id}, balance={balance_rub} RUB")

        return {
            "success": True,
            "shop_id": shop.id,
            "balance_rub": str(shop.current_balance_rub),
            "updated_at": shop.balance_updated_at.isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update shop balance error: {e}", exc_info=True)
        await db.rollback()
        return {"success": False, "error": str(e)}


# ============================================================================
# 账单同步检查（复用 finance_routes 逻辑）
# ============================================================================

@router.get("/invoice-payments/should-sync")
async def check_should_sync_invoice_payments(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    检查是否需要同步账单付款

    检查窗口：
    - 周期 1-15 结束后 → 16-22 号检查
    - 周期 16-月末结束后 → 下月 1-7 号检查
    """
    from datetime import datetime, date
    from calendar import monthrange
    from ..models.invoice_payment import OzonInvoicePayment

    try:
        now = datetime.utcnow()
        day = now.day

        # 判断检查窗口和对应周期
        if day >= 16 and day <= 22:
            in_check_window = True
            period_start = date(now.year, now.month, 1)
            period_end = date(now.year, now.month, 15)
            window_reason = f"在检查窗口内（{day}号，检查周期 {period_start} ~ {period_end}）"
        elif day >= 1 and day <= 7:
            in_check_window = True
            if now.month == 1:
                prev_year = now.year - 1
                prev_month = 12
            else:
                prev_year = now.year
                prev_month = now.month - 1
            _, last_day = monthrange(prev_year, prev_month)
            period_start = date(prev_year, prev_month, 16)
            period_end = date(prev_year, prev_month, last_day)
            window_reason = f"在检查窗口内（{day}号，检查周期 {period_start} ~ {period_end}）"
        else:
            in_check_window = False
            window_reason = f"不在检查窗口内（当前{day}号）"
            return {
                "in_check_window": False,
                "window_reason": window_reason,
                "shops": []
            }

        # 获取所有活跃店铺
        shops_result = await db.execute(
            select(OzonShop).where(OzonShop.status == 'active')
        )
        shops = shops_result.scalars().all()

        shops_status = []
        for shop in shops:
            # 检查该店铺在当前周期是否有记录
            stmt = select(OzonInvoicePayment).where(
                OzonInvoicePayment.shop_id == shop.id,
                OzonInvoicePayment.period_start == period_start,
                OzonInvoicePayment.period_end == period_end
            ).limit(1)
            result = await db.execute(stmt)
            has_record = result.scalar_one_or_none() is not None

            shops_status.append({
                "shop_id": shop.id,
                "client_id": shop.client_id,
                "shop_name": shop.shop_name,
                "synced": has_record,
                "needs_sync": not has_record
            })

        return {
            "in_check_window": in_check_window,
            "window_reason": window_reason,
            "shops": shops_status
        }
    except Exception as e:
        logger.error(f"Check should sync invoice payments error: {e}", exc_info=True)
        return {"error": str(e)}


# ============================================================================
# 账单同步（复用 finance_routes 逻辑）
# ============================================================================

@router.post("/invoice-payments/sync")
async def sync_invoice_payments(
    data: dict,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    接收浏览器扩展上传的账单付款数据
    """
    from datetime import datetime, date
    from decimal import Decimal
    from calendar import monthrange
    from ..models.invoice_payment import OzonInvoicePayment

    try:
        client_id = data.get("client_id")
        payments = data.get("payments", [])

        if not client_id:
            raise HTTPException(status_code=400, detail="client_id is required")

        # 查找店铺
        result = await db.execute(
            select(OzonShop).where(OzonShop.client_id == client_id)
        )
        shop = result.scalar_one_or_none()

        if not shop:
            raise HTTPException(status_code=404, detail=f"Shop not found: {client_id}")

        created_count = 0
        updated_count = 0

        for payment in payments:
            # 解析日期（俄文格式如 "15 января 2025"）
            scheduled_date_str = payment.get("scheduled_payment_date")
            if not scheduled_date_str:
                continue

            # 简化的日期解析（实际应使用更完整的解析器）
            try:
                from ..api.finance_routes import parse_ru_date
                scheduled_date = parse_ru_date(scheduled_date_str)
            except Exception:
                logger.warning(f"Cannot parse date: {scheduled_date_str}")
                continue

            if not scheduled_date:
                continue

            # 计算周期
            if scheduled_date.day <= 15:
                _, last_day = monthrange(scheduled_date.year, scheduled_date.month)
                period_start = date(scheduled_date.year, scheduled_date.month, 16)
                if scheduled_date.month == 12:
                    period_end_month = 1
                    period_end_year = scheduled_date.year + 1
                else:
                    period_end_month = scheduled_date.month + 1
                    period_end_year = scheduled_date.year
                period_end = date(period_end_year, period_end_month, 15)
            else:
                if scheduled_date.month == 12:
                    next_month = 1
                    next_year = scheduled_date.year + 1
                else:
                    next_month = scheduled_date.month + 1
                    next_year = scheduled_date.year
                _, last_day = monthrange(next_year, next_month)
                period_start = date(next_year, next_month, 16)
                period_end = date(next_year, next_month, last_day)

            # 解析金额
            amount_str = payment.get("amount", "0")
            try:
                amount = Decimal(str(amount_str).replace(" ", "").replace(",", ".").replace("₽", ""))
            except Exception:
                amount = Decimal("0")

            # Upsert 记录
            existing = await db.execute(
                select(OzonInvoicePayment).where(
                    OzonInvoicePayment.shop_id == shop.id,
                    OzonInvoicePayment.period_start == period_start,
                    OzonInvoicePayment.period_end == period_end,
                    OzonInvoicePayment.scheduled_payment_date == scheduled_date
                )
            )
            record = existing.scalar_one_or_none()

            if record:
                record.amount = amount
                record.invoice_status = payment.get("status", "pending")
                record.updated_at = datetime.utcnow()
                updated_count += 1
            else:
                new_record = OzonInvoicePayment(
                    shop_id=shop.id,
                    period_start=period_start,
                    period_end=period_end,
                    scheduled_payment_date=scheduled_date,
                    amount=amount,
                    invoice_status=payment.get("status", "pending")
                )
                db.add(new_record)
                created_count += 1

        await db.commit()

        return {
            "success": True,
            "created": created_count,
            "updated": updated_count,
            "message": f"Synced {created_count + updated_count} invoice payments"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sync invoice payments error: {e}", exc_info=True)
        await db.rollback()
        return {"success": False, "error": str(e)}
