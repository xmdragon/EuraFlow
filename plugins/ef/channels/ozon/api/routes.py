"""
Ozon 平台 API 端点
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from ef_core.database import get_async_session
from ..models import OzonShop, OzonProduct, OzonOrder, OzonPosting
from ..utils.datetime_utils import parse_datetime, parse_date, utcnow
from sqlalchemy import select, func
# from .auth import get_current_user  # Временно отключено для разработки

router = APIRouter(prefix="/ozon", tags=["Ozon"])
logger = logging.getLogger(__name__)

# 延迟导入子路由以避免循环导入
try:
    from .watermark_routes import router as watermark_router
    router.include_router(watermark_router)
except ImportError as e:
    logger.warning(f"Could not import watermark routes: {e}")

try:
    from .product_selection_routes import router as product_selection_router
    router.include_router(product_selection_router)
except ImportError as e:
    logger.warning(f"Could not import product selection routes: {e}")

try:
    from .webhook_routes import router as webhook_router
    router.include_router(webhook_router)
except ImportError as e:
    import traceback
    import sys
    print(f"════════ WEBHOOK IMPORT ERROR ════════", file=sys.stderr)
    print(f"Error: {e}", file=sys.stderr)
    print(f"Traceback:\n{traceback.format_exc()}", file=sys.stderr)
    print(f"═════════════════════════════════════", file=sys.stderr)
    logger.warning(f"Could not import webhook routes: {e}")

try:
    from .chat_routes import router as chat_router
    router.include_router(chat_router)
except ImportError as e:
    logger.warning(f"Could not import chat routes: {e}")

try:
    from .kuajing84_routes import router as kuajing84_router
    router.include_router(kuajing84_router)
except ImportError as e:
    logger.warning(f"Could not import kuajing84 routes: {e}")


# DTO 模型
class ShopCreateDTO(BaseModel):
    shop_name: str
    platform: str = "ozon"
    api_credentials: Dict[str, str]
    config: Dict[str, Any] = Field(default_factory=dict)

class ShopUpdateDTO(BaseModel):
    shop_name: Optional[str] = None
    status: Optional[str] = None
    api_credentials: Optional[Dict[str, str]] = None
    config: Optional[Dict[str, Any]] = None

class ShopResponseDTO(BaseModel):
    id: int
    shop_name: str
    platform: str
    status: str
    api_credentials: Optional[Dict[str, str]]
    config: Dict[str, Any]
    stats: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime

# 店铺管理端点
@router.get("/shops")
async def get_shops(
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """获取 Ozon 店铺列表"""
    # 从数据库获取店铺列表
    result = await db.execute(
        select(OzonShop).where(OzonShop.owner_user_id == 1)  # 临时硬编码用户ID
    )
    shops = result.scalars().all()
    
    # 计算真实的统计数据
    shops_data = []
    for shop in shops:
        shop_dict = shop.to_dict(include_credentials=True)
        
        # 获取真实的商品和订单数量
        products_count = await db.execute(
            select(func.count()).select_from(OzonProduct).where(OzonProduct.shop_id == shop.id)
        )
        orders_count = await db.execute(
            select(func.count()).select_from(OzonOrder).where(OzonOrder.shop_id == shop.id)
        )
        
        # 更新统计数据为真实值
        shop_dict["stats"] = {
            "total_products": products_count.scalar() or 0,
            "total_orders": orders_count.scalar() or 0,
            "last_sync_at": shop.last_sync_at.isoformat() if shop.last_sync_at else None,
            "sync_status": "success" if shop.last_sync_at else "pending"
        }
        
        shops_data.append(shop_dict)
    
    return {"data": shops_data}

@router.post("/shops")
async def create_shop(
    shop_data: ShopCreateDTO,
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """创建新的 Ozon 店铺"""
    new_shop = OzonShop(
        shop_name=shop_data.shop_name,
        platform=shop_data.platform,
        status="active",
        owner_user_id=1,  # 临时硬编码
        client_id=shop_data.api_credentials.get("client_id", ""),
        api_key_enc=shop_data.api_credentials.get("api_key", ""),  # 实际应该加密
        config=shop_data.config or {}
    )
    
    db.add(new_shop)
    await db.commit()
    await db.refresh(new_shop)
    
    return new_shop.to_dict(include_credentials=True)

@router.put("/shops/{shop_id}")
async def update_shop(
    shop_id: int,
    shop_data: ShopUpdateDTO,
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """更新 Ozon 店铺配置"""
    # 查找店铺
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()
    
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    
    # 更新店铺信息
    if shop_data.shop_name is not None:
        shop.shop_name = shop_data.shop_name
    if shop_data.status is not None:
        shop.status = shop_data.status
    if shop_data.api_credentials is not None:
        shop.client_id = shop_data.api_credentials.get("client_id", shop.client_id)
        if shop_data.api_credentials.get("api_key") and shop_data.api_credentials["api_key"] != "******":
            shop.api_key_enc = shop_data.api_credentials["api_key"]  # 实际应该加密
    if shop_data.config is not None:
        # 合并配置
        current_config = shop.config or {}

        # 过滤掉空的webhook字段，避免覆盖已有的webhook配置
        # webhook配置应该通过专门的 /webhook 端点设置
        new_config = {k: v for k, v in shop_data.config.items()
                     if not (k in ('webhook_url', 'webhook_secret') and not v)}

        current_config.update(new_config)
        shop.config = current_config
    
    shop.updated_at = datetime.now()
    
    await db.commit()
    await db.refresh(shop)
    
    return shop.to_dict(include_credentials=True)

@router.delete("/shops/{shop_id}")
async def delete_shop(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """删除 Ozon 店铺"""
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()
    
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    
    await db.delete(shop)
    await db.commit()
    
    return {"message": "Shop deleted successfully"}

@router.post("/shops/{shop_id}/test-connection")
async def test_connection(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """测试店铺 API 连接"""
    # 获取店铺信息
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()
    
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    
    # 验证API凭证是否存在
    if not shop.client_id or not shop.api_key_enc:
        return {
            "success": False,
            "message": "API credentials not configured",
            "details": {
                "error": "Missing client_id or api_key"
            }
        }
    
    # 使用真实的Ozon API客户端测试连接
    from ..api.client import OzonAPIClient
    
    try:
        # 创建Ozon API客户端
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc  # 注意：实际应该解密
        )
        
        # 执行测试连接
        result = await client.test_connection()
        
        # 如果连接成功，更新店铺状态
        if result["success"]:
            shop.last_sync_at = datetime.now()
            if shop.stats is None:
                shop.stats = {}
            shop.stats["last_connection_test"] = datetime.now().isoformat()
            shop.stats["connection_status"] = "success"
            await db.commit()
        
        return result
        
    except Exception as e:
        return {
            "success": False,
            "message": "Test connection failed",
            "details": {
                "error": str(e)
            }
        }

@router.get("/shops/{shop_id}/webhook")
async def get_webhook_config(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """获取店铺 Webhook 配置"""
    # 获取店铺信息
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()

    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    # 获取webhook配置
    webhook_config = shop.config or {}

    return {
        "shop_id": shop.id,
        "webhook_url": webhook_config.get("webhook_url"),
        "webhook_secret": "******" if webhook_config.get("webhook_secret") else None,
        "webhook_enabled": bool(webhook_config.get("webhook_url") and webhook_config.get("webhook_secret")),
        "supported_events": [
            "posting.status_changed",
            "posting.cancelled",
            "posting.delivered",
            "product.price_changed",
            "product.stock_changed",
            "return.created",
            "return.status_changed"
        ]
    }

@router.post("/shops/{shop_id}/webhook")
async def configure_webhook(
    shop_id: int,
    webhook_config: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_async_session)
):
    """配置店铺 Webhook"""
    import secrets
    import os

    # 获取店铺信息
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()

    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    # 验证输入
    webhook_url = webhook_config.get("webhook_url")
    if not webhook_url:
        raise HTTPException(status_code=400, detail="webhook_url is required")

    # 确保webhook_url是有效的HTTPS URL（本地开发环境允许HTTP）
    is_local = webhook_url.startswith("http://localhost") or webhook_url.startswith("http://127.0.0.1")
    if not is_local and not webhook_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="webhook_url must be HTTPS (except for localhost)")

    # 构建完整的webhook URL（如果提供的是相对路径）
    if not webhook_url.startswith("http"):
        # 获取服务器的基础URL
        base_url = os.getenv("EF__WEBHOOK_BASE_URL", "https://api.euraflow.com")
        webhook_url = f"{base_url}/api/ef/v1/ozon/webhook"

    # 更新店铺配置（重新赋值整个字典以确保SQLAlchemy检测到变化）
    current_config = shop.config.copy() if shop.config else {}
    current_config["webhook_url"] = webhook_url
    current_config["webhook_configured_at"] = datetime.now().isoformat()

    # Ozon不需要webhook_secret，设置为占位值以表示已配置
    current_config["webhook_secret"] = "ozon_no_secret_required"

    shop.config = current_config  # 重新赋值触发SQLAlchemy的变更检测
    shop.updated_at = datetime.now()

    await db.commit()
    await db.refresh(shop)  # 刷新以获取最新数据

    return {
        "success": True,
        "message": "Webhook configured successfully",
        "webhook_url": webhook_url,
        "next_steps": [
            "1. 登录 Ozon 卖家后台",
            "2. 进入【设置】→【通知】配置页面",
            "3. 设置 Webhook URL 为: " + webhook_url,
            "4. 点击【测试】或【验证】按钮",
            "5. 验证成功后即可接收实时事件通知"
        ]
    }

@router.post("/shops/{shop_id}/webhook/test")
async def test_webhook(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """测试 Webhook 配置"""
    import json
    import hmac
    import hashlib
    import httpx
    from datetime import datetime

    # 获取店铺信息
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()

    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    # 检查webhook配置
    webhook_config = shop.config or {}
    webhook_url = webhook_config.get("webhook_url")
    webhook_secret = webhook_config.get("webhook_secret")

    if not webhook_url or not webhook_secret:
        raise HTTPException(status_code=400, detail="Webhook not configured")

    # 构造测试载荷
    test_payload = {
        "company_id": shop.client_id,
        "event_type": "test",
        "timestamp": utcnow().replace(tzinfo=None).isoformat() + "Z",
        "data": {
            "message": "This is a test webhook event",
            "shop_id": shop.id
        }
    }

    payload_json = json.dumps(test_payload, separators=(',', ':'))
    payload_bytes = payload_json.encode('utf-8')

    # 生成签名
    signature = hmac.new(
        webhook_secret.encode(),
        payload_bytes,
        hashlib.sha256
    ).hexdigest()

    # 构造请求头
    headers = {
        "Content-Type": "application/json",
        "X-Ozon-Signature": signature,
        "X-Event-Id": f"test-{utcnow().timestamp()}",
        "X-Event-Type": "test",
        "User-Agent": "Ozon-Webhook-Test/1.0"
    }

    try:
        # 发送测试请求
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                webhook_url,
                content=payload_bytes,
                headers=headers
            )

        # 分析响应
        success = response.status_code == 200

        return {
            "success": success,
            "status_code": response.status_code,
            "response_time_ms": int(response.elapsed.total_seconds() * 1000) if hasattr(response, 'elapsed') else None,
            "message": "Webhook test completed",
            "details": {
                "sent_payload": test_payload,
                "response_headers": dict(response.headers),
                "response_body": response.text[:500] if response.text else None
            }
        }

    except Exception as e:
        logger.error(f"Webhook test failed: {e}")
        return {
            "success": False,
            "message": f"Webhook test failed: {str(e)}",
            "details": {
                "webhook_url": webhook_url,
                "error": str(e)
            }
        }

@router.delete("/shops/{shop_id}/webhook")
async def delete_webhook_config(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """删除店铺 Webhook 配置"""
    # 获取店铺信息
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()

    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    # 清除webhook配置
    if shop.config:
        shop.config.pop("webhook_url", None)
        shop.config.pop("webhook_secret", None)
        shop.config.pop("webhook_configured_at", None)

    shop.updated_at = datetime.now()
    await db.commit()

    return {
        "success": True,
        "message": "Webhook configuration deleted successfully"
    }

@router.post("/shops/{shop_id}/sync")
async def trigger_sync(
    shop_id: int,
    sync_type: str = Query("all", description="Sync type: all, products, orders"),
    orders_mode: str = Query("incremental", description="Orders sync mode: full, incremental"),
    products_mode: str = Query("incremental", description="Products sync mode: full, incremental"),
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """触发店铺同步"""
    import uuid
    import asyncio
    from ..services import OzonSyncService

    # 生成真实的任务ID
    task_id = f"task_{uuid.uuid4().hex[:12]}"

    # 立即初始化任务状态，避免查询时找不到
    from ..services.ozon_sync import SYNC_TASKS
    SYNC_TASKS[task_id] = {
        "status": "pending",
        "progress": 0,
        "message": "任务已创建，正在启动...",
        "started_at": utcnow().isoformat(),
        "type": sync_type,
        "shop_id": shop_id
    }

    # 根据同步类型执行不同的同步任务
    async def run_sync():
        logger.info(f"Starting async sync task: task_id={task_id}, sync_type={sync_type}")
        # 创建新的数据库会话用于异步任务
        from ef_core.database import get_db_manager
        db_manager = get_db_manager()
        async with db_manager.get_session() as task_db:
            try:
                logger.info(f"Database session created for task: {task_id}")
                if sync_type in ["all", "products"]:
                    await OzonSyncService.sync_products(shop_id, task_db, task_id, products_mode)

                if sync_type in ["all", "orders"]:
                    # 如果是全部同步，为订单生成新的任务ID
                    order_task_id = task_id if sync_type == "orders" else f"task_{uuid.uuid4().hex[:12]}"
                    logger.info(f"Calling sync_orders: shop_id={shop_id}, order_task_id={order_task_id}, mode={orders_mode}")
                    await OzonSyncService.sync_orders(shop_id, task_db, order_task_id, orders_mode)
                    logger.info(f"sync_orders completed for task: {order_task_id}")
            except Exception as e:
                logger.error(f"Sync failed: {e}")
                import traceback
                logger.error(traceback.format_exc())
                # 更新任务状态为失败
                SYNC_TASKS[task_id] = {
                    "status": "failed",
                    "progress": 0,
                    "message": f"同步失败: {str(e)}",
                    "error": str(e),
                    "completed_at": utcnow().isoformat(),
                    "type": sync_type
                }

    # 在后台启动同步任务（不等待完成）
    task = asyncio.create_task(run_sync())

    # 添加日志以确认任务已创建
    logger.info(f"Created async task for {sync_type} sync: task_id={task_id}, shop_id={shop_id}")

    return {
        "task_id": task_id,
        "status": "started",
        "sync_type": sync_type,
        "orders_mode": orders_mode if sync_type in ["all", "orders"] else None,
        "message": f"Sync {sync_type} started for shop {shop_id}"
    }

@router.get("/sync/task/{task_id}")
async def get_task_status(task_id: str):
    """获取同步任务状态"""
    from ..services import OzonSyncService

    status = OzonSyncService.get_task_status(task_id)

    if not status:
        raise HTTPException(status_code=404, detail="Task not found")

    return {
        "task_id": task_id,
        "status": status
    }

@router.get("/sync/status/debug")
async def debug_sync_status():
    """Debug endpoint to test sync status"""
    from ..services import OzonSyncService
    from ..services.ozon_sync import SYNC_TASKS
    from datetime import datetime

    # Add a test task
    SYNC_TASKS['debug_task'] = {
        'status': 'running',
        'progress': 75,
        'message': 'Debug task',
        'started_at': utcnow().isoformat()
    }

    # Get all tasks
    return {
        "ok": True,
        "tasks": SYNC_TASKS,
        "debug_task_status": OzonSyncService.get_task_status('debug_task')
    }

@router.get("/sync/status/{task_id}")
async def get_sync_status(
    task_id: str
):
    """获取同步任务状态"""
    # Simplified version for debugging
    from ..services.ozon_sync import SYNC_TASKS, OzonSyncService

    # Get the task status directly
    status = SYNC_TASKS.get(task_id)

    if not status:
        # Return a 404 response
        return {
            "ok": False,
            "error": {
                "status": 404,
                "detail": f"Task {task_id} not found"
            }
        }

    # Return the status
    return {
        "ok": True,
        "data": status
    }

# 商品管理端点
@router.get("/products")
async def get_products(
    page: int = Query(1, description="页码"),
    page_size: int = Query(20, le=100, description="每页数量"),
    # 保留offset/limit以兼容
    offset: Optional[int] = None,
    limit: Optional[int] = None,
    shop_id: Optional[int] = None,
    search: Optional[str] = Query(None, description="通用搜索（SKU、标题、offer_id、条码）"),
    sku: Optional[str] = None,
    title: Optional[str] = None,
    status: Optional[str] = None,
    price_min: Optional[float] = Query(None, description="最低价格"),
    price_max: Optional[float] = Query(None, description="最高价格"),
    stock_min: Optional[int] = Query(None, description="最低库存"),
    stock_max: Optional[int] = Query(None, description="最高库存"),
    has_stock: Optional[bool] = Query(None, description="是否有库存"),
    visibility: Optional[bool] = Query(None, description="是否可见"),
    archived: Optional[bool] = Query(None, description="是否归档"),
    category_id: Optional[int] = Query(None, description="类目ID"),
    brand: Optional[str] = Query(None, description="品牌"),
    sort_by: Optional[str] = Query("updated_at", description="排序字段：price,stock,created_at,updated_at,title"),
    sort_order: Optional[str] = Query("desc", description="排序方向：asc,desc"),
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """
    获取 Ozon 商品列表

    支持多种搜索和筛选方式：
    - 通用搜索：在SKU、标题、offer_id、条码中搜索
    - 精确筛选：按状态、价格范围、库存范围等
    - 灵活排序：支持多字段排序
    """
    from sqlalchemy import or_, and_, cast, Numeric

    # 处理分页参数
    if offset is None and limit is None:
        # 使用page和page_size
        offset = (page - 1) * page_size
        limit = page_size
    elif limit is None:
        limit = 50  # 默认limit

    # 构建查询
    query = select(OzonProduct)

    # 应用过滤条件
    if shop_id:
        query = query.where(OzonProduct.shop_id == shop_id)
    # 不再设置默认店铺，如果没有指定shop_id则返回所有店铺的商品

    # 通用搜索 - 在多个字段中搜索
    if search:
        search_term = f"%{search}%"
        # 对于纯数字搜索，也搜索ozon_sku字段
        search_conditions = [
            OzonProduct.sku.ilike(search_term),
            OzonProduct.title.ilike(search_term),
            OzonProduct.offer_id.ilike(search_term),
            OzonProduct.barcode.ilike(search_term) if OzonProduct.barcode else False
        ]

        # 如果搜索词是纯数字，也在ozon_sku字段中搜索
        if search.strip().isdigit():
            from sqlalchemy import Text
            search_conditions.append(cast(OzonProduct.ozon_sku, Text).ilike(search_term))

        query = query.where(or_(*search_conditions))

    # 特定字段搜索（优先级高于通用搜索）
    if sku:
        query = query.where(OzonProduct.sku.ilike(f"%{sku}%"))
    if title:
        query = query.where(OzonProduct.title.ilike(f"%{title}%"))
    if status:
        query = query.where(OzonProduct.status == status)

    # 价格范围筛选
    if price_min is not None:
        query = query.where(OzonProduct.price >= cast(price_min, Numeric))
    if price_max is not None:
        query = query.where(OzonProduct.price <= cast(price_max, Numeric))

    # 库存范围筛选
    if stock_min is not None:
        query = query.where(OzonProduct.stock >= stock_min)
    if stock_max is not None:
        query = query.where(OzonProduct.stock <= stock_max)

    # 库存状态筛选
    if has_stock is not None:
        if has_stock:
            query = query.where(OzonProduct.stock > 0)
        else:
            query = query.where(OzonProduct.stock == 0)

    # 可见性筛选
    if visibility is not None:
        query = query.where(OzonProduct.visibility == visibility)

    # 归档状态筛选
    if archived is not None:
        if archived:
            query = query.where(or_(OzonProduct.is_archived == True, OzonProduct.ozon_archived == True))
        else:
            query = query.where(and_(OzonProduct.is_archived == False, OzonProduct.ozon_archived == False))

    # 类目筛选
    if category_id:
        query = query.where(OzonProduct.category_id == category_id)

    # 品牌筛选
    if brand:
        query = query.where(OzonProduct.brand.ilike(f"%{brand}%"))
    
    # 执行查询获取总数
    total_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = total_result.scalar()

    # 添加排序
    sort_order_desc = sort_order.lower() == "desc"

    # 根据排序字段选择排序列
    if sort_by == "price":
        order_column = OzonProduct.price.desc() if sort_order_desc else OzonProduct.price.asc()
    elif sort_by == "stock":
        order_column = OzonProduct.stock.desc() if sort_order_desc else OzonProduct.stock.asc()
    elif sort_by == "created_at":
        order_column = OzonProduct.created_at.desc() if sort_order_desc else OzonProduct.created_at.asc()
    elif sort_by == "title":
        order_column = OzonProduct.title.desc() if sort_order_desc else OzonProduct.title.asc()
    else:  # 默认按updated_at
        order_column = OzonProduct.updated_at.desc() if sort_order_desc else OzonProduct.updated_at.asc()

    # 添加分页和排序
    query = query.offset(offset).limit(limit).order_by(order_column)
    
    # 执行查询
    result = await db.execute(query)
    products = result.scalars().all()
    
    # 计算统计信息 - 支持5种状态
    stats_query = select(
        func.count().filter(OzonProduct.status == 'on_sale').label('on_sale'),
        func.count().filter(OzonProduct.status == 'ready_to_sell').label('ready_to_sell'),
        func.count().filter(OzonProduct.status == 'error').label('error'),
        func.count().filter(OzonProduct.status == 'pending_modification').label('pending_modification'),
        func.count().filter(OzonProduct.status == 'inactive').label('inactive'),
        func.count().filter(OzonProduct.status == 'archived').label('archived'),
        # 保留旧字段以便前端过渡
        func.count().filter(OzonProduct.status == 'on_sale').label('active'),
        func.count().filter(OzonProduct.stock == 0).label('out_of_stock'),
        func.count().filter(OzonProduct.sync_status == 'failed').label('sync_failed')
    ).select_from(OzonProduct)
    
    if shop_id:
        stats_query = stats_query.where(OzonProduct.shop_id == shop_id)
    # 不再设置默认店铺
    
    stats_result = await db.execute(stats_query)
    stats = stats_result.first()
    
    # 构建响应，包含搜索信息
    response = {
        "data": [product.to_dict() for product in products],
        "total": total,
        "page": page if page else (offset // limit + 1) if limit else 1,
        "page_size": limit,
        "stats": {
            "on_sale": stats.on_sale if stats else 0,
            "ready_to_sell": stats.ready_to_sell if stats else 0,
            "error": stats.error if stats else 0,
            "pending_modification": stats.pending_modification if stats else 0,
            "inactive": stats.inactive if stats else 0,
            "archived": stats.archived if stats else 0,
            # 保留旧字段以便前端过渡
            "active": stats.active if stats else 0,
            "out_of_stock": stats.out_of_stock if stats else 0,
            "sync_failed": stats.sync_failed if stats else 0
        }
    }

    # 如果有搜索，添加搜索信息
    if search or sku or title or brand or any([
        price_min, price_max, stock_min, stock_max, has_stock is not None,
        visibility is not None, archived is not None, category_id
    ]):
        response["search_info"] = {
            "query": search or sku or title or brand,
            "filters_applied": {
                "status": status,
                "price_range": [price_min, price_max] if price_min or price_max else None,
                "stock_range": [stock_min, stock_max] if stock_min is not None or stock_max is not None else None,
                "has_stock": has_stock,
                "visibility": visibility,
                "archived": archived,
                "category_id": category_id,
                "brand": brand
            },
            "results_count": len(products),
            "sort": {"by": sort_by, "order": sort_order}
        }

    return response

@router.post("/products/sync")
async def sync_products(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """同步商品数据"""
    full_sync = request.get("full_sync", False)
    shop_id = request.get("shop_id")  # 必须明确指定店铺ID
    if not shop_id:
        raise HTTPException(status_code=400, detail="shop_id is required")
    
    # 从数据库获取店铺信息
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()
    
    if not shop:
        return {
            "success": False,
            "message": "店铺不存在",
            "error": "Shop not found"
        }
    
    # 使用 Ozon API 客户端获取商品
    from ..api.client import OzonAPIClient
    
    try:
        # 创建 API 客户端
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc  # 注意：实际生产环境应该解密
        )
        
        # 调用真实的 Ozon API (限制数量以减少API调用)
        try:
            products_data = await client.get_products(limit=10)  # 先测试少量商品
        except Exception as e:
            return {
                "success": False,
                "message": "获取商品数据失败",
                "error": f"Ozon API调用失败: {str(e)}"
            }
        
        if not products_data.get("result"):
            return {
                "success": False,
                "message": "获取商品数据失败", 
                "error": "No products data returned from Ozon API",
                "api_response": products_data
            }
        
        items = products_data["result"].get("items", [])
        
        # 同步商品到数据库
        synced_count = 0
        for item in items:
            # 获取商品详情（包含图片和完整信息）
            detailed_info = None
            images_from_api = None
            
            try:
                # 使用product_id获取详细信息
                logger.info(f"Getting details for product: {item.get('product_id', item.get('offer_id'))}")
                if item.get("product_id"):
                    detailed_info = await client.get_product_info(product_id=item["product_id"])
                elif item.get("offer_id"):
                    detailed_info = await client.get_product_info(offer_id=item["offer_id"])
                
                # 打印完整的API响应结构来调试
                import json
                if detailed_info:
                    logger.info(f"Product detail API complete response: {json.dumps(detailed_info, indent=2, ensure_ascii=False)}")
                else:
                    logger.warning("No detailed_info received from API")
                
                if detailed_info and detailed_info.get("result"):
                    product_detail = detailed_info["result"]
                    logger.info(f"Product detail keys: {list(product_detail.keys())}")
                    
                    # 提取图片信息 - 先查看所有可能的图片字段
                    images_fields = ["images", "image", "primary_image", "media", "photos", "pictures"]
                    for field in images_fields:
                        if product_detail.get(field):
                            logger.info(f"Found images in field '{field}': {product_detail[field]}")
                    
                    # 提取图片信息
                    if product_detail.get("images"):
                        images = product_detail["images"]
                        logger.info(f"Images structure: {images}")
                        if images:
                            images_from_api = {
                                "primary": images[0].get("original_url") or images[0].get("url"),
                                "additional": [
                                    img.get("original_url") or img.get("url")
                                    for img in images[1:] if img.get("original_url") or img.get("url")
                                ],
                                "count": len(images)
                            }
                            logger.info(f"Extracted images_from_api: {images_from_api}")
                    
                    # 更新商品信息为详细信息
                    if product_detail.get("name"):
                        item["name"] = product_detail["name"]
                    if product_detail.get("description"):
                        item["description"] = product_detail["description"]
                    if product_detail.get("category_id"):
                        item["category_id"] = product_detail["category_id"]
                    if product_detail.get("brand"):
                        item["brand"] = product_detail["brand"]
                    if product_detail.get("barcode"):
                        item["barcode"] = product_detail["barcode"]
                        
            except Exception as e:
                logger.warning(f"Failed to get detailed info for product {item.get('product_id', item.get('offer_id'))}: {e}")
                # 继续使用基本信息
            
            # 添加延迟以避免API限流
            import asyncio
            await asyncio.sleep(0.2)  # 200ms延迟
            # 查找或创建商品
            existing = await db.execute(
                select(OzonProduct).where(
                    OzonProduct.shop_id == shop_id,
                    OzonProduct.offer_id == item.get("offer_id", "")
                )
            )
            product = existing.scalar_one_or_none()
            
            # 处理图片信息：优先使用API获取的真实图片
            images_data = images_from_api  # 使用从API获取的图片数据
            
            if not product:
                product = OzonProduct(
                    shop_id=shop_id,
                    sku=item.get("offer_id", ""),
                    offer_id=item.get("offer_id", ""),
                    ozon_product_id=item.get("product_id"),
                    ozon_sku=item.get("sku"),
                    title=item.get("name", "未知商品"),
                    description=item.get("description"),
                    barcode=item.get("barcode"),
                    category_id=item.get("category_id"),
                    brand=item.get("brand"),
                    status="active" if item.get("is_visible") else "inactive",
                    visibility=item.get("is_visible", False),
                    is_archived=item.get("is_archived", False),
                    price=Decimal(str(item.get("price", "0"))) if item.get("price") else None,
                    old_price=Decimal(str(item.get("old_price", "0"))) if item.get("old_price") else None,
                    stock=item.get("stocks", {}).get("present", 0),
                    available=item.get("stocks", {}).get("available", 0),
                    reserved=item.get("stocks", {}).get("reserved", 0),
                    images=images_data,
                    sync_status="success",
                    last_sync_at=datetime.now()
                )
                db.add(product)
            else:
                # 更新现有商品
                product.title = item.get("name", product.title)
                if item.get("description"):
                    product.description = item.get("description")
                if item.get("brand"):
                    product.brand = item.get("brand")
                if item.get("barcode"):
                    product.barcode = item.get("barcode")
                if item.get("category_id"):
                    product.category_id = item.get("category_id")
                product.ozon_product_id = item.get("product_id")
                product.ozon_sku = item.get("sku")
                product.status = "active" if item.get("is_visible") else "inactive"
                product.visibility = item.get("is_visible", False)
                product.is_archived = item.get("is_archived", False)
                if item.get("price"):
                    product.price = Decimal(str(item.get("price")))
                if item.get("old_price"):
                    product.old_price = Decimal(str(item.get("old_price")))
                product.stock = item.get("stocks", {}).get("present", 0)
                product.available = item.get("stocks", {}).get("available", 0)
                product.reserved = item.get("stocks", {}).get("reserved", 0)
                if images_data:
                    product.images = images_data
                product.sync_status = "success"
                product.last_sync_at = datetime.now()
            
            synced_count += 1
        
        await db.commit()
        
        return {
            "success": True,
            "message": f"成功同步 {synced_count} 个商品",
            "synced_count": synced_count,
            "sync_type": "full" if full_sync else "incremental"
        }
        
    except Exception as e:
        return {
            "success": False,
            "message": "同步失败",
            "error": str(e)
        }

@router.post("/products/prices")
async def update_prices(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """批量更新商品价格"""
    updates = request.get("updates", [])
    shop_id = request.get("shop_id")  # 必须明确指定店铺ID
    if not shop_id:
        raise HTTPException(status_code=400, detail="shop_id is required")

    if not updates:
        return {
            "success": False,
            "message": "未提供价格更新数据"
        }

    try:
        # 获取店铺信息
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            return {
                "success": False,
                "message": "店铺不存在"
            }

        updated_count = 0
        errors = []

        # 创建Ozon API客户端
        from ..api.client import OzonAPIClient
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc
        )

        for update in updates:
            sku = update.get("sku")
            new_price = update.get("price")
            old_price = update.get("old_price")

            if not sku or new_price is None:
                errors.append(f"SKU {sku}: 缺少必要字段")
                continue

            try:
                # 查找本地商品
                product_result = await db.execute(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.sku == sku
                    )
                )
                product = product_result.scalar_one_or_none()

                if not product:
                    errors.append(f"SKU {sku}: 商品不存在")
                    continue

                # 调用Ozon API更新价格
                price_data = {
                    "prices": [{
                        "offer_id": product.offer_id,
                        "price": str(new_price),
                        "old_price": str(old_price) if old_price else "",
                        "product_id": product.ozon_product_id
                    }]
                }

                api_result = await client.update_prices(price_data)

                if api_result.get("result"):
                    # 更新本地数据库
                    product.price = Decimal(str(new_price))
                    if old_price:
                        product.old_price = Decimal(str(old_price))
                    product.updated_at = datetime.now()

                    updated_count += 1
                else:
                    errors.append(f"SKU {sku}: Ozon API更新失败")

            except Exception as e:
                errors.append(f"SKU {sku}: {str(e)}")

        await db.commit()

        result = {
            "success": True,
            "message": f"成功更新 {updated_count} 个商品价格",
            "updated_count": updated_count
        }

        if errors:
            result["errors"] = errors[:10]  # 最多显示10个错误
            if len(errors) > 10:
                result["errors"].append(f"还有 {len(errors) - 10} 个错误未显示...")

        return result

    except Exception as e:
        logger.error(f"Price update failed: {e}")
        return {
            "success": False,
            "message": f"价格更新失败: {str(e)}"
        }

@router.post("/products/stocks")
async def update_stocks(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """批量更新商品库存"""
    updates = request.get("updates", [])
    shop_id = request.get("shop_id")  # 必须明确指定店铺ID
    if not shop_id:
        raise HTTPException(status_code=400, detail="shop_id is required")

    if not updates:
        return {
            "success": False,
            "message": "未提供库存更新数据"
        }

    try:
        # 获取店铺信息
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            return {
                "success": False,
                "message": "店铺不存在"
            }

        updated_count = 0
        errors = []

        # 创建Ozon API客户端
        from ..api.client import OzonAPIClient
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc
        )

        for update in updates:
            sku = update.get("sku")
            stock = update.get("stock")
            warehouse_id = update.get("warehouse_id", 1)

            if not sku or stock is None:
                errors.append(f"SKU {sku}: 缺少必要字段")
                continue

            try:
                # 查找本地商品
                product_result = await db.execute(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.sku == sku
                    )
                )
                product = product_result.scalar_one_or_none()

                if not product:
                    errors.append(f"SKU {sku}: 商品不存在")
                    continue

                # 调用Ozon API更新库存
                stock_data = {
                    "stocks": [{
                        "offer_id": product.offer_id,
                        "product_id": product.ozon_product_id,
                        "stock": int(stock),
                        "warehouse_id": warehouse_id
                    }]
                }

                api_result = await client.update_stocks(stock_data)

                if api_result.get("result"):
                    # 更新本地数据库
                    product.stock = int(stock)
                    product.available = int(stock)  # 简化：认为所有库存都可用
                    product.updated_at = datetime.now()

                    updated_count += 1
                else:
                    errors.append(f"SKU {sku}: Ozon API更新失败")

            except Exception as e:
                errors.append(f"SKU {sku}: {str(e)}")

        await db.commit()

        result = {
            "success": True,
            "message": f"成功更新 {updated_count} 个商品库存",
            "updated_count": updated_count
        }

        if errors:
            result["errors"] = errors[:10]  # 最多显示10个错误
            if len(errors) > 10:
                result["errors"].append(f"还有 {len(errors) - 10} 个错误未显示...")

        return result

    except Exception as e:
        logger.error(f"Stock update failed: {e}")
        return {
            "success": False,
            "message": f"库存更新失败: {str(e)}"
        }

# 单个商品操作端点
@router.post("/products/{product_id}/sync")
async def sync_single_product(
    product_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """同步单个商品"""
    # 获取商品信息
    result = await db.execute(
        select(OzonProduct).where(OzonProduct.id == product_id)
    )
    product = result.scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    try:
        # 获取店铺信息
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == product.shop_id)
        )
        shop = shop_result.scalar_one_or_none()
        
        if not shop:
            raise HTTPException(status_code=404, detail="Shop not found")
        
        # 创建API客户端
        from ..api.client import OzonAPIClient
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc
        )
        
        # 获取商品详情（使用offer_id）
        product_info = await client.get_product_info(product.offer_id)
        
        if product_info.get("result"):
            item = product_info["result"]
            # 更新商品信息
            product.title = item.get("name", product.title)
            product.ozon_product_id = item.get("product_id")
            product.ozon_sku = item.get("sku")
            product.status = "active" if item.get("is_visible") else "inactive"
            product.visibility = item.get("is_visible", False)
            product.is_archived = item.get("is_archived", False)
            if item.get("price"):
                product.price = Decimal(str(item.get("price")))
            if item.get("old_price"):
                product.old_price = Decimal(str(item.get("old_price")))
            product.sync_status = "success"
            product.last_sync_at = datetime.now()
            
            await db.commit()
            
            return {
                "success": True,
                "message": f"商品 {product.title} 同步成功"
            }
        else:
            product.sync_status = "failed"
            product.sync_error = "Failed to fetch product info from Ozon"
            await db.commit()
            
            return {
                "success": False,
                "message": "从Ozon获取商品信息失败"
            }
            
    except Exception as e:
        product.sync_status = "failed"
        product.sync_error = str(e)
        await db.commit()
        
        return {
            "success": False,
            "message": f"同步失败: {str(e)}"
        }

@router.put("/products/{product_id}")
async def update_product(
    product_id: int,
    product_data: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
):
    """更新商品信息"""
    # 获取商品
    result = await db.execute(
        select(OzonProduct).where(OzonProduct.id == product_id)
    )
    product = result.scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    try:
        # 更新可编辑字段
        if "title" in product_data:
            product.title = product_data["title"]
        if "sku" in product_data:
            product.sku = product_data["sku"]
        if "price" in product_data and product_data["price"] is not None:
            product.price = Decimal(str(product_data["price"]))
        if "old_price" in product_data and product_data["old_price"] is not None:
            product.old_price = Decimal(str(product_data["old_price"]))
        if "stock" in product_data and product_data["stock"] is not None:
            product.stock = int(product_data["stock"])
        if "available" in product_data and product_data["available"] is not None:
            product.available = int(product_data["available"])
        if "description" in product_data:
            if not product.attributes:
                product.attributes = {}
            product.attributes["description"] = product_data["description"]
        if "category_id" in product_data and product_data["category_id"] is not None:
            product.category_id = int(product_data["category_id"])
        if "barcode" in product_data:
            product.barcode = product_data["barcode"]
        if "visibility" in product_data:
            product.visibility = bool(product_data["visibility"])
            product.status = "active" if product.visibility else "inactive"
        
        product.updated_at = datetime.now()
        await db.commit()
        
        return {
            "success": True,
            "message": "商品信息更新成功",
            "data": product.to_dict()
        }
        
    except Exception as e:
        return {
            "success": False,
            "message": f"更新失败: {str(e)}"
        }

@router.post("/products/{product_id}/archive")
async def archive_product(
    product_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """归档商品"""
    # 获取商品
    result = await db.execute(
        select(OzonProduct).where(OzonProduct.id == product_id)
    )
    product = result.scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    try:
        product.is_archived = True
        product.status = "archived"
        product.visibility = False
        product.updated_at = datetime.now()
        
        await db.commit()
        
        return {
            "success": True,
            "message": f"商品 {product.title} 已归档"
        }
        
    except Exception as e:
        return {
            "success": False,
            "message": f"归档失败: {str(e)}"
        }

@router.delete("/products/{product_id}")
async def delete_product(
    product_id: int,
    db: AsyncSession = Depends(get_async_session)
):
    """删除商品"""
    # 获取商品
    result = await db.execute(
        select(OzonProduct).where(OzonProduct.id == product_id)
    )
    product = result.scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    try:
        title = product.title
        await db.delete(product)
        await db.commit()
        
        return {
            "success": True,
            "message": f"商品 {title} 已删除"
        }
        
    except Exception as e:
        return {
            "success": False,
            "message": f"删除失败: {str(e)}"
        }

@router.post("/products/export")
async def export_products(
    request: Dict[str, Any] = {},
    db: AsyncSession = Depends(get_async_session)
):
    """导出商品数据为CSV"""
    import csv
    import io
    from fastapi.responses import StreamingResponse
    
    shop_id = request.get("shop_id")  # 必须明确指定店铺ID
    if not shop_id:
        raise HTTPException(status_code=400, detail="shop_id is required")
    
    # 获取商品数据
    query = select(OzonProduct).where(OzonProduct.shop_id == shop_id)
    result = await db.execute(query)
    products = result.scalars().all()
    
    # 创建CSV内容
    output = io.StringIO()
    writer = csv.writer(output)
    
    # CSV标题行
    writer.writerow([
        'SKU', '商品名称', '价格', '原价', '库存', '可用库存', 
        '分类ID', '条码', '状态', '可见性', '归档状态', '最后同步时间'
    ])
    
    # 写入数据行
    for product in products:
        writer.writerow([
            product.sku or '',
            product.title or '',
            str(product.price) if product.price else '',
            str(product.old_price) if product.old_price else '',
            product.stock or 0,
            product.available or 0,
            product.category_id or '',
            product.barcode or '',
            product.status or '',
            '是' if product.visibility else '否',
            '是' if product.is_archived else '否',
            product.last_sync_at.strftime('%Y-%m-%d %H:%M:%S') if product.last_sync_at else ''
        ])
    
    output.seek(0)
    
    # 返回CSV文件
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8-sig')),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=products_export.csv"}
    )

@router.post("/products/import")
async def import_products(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session)
):
    """导入商品数据"""
    import csv
    import io
    import base64
    
    try:
        # 获取上传的文件内容
        file_content = request.get("file_content", "")
        shop_id = request.get("shop_id")  # 必须明确指定店铺ID

        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")
        
        if not file_content:
            return {
                "success": False,
                "message": "未提供文件内容"
            }
        
        # 解码base64文件内容
        try:
            decoded_content = base64.b64decode(file_content).decode('utf-8-sig')
        except Exception:
            return {
                "success": False,
                "message": "文件内容格式错误"
            }
        
        # 解析CSV
        csv_reader = csv.DictReader(io.StringIO(decoded_content))
        
        imported_count = 0
        errors = []
        
        for row_num, row in enumerate(csv_reader, start=2):
            try:
                sku = row.get('SKU', '').strip()
                if not sku:
                    errors.append(f"第{row_num}行：SKU不能为空")
                    continue
                
                # 查找现有商品
                existing = await db.execute(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.sku == sku
                    )
                )
                product = existing.scalar_one_or_none()
                
                if not product:
                    # 创建新商品
                    product = OzonProduct(
                        shop_id=shop_id,
                        sku=sku,
                        offer_id=sku,
                        title=row.get('商品名称', '').strip(),
                        price=Decimal(str(row.get('价格', 0))) if row.get('价格') else None,
                        old_price=Decimal(str(row.get('原价', 0))) if row.get('原价') else None,
                        stock=int(row.get('库存', 0)) if row.get('库存') else 0,
                        available=int(row.get('可用库存', 0)) if row.get('可用库存') else 0,
                        category_id=int(row.get('分类ID')) if row.get('分类ID') else None,
                        barcode=row.get('条码', '').strip() or None,
                        status=row.get('状态', 'active').strip(),
                        visibility=row.get('可见性', '').strip() in ['是', 'true', '1', 'yes'],
                        is_archived=row.get('归档状态', '').strip() in ['是', 'true', '1', 'yes'],
                        sync_status="imported",
                        last_sync_at=datetime.now()
                    )
                    db.add(product)
                else:
                    # 更新现有商品
                    if row.get('商品名称'):
                        product.title = row.get('商品名称').strip()
                    if row.get('价格'):
                        product.price = Decimal(str(row.get('价格')))
                    if row.get('原价'):
                        product.old_price = Decimal(str(row.get('原价')))
                    if row.get('库存'):
                        product.stock = int(row.get('库存'))
                    if row.get('可用库存'):
                        product.available = int(row.get('可用库存'))
                    if row.get('分类ID'):
                        product.category_id = int(row.get('分类ID'))
                    if row.get('条码'):
                        product.barcode = row.get('条码').strip()
                    if row.get('状态'):
                        product.status = row.get('状态').strip()
                    if row.get('可见性'):
                        product.visibility = row.get('可见性').strip() in ['是', 'true', '1', 'yes']
                    if row.get('归档状态'):
                        product.is_archived = row.get('归档状态').strip() in ['是', 'true', '1', 'yes']
                    product.sync_status = "imported"
                    product.last_sync_at = datetime.now()
                
                imported_count += 1
                
            except Exception as e:
                errors.append(f"第{row_num}行：{str(e)}")
        
        await db.commit()
        
        result = {
            "success": True,
            "message": f"成功导入 {imported_count} 个商品",
            "imported_count": imported_count
        }
        
        if errors:
            result["warnings"] = errors[:10]  # 最多显示10个错误
            if len(errors) > 10:
                result["warnings"].append(f"还有 {len(errors) - 10} 个错误未显示...")
        
        return result
        
    except Exception as e:
        return {
            "success": False,
            "message": f"导入失败: {str(e)}"
        }

# 订单管理端点
@router.get("/orders")
async def get_orders(
    offset: int = 0,
    limit: int = Query(50, le=100),
    shop_id: Optional[int] = None,
    status: Optional[str] = None,
    posting_number: Optional[str] = None,
    customer_phone: Optional[str] = None,
    order_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
):
    """获取 Ozon 订单列表，支持多种搜索条件"""
    from datetime import datetime

    # 构建查询（使用 selectinload 避免懒加载问题）
    from sqlalchemy.orm import selectinload
    query = select(OzonOrder).options(
        selectinload(OzonOrder.postings).selectinload(OzonPosting.packages),
        selectinload(OzonOrder.items),
        selectinload(OzonOrder.refunds)
    )

    # 应用过滤条件
    if shop_id:
        query = query.where(OzonOrder.shop_id == shop_id)
    # 不再设置默认店铺

    if status:
        query = query.where(OzonOrder.status == status)

    # 搜索条件
    if posting_number:
        # 搜索订单号、Ozon订单号或通过posting关联
        query = query.outerjoin(OzonPosting, OzonOrder.id == OzonPosting.order_id).where(
            (OzonOrder.ozon_order_number.ilike(f"%{posting_number}%")) |
            (OzonOrder.ozon_order_id.ilike(f"%{posting_number}%")) |
            (OzonPosting.posting_number.ilike(f"%{posting_number}%"))
        )

    if customer_phone:
        query = query.where(OzonOrder.customer_phone.ilike(f"%{customer_phone}%"))

    if order_type:
        query = query.where(OzonOrder.order_type == order_type)

    if date_from:
        try:
            # 使用datetime_utils统一处理日期解析（确保UTC timezone-aware）
            start_date = parse_date(date_from)
            if start_date:
                query = query.where(OzonOrder.ordered_at >= start_date)
        except Exception as e:
            logger.warning(f"Failed to parse date_from: {date_from}, error: {e}")

    if date_to:
        try:
            # 使用datetime_utils统一处理日期解析（确保UTC timezone-aware）
            end_date = parse_date(date_to)
            if end_date:
                # 如果是纯日期格式，设置为当天的23:59:59
                if 'T' not in date_to:
                    end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
                query = query.where(OzonOrder.ordered_at <= end_date)
        except Exception as e:
            logger.warning(f"Failed to parse date_to: {date_to}, error: {e}")

    # 执行查询获取总数（重新构建查询以避免 subquery 问题）
    count_query = select(func.count(OzonOrder.id))

    # 应用相同的过滤条件
    if shop_id:
        count_query = count_query.where(OzonOrder.shop_id == shop_id)
    if status:
        count_query = count_query.where(OzonOrder.status == status)
    if posting_number:
        count_query = count_query.outerjoin(OzonPosting, OzonOrder.id == OzonPosting.order_id).where(
            (OzonOrder.ozon_order_number.ilike(f"%{posting_number}%")) |
            (OzonOrder.ozon_order_id.ilike(f"%{posting_number}%")) |
            (OzonPosting.posting_number.ilike(f"%{posting_number}%"))
        )
    if customer_phone:
        count_query = count_query.where(OzonOrder.customer_phone.ilike(f"%{customer_phone}%"))
    if order_type:
        count_query = count_query.where(OzonOrder.order_type == order_type)
    if date_from:
        try:
            start_date = parse_date(date_from)
            if start_date:
                count_query = count_query.where(OzonOrder.ordered_at >= start_date)
        except:
            pass
    if date_to:
        try:
            end_date = parse_date(date_to)
            if end_date:
                if 'T' not in date_to:
                    end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
                count_query = count_query.where(OzonOrder.ordered_at <= end_date)
        except:
            pass

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 计算全局统计（所有状态，不受当前status筛选影响）
    # 只按shop_id筛选，包含所有状态的统计
    stats_query = select(
        OzonOrder.status,
        func.count(OzonOrder.id).label('count')
    )
    if shop_id:
        stats_query = stats_query.where(OzonOrder.shop_id == shop_id)
    stats_query = stats_query.group_by(OzonOrder.status)

    stats_result = await db.execute(stats_query)
    status_counts = {row.status: row.count for row in stats_result}

    # 构建统计数据字典
    global_stats = {
        "total": sum(status_counts.values()),
        "awaiting_packaging": status_counts.get('awaiting_packaging', 0),
        "awaiting_deliver": status_counts.get('awaiting_deliver', 0),
        "delivering": status_counts.get('delivering', 0),
        "delivered": status_counts.get('delivered', 0),
        "cancelled": status_counts.get('cancelled', 0),
        # 其他可能的状态
        "pending": status_counts.get('pending', 0),
        "processing": status_counts.get('processing', 0),
        "confirmed": status_counts.get('confirmed', 0),
    }

    # 添加分页
    query = query.offset(offset).limit(limit).order_by(OzonOrder.ordered_at.desc())

    # 执行查询
    result = await db.execute(query)
    orders = result.scalars().all()

    # 提取所有订单中的offer_id
    all_offer_ids = set()
    for order in orders:
        if order.items:
            for item in order.items:
                if item.offer_id:
                    all_offer_ids.add(item.offer_id)

    # 批量查询商品图片（使用offer_id匹配）
    offer_id_images = {}
    if all_offer_ids:
        product_query = select(OzonProduct.offer_id, OzonProduct.images).where(OzonProduct.offer_id.in_(list(all_offer_ids)))
        if shop_id:
            product_query = product_query.where(OzonProduct.shop_id == shop_id)
        products_result = await db.execute(product_query)
        for offer_id, images in products_result:
            if offer_id and images:
                # 优先使用primary图片，否则使用第一张
                if isinstance(images, dict):
                    if images.get("primary"):
                        offer_id_images[offer_id] = images["primary"]
                    elif images.get("main") and isinstance(images["main"], list) and images["main"]:
                        offer_id_images[offer_id] = images["main"][0]
                elif isinstance(images, list) and images:
                    offer_id_images[offer_id] = images[0]

    # 将图片信息添加到订单数据中
    orders_data = []
    for order in orders:
        order_dict = order.to_dict()
        # 为每个订单项添加图片
        if order_dict.get("items"):
            for item in order_dict["items"]:
                if item.get("offer_id") and item["offer_id"] in offer_id_images:
                    item["image"] = offer_id_images[item["offer_id"]]
        orders_data.append(order_dict)

    return {
        "data": orders_data,
        "total": total,
        "offset": offset,
        "limit": limit,
        "stats": global_stats,  # 全局统计数据
        "offer_id_images": offer_id_images  # 额外返回offer_id图片映射，前端可选使用
    }

@router.put("/orders/{posting_number}/extra-info")
async def update_order_extra_info(
    posting_number: str,
    extra_info: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_async_session)
):
    """
    更新订单额外信息（进货价格、国内运单号、材料费用、备注）
    """
    from decimal import Decimal

    # 通过 posting_number 查找订单（先查 posting，再找 order）
    posting_result = await db.execute(
        select(OzonPosting).where(OzonPosting.posting_number == posting_number)
    )
    posting = posting_result.scalar_one_or_none()

    if not posting:
        raise HTTPException(status_code=404, detail="Posting not found")

    # 获取关联的订单
    result = await db.execute(
        select(OzonOrder).where(OzonOrder.id == posting.order_id)
    )
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # 更新字段
    if "purchase_price" in extra_info:
        order.purchase_price = Decimal(str(extra_info["purchase_price"])) if extra_info["purchase_price"] else None
        order.purchase_price_updated_at = utcnow()  # 记录进货价格更新时间
    if "domestic_tracking_number" in extra_info:
        order.domestic_tracking_number = extra_info["domestic_tracking_number"]
        order.domestic_tracking_updated_at = utcnow()  # 记录国内物流单号更新时间
    if "material_cost" in extra_info:
        order.material_cost = Decimal(str(extra_info["material_cost"])) if extra_info["material_cost"] else None
    if "order_notes" in extra_info:
        order.order_notes = extra_info["order_notes"]
    if "source_platform" in extra_info:
        order.source_platform = extra_info["source_platform"]

    # 更新时间戳
    order.updated_at = utcnow()

    await db.commit()
    await db.refresh(order)

    from ..utils.serialization import format_currency

    return {
        "success": True,
        "message": "Order extra info updated successfully",
        "data": {
            "posting_number": posting.posting_number,
            "purchase_price": format_currency(order.purchase_price),
            "domestic_tracking_number": order.domestic_tracking_number,
            "material_cost": format_currency(order.material_cost),
            "order_notes": order.order_notes,
            "source_platform": order.source_platform,
            "purchase_price_updated_at": order.purchase_price_updated_at.isoformat() if order.purchase_price_updated_at else None,
            "domestic_tracking_updated_at": order.domestic_tracking_updated_at.isoformat() if order.domestic_tracking_updated_at else None
        }
    }

@router.get("/orders/{posting_number}")
async def get_order_detail(
    posting_number: str,
    shop_id: Optional[int] = Query(None, description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取订单详情
    通过posting_number获取单个订单的完整信息
    """
    # 通过 posting_number 查找订单（先查 posting，再找 order）
    posting_query = select(OzonPosting).where(OzonPosting.posting_number == posting_number)

    if shop_id:
        posting_query = posting_query.where(OzonPosting.shop_id == shop_id)

    posting_result = await db.execute(posting_query)
    posting = posting_result.scalar_one_or_none()

    if not posting:
        raise HTTPException(status_code=404, detail="Posting not found")

    # 获取关联的订单
    query = select(OzonOrder).where(OzonOrder.id == posting.order_id)

    if False:  # shop_id 已经在 posting 查询中检查过了
        query = query.where(OzonOrder.shop_id == shop_id)

    # 执行查询
    result = await db.execute(query)
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(
            status_code=404,
            detail=f"Order with posting_number {posting_number} not found"
        )

    # 获取订单详细信息
    order_dict = order.to_dict()

    # 为订单商品添加图片信息
    if order_dict.get("items"):
        offer_ids = [item.get("offer_id") for item in order_dict["items"] if item.get("offer_id")]

        if offer_ids:
            # 批量查询商品图片
            products_result = await db.execute(
                select(OzonProduct.offer_id, OzonProduct.images, OzonProduct.name, OzonProduct.price)
                .where(OzonProduct.offer_id.in_(offer_ids))
                .where(OzonProduct.shop_id == order.shop_id)
            )

            product_info = {}
            for offer_id, images, name, price in products_result:
                if offer_id:
                    product_info[offer_id] = {
                        "name": name,
                        "price": str(price) if price else None,
                        "image": None
                    }

                    if images:
                        # 优先使用primary图片
                        if isinstance(images, dict):
                            if images.get("primary"):
                                product_info[offer_id]["image"] = images["primary"]
                            elif images.get("main") and isinstance(images["main"], list) and images["main"]:
                                product_info[offer_id]["image"] = images["main"][0]
                        elif isinstance(images, list) and images:
                            product_info[offer_id]["image"] = images[0]

            # 将商品信息合并到订单项中
            for item in order_dict["items"]:
                if item.get("offer_id") and item["offer_id"] in product_info:
                    item.update(product_info[item["offer_id"]])

    # 添加额外的订单汇总信息
    order_summary = {
        "total_items": len(order_dict.get("items", [])),
        "total_quantity": sum(item.get("quantity", 0) for item in order_dict.get("items", [])),
        "has_barcodes": bool(order_dict.get("upper_barcode") or order_dict.get("lower_barcode")),
        "has_cancellation": bool(order_dict.get("cancel_reason") or order_dict.get("cancel_reason_id")),
        "sync_info": {
            "mode": order_dict.get("sync_mode"),
            "version": order_dict.get("sync_version"),
            "last_sync": order_dict.get("last_sync_at"),
            "status": order_dict.get("sync_status")
        }
    }

    return {
        "success": True,
        "data": order_dict,
        "summary": order_summary
    }

@router.post("/orders/sync")
async def sync_orders(
    shop_id: int = Body(...),
    mode: str = Body("incremental", description="同步模式: full-全量同步, incremental-增量同步"),
    db: AsyncSession = Depends(get_async_session)
    # current_user: User = Depends(get_current_user)  # Временно отключено为развития
):
    """
    同步订单数据
    - full: 全量同步，获取店铺所有历史订单
    - incremental: 增量同步，获取最近7天的订单更新
    """
    
    # 验证同步模式
    if mode not in ["full", "incremental"]:
        return {
            "success": False,
            "message": "无效的同步模式",
            "error": f"Mode must be 'full' or 'incremental', got '{mode}'"
        }

    # 生成任务ID
    import uuid
    import asyncio
    task_id = f"order_sync_{uuid.uuid4().hex[:12]}"

    # 异步执行同步任务
    from ..services import OzonSyncService

    async def run_sync():
        """在后台执行同步任务"""
        try:
            # 创建新的数据库会话用于异步任务
            from ef_core.database import get_db_manager
            db_manager = get_db_manager()
            async with db_manager.get_session() as task_db:
                result = await OzonSyncService.sync_orders(shop_id, task_db, task_id, mode)
                logger.info(f"Order sync completed: {result}")
        except Exception as e:
            logger.error(f"Order sync failed: {e}")
            import traceback
            logger.error(traceback.format_exc())

    # 在后台启动同步任务
    asyncio.create_task(run_sync())

    return {
        "success": True,
        "message": f"订单{'全量' if mode == 'full' else '增量'}同步已启动",
        "task_id": task_id,
        "sync_mode": mode
    }


@router.get("/sync-logs")
async def get_sync_logs(
    shop_id: Optional[int] = Query(None, description="店铺ID"),
    entity_type: Optional[str] = Query(None, description="实体类型"),
    status: Optional[str] = Query(None, description="状态"),
    limit: int = Query(20, ge=1, le=100, description="返回数量"),
    offset: int = Query(0, ge=0, description="偏移量"),
    session: AsyncSession = Depends(get_async_session)
):
    """
    获取同步日志
    
    Args:
        shop_id: 店铺ID筛选
        entity_type: 实体类型筛选 (products/orders/postings/inventory)
        status: 状态筛选 (started/success/failed/partial)
        limit: 返回数量
        offset: 偏移量
    
    Returns:
        同步日志列表
    """
    from ..models.sync import OzonSyncLog
    from sqlalchemy import select, desc, and_, func
    from datetime import datetime
    
    try:
        # 构建查询条件
        conditions = []
        if shop_id:
            conditions.append(OzonSyncLog.shop_id == shop_id)
        if entity_type:
            conditions.append(OzonSyncLog.entity_type == entity_type)
        if status:
            conditions.append(OzonSyncLog.status == status)
        
        # 查询总数
        count_stmt = select(func.count()).select_from(OzonSyncLog)
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        total = await session.scalar(count_stmt)
        
        # 查询数据
        stmt = select(OzonSyncLog)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(desc(OzonSyncLog.started_at))
        stmt = stmt.limit(limit).offset(offset)
        
        result = await session.execute(stmt)
        logs = result.scalars().all()
        
        # 转换为活动记录格式
        activities = []
        for log in logs:
            # 根据实体类型和状态生成描述
            action_map = {
                "products": "商品",
                "orders": "订单",
                "postings": "发货单",
                "inventory": "库存"
            }
            
            status_map = {
                "started": "开始",
                "success": "成功",
                "failed": "失败",
                "partial": "部分成功"
            }
            
            entity_name = action_map.get(log.entity_type, log.entity_type)
            status_name = status_map.get(log.status, log.status)
            
            # 生成内容描述
            if log.status == "success":
                content = f"{entity_name}同步成功，处理 {log.processed_count} 条记录"
            elif log.status == "failed":
                content = f"{entity_name}同步失败: {log.error_message or '未知错误'}"
            elif log.status == "partial":
                content = f"{entity_name}部分同步，成功 {log.success_count}/{log.processed_count} 条"
            else:
                content = f"{entity_name}同步{status_name}"
            
            # 计算相对时间
            time_diff = utcnow() - log.started_at
            if time_diff.days > 0:
                time_str = f"{time_diff.days}天前"
            elif time_diff.seconds > 3600:
                time_str = f"{time_diff.seconds // 3600}小时前"
            elif time_diff.seconds > 60:
                time_str = f"{time_diff.seconds // 60}分钟前"
            else:
                time_str = "刚刚"
            
            activities.append({
                "id": log.id,
                "type": log.entity_type,
                "status": log.status,
                "content": content,
                "time": time_str,
                "details": {
                    "shop_id": log.shop_id,
                    "sync_type": log.sync_type,
                    "processed": log.processed_count,
                    "success": log.success_count,
                    "failed": log.failed_count,
                    "duration_ms": log.duration_ms,
                    "started_at": log.started_at.isoformat() if log.started_at else None,
                    "completed_at": log.completed_at.isoformat() if log.completed_at else None
                }
            })
        
        return {
            "activities": activities,
            "total": total,
            "limit": limit,
            "offset": offset
        }
    except Exception as e:
        logger.error(f"Failed to get sync logs: {e}")
        return {
            "activities": [],
            "total": 0,
            "limit": limit,
            "offset": offset,
            "error": str(e)
        }


@router.get("/statistics")
async def get_statistics(
    shop_id: Optional[int] = Query(None, description="店铺ID，为空时获取所有店铺统计"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取统计数据

    Args:
        shop_id: 店铺ID，可选
        db: 数据库会话

    Returns:
        统计数据
    """
    from ..models import OzonShop, OzonProduct, OzonOrder
    from sqlalchemy import select, func
    from decimal import Decimal

    try:
        # 构建查询条件
        product_filter = []
        order_filter = []

        if shop_id:
            product_filter.append(OzonProduct.shop_id == shop_id)
            order_filter.append(OzonOrder.shop_id == shop_id)

        # 商品统计 - 使用新的5种状态
        product_total_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(*product_filter)
        )
        product_total = product_total_result.scalar() or 0

        # 统计各种状态的商品数量
        product_on_sale_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'on_sale', *product_filter)
        )
        product_on_sale = product_on_sale_result.scalar() or 0

        product_ready_to_sell_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'ready_to_sell', *product_filter)
        )
        product_ready_to_sell = product_ready_to_sell_result.scalar() or 0

        product_error_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'error', *product_filter)
        )
        product_error = product_error_result.scalar() or 0

        product_pending_modification_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'pending_modification', *product_filter)
        )
        product_pending_modification = product_pending_modification_result.scalar() or 0

        product_inactive_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'inactive', *product_filter)
        )
        product_inactive = product_inactive_result.scalar() or 0

        product_archived_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.status == 'archived', *product_filter)
        )
        product_archived = product_archived_result.scalar() or 0

        product_synced_result = await db.execute(
            select(func.count(OzonProduct.id))
            .where(OzonProduct.sync_status == 'success', *product_filter)
        )
        product_synced = product_synced_result.scalar() or 0

        # 订单统计
        order_total_result = await db.execute(
            select(func.count(OzonOrder.id))
            .where(*order_filter)
        )
        order_total = order_total_result.scalar() or 0

        order_pending_result = await db.execute(
            select(func.count(OzonOrder.id))
            .where(OzonOrder.status == 'pending', *order_filter)
        )
        order_pending = order_pending_result.scalar() or 0

        order_processing_result = await db.execute(
            select(func.count(OzonOrder.id))
            .where(OzonOrder.status == 'processing', *order_filter)
        )
        order_processing = order_processing_result.scalar() or 0

        order_shipped_result = await db.execute(
            select(func.count(OzonOrder.id))
            .where(OzonOrder.status == 'shipped', *order_filter)
        )
        order_shipped = order_shipped_result.scalar() or 0

        order_delivered_result = await db.execute(
            select(func.count(OzonOrder.id))
            .where(OzonOrder.status == 'delivered', *order_filter)
        )
        order_delivered = order_delivered_result.scalar() or 0

        order_cancelled_result = await db.execute(
            select(func.count(OzonOrder.id))
            .where(OzonOrder.status == 'cancelled', *order_filter)
        )
        order_cancelled = order_cancelled_result.scalar() or 0

        # 收入统计（今日、本周、本月）
        from datetime import datetime, timedelta

        now = utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=now.weekday())
        month_start = today_start.replace(day=1)

        # 今日收入
        today_revenue_result = await db.execute(
            select(func.sum(OzonOrder.total_price))
            .where(
                OzonOrder.created_at >= today_start,
                OzonOrder.status.in_(['delivered', 'shipped']),
                *order_filter
            )
        )
        today_revenue = today_revenue_result.scalar() or Decimal('0')

        # 本周收入
        week_revenue_result = await db.execute(
            select(func.sum(OzonOrder.total_price))
            .where(
                OzonOrder.created_at >= week_start,
                OzonOrder.status.in_(['delivered', 'shipped']),
                *order_filter
            )
        )
        week_revenue = week_revenue_result.scalar() or Decimal('0')

        # 本月收入
        month_revenue_result = await db.execute(
            select(func.sum(OzonOrder.total_price))
            .where(
                OzonOrder.created_at >= month_start,
                OzonOrder.status.in_(['delivered', 'shipped']),
                *order_filter
            )
        )
        month_revenue = month_revenue_result.scalar() or Decimal('0')

        return {
            "products": {
                "total": product_total,
                "on_sale": product_on_sale,
                "ready_to_sell": product_ready_to_sell,
                "error": product_error,
                "pending_modification": product_pending_modification,
                "inactive": product_inactive,
                "archived": product_archived,
                "synced": product_synced
            },
            "orders": {
                "total": order_total,
                "pending": order_pending,
                "processing": order_processing,
                "shipped": order_shipped,
                "delivered": order_delivered,
                "cancelled": order_cancelled
            },
            "revenue": {
                "today": str(today_revenue),
                "week": str(week_revenue),
                "month": str(month_revenue)
            }
        }

    except Exception as e:
        logger.error(f"Failed to get statistics: {e}")
        raise HTTPException(status_code=500, detail=f"获取统计数据失败: {str(e)}")


@router.post("/test-connection")
async def test_connection(
    credentials: Dict[str, str] = Body(..., description="API凭证")
):
    """
    测试Ozon API连接

    Args:
        credentials: 包含client_id和api_key的字典

    Returns:
        连接测试结果
    """
    from ..api.client import OzonAPIClient

    try:
        client_id = credentials.get("client_id")
        api_key = credentials.get("api_key")

        if not client_id or not api_key:
            return {
                "success": False,
                "message": "缺少必要的API凭证"
            }

        # 创建临时客户端测试连接
        client = OzonAPIClient(client_id=client_id, api_key=api_key)

        # 调用测试连接方法
        result = await client.test_connection()

        await client.close()

        return result

    except Exception as e:
        logger.error(f"Connection test failed: {e}")
        return {
            "success": False,
            "message": f"连接测试失败: {str(e)}"
        }


# 订单报表端点
@router.get("/reports/orders")
async def get_order_report(
    month: str = Query(..., description="月份，格式：YYYY-MM"),
    shop_ids: Optional[str] = Query(None, description="店铺ID列表，逗号分隔"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取订单报表数据

    Args:
        month: 月份，格式：YYYY-MM
        shop_ids: 店铺ID列表，逗号分隔（不传则查询所有店铺）

    Returns:
        包含统计汇总和详细订单数据的报表
    """
    from sqlalchemy import and_, extract, or_
    from decimal import Decimal
    import calendar

    try:
        # 解析月份
        year, month_num = month.split("-")
        year = int(year)
        month_num = int(month_num)

        # 计算月份的开始和结束日期（UTC timezone-aware）
        start_date = datetime(year, month_num, 1, tzinfo=timezone.utc)
        last_day = calendar.monthrange(year, month_num)[1]
        end_date = datetime(year, month_num, last_day, 23, 59, 59, tzinfo=timezone.utc)

        # 构建查询条件
        conditions = [
            OzonOrder.created_at >= start_date,
            OzonOrder.created_at <= end_date,
            # 只查询已确认或已完成的订单
            or_(
                OzonOrder.status.in_(['confirmed', 'processing', 'shipped', 'delivered']),
                OzonOrder.status == 'awaiting_deliver',
                OzonOrder.status == 'awaiting_packaging'
            )
        ]

        # 如果指定了店铺ID
        if shop_ids:
            shop_id_list = [int(sid) for sid in shop_ids.split(",")]
            conditions.append(OzonOrder.shop_id.in_(shop_id_list))

        # 查询订单数据（添加eager loading避免懒加载）
        from sqlalchemy.orm import selectinload

        orders_query = select(
            OzonOrder,
            OzonShop.shop_name
        ).join(
            OzonShop, OzonOrder.shop_id == OzonShop.id
        ).where(and_(*conditions)).options(
            selectinload(OzonOrder.items)
        )

        result = await db.execute(orders_query)
        orders_with_shop = result.all()

        # 计算统计数据
        total_sales = Decimal('0')  # 销售总额
        total_purchase = Decimal('0')  # 进货总额
        total_cost = Decimal('0')  # 费用总额
        order_count = 0

        # 构建详细数据列表
        report_data = []

        for order, shop_name in orders_with_shop:
            # 获取商品信息
            items = order.items or []

            for item in items:
                # 计算单个商品的价格
                item_price = Decimal(str(item.get('price', 0)))
                quantity = item.get('quantity', 1)
                sale_price = item_price * quantity

                # 获取进货价格和材料费用
                purchase_price = order.purchase_price or Decimal('0')
                material_cost = order.material_cost or Decimal('0')

                # 计算利润
                profit = sale_price - purchase_price - material_cost

                # 累加统计数据
                total_sales += sale_price
                total_purchase += purchase_price
                total_cost += material_cost
                order_count += 1

                from ..utils.serialization import format_currency

                # 添加到详细数据
                report_data.append({
                    "date": order.created_at.strftime("%Y-%m-%d"),
                    "shop_name": shop_name,
                    "product_name": item.get('name', item.get('sku', '未知商品')),
                    "posting_number": order.posting_number,
                    "purchase_price": format_currency(purchase_price),
                    "sale_price": format_currency(sale_price),
                    "tracking_number": order.tracking_number,
                    "domestic_tracking_number": order.domestic_tracking_number,
                    "material_cost": format_currency(material_cost),
                    "order_notes": order.order_notes,
                    "profit": format_currency(profit),
                    "sku": item.get('sku'),
                    "quantity": quantity,
                    "offer_id": item.get('offer_id')
                })

        # 计算利润总额和利润率
        total_profit = total_sales - total_purchase - total_cost
        profit_rate = (total_profit / total_sales * 100) if total_sales > 0 else Decimal('0')

        # 返回报表数据
        return {
            "summary": {
                "total_sales": str(total_sales),
                "total_purchase": str(total_purchase),
                "total_cost": str(total_cost),
                "total_profit": str(total_profit),
                "profit_rate": float(profit_rate),  # 百分比形式
                "order_count": order_count,
                "month": month
            },
            "data": report_data
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"无效的月份格式: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to get order report: {e}")
        raise HTTPException(status_code=500, detail=f"获取报表失败: {str(e)}")


@router.get("/reports/orders/export")
async def export_order_report(
    month: str = Query(..., description="月份，格式：YYYY-MM"),
    shop_ids: Optional[str] = Query(None, description="店铺ID列表，逗号分隔"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    导出订单报表为Excel文件

    Args:
        month: 月份，格式：YYYY-MM
        shop_ids: 店铺ID列表，逗号分隔

    Returns:
        Excel文件流
    """
    from fastapi.responses import StreamingResponse
    import pandas as pd
    from io import BytesIO

    try:
        # 获取报表数据
        report = await get_order_report(month, shop_ids, db)

        # 创建DataFrame
        df = pd.DataFrame(report["data"])

        if not df.empty:
            # 重命名列为中文
            df = df.rename(columns={
                "date": "日期",
                "shop_name": "店铺名称",
                "product_name": "商品名称",
                "posting_number": "货件编号",
                "purchase_price": "进货价格",
                "sale_price": "出售价格",
                "tracking_number": "国际运单号",
                "domestic_tracking_number": "国内运单号",
                "material_cost": "材料费用",
                "order_notes": "备注",
                "profit": "利润",
                "sku": "SKU",
                "quantity": "数量"
            })

            # 选择要导出的列
            export_columns = [
                "日期", "店铺名称", "商品名称", "货件编号",
                "进货价格", "出售价格", "国际运单号", "国内运单号",
                "材料费用", "备注", "利润"
            ]
            df = df[export_columns]

        # 创建Excel文件
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            # 写入数据表
            df.to_excel(writer, sheet_name='订单报表', index=False)

            # 获取工作表
            worksheet = writer.sheets['订单报表']

            # 添加统计汇总行（在表格底部）
            summary = report["summary"]
            last_row = len(df) + 3  # 空一行后添加统计

            worksheet.cell(row=last_row, column=1, value="统计汇总")
            worksheet.cell(row=last_row + 1, column=1, value="销售总额")
            worksheet.cell(row=last_row + 1, column=2, value=f"¥{summary['total_sales']}")
            worksheet.cell(row=last_row + 2, column=1, value="进货总额")
            worksheet.cell(row=last_row + 2, column=2, value=f"¥{summary['total_purchase']}")
            worksheet.cell(row=last_row + 3, column=1, value="费用总额")
            worksheet.cell(row=last_row + 3, column=2, value=f"¥{summary['total_cost']}")
            worksheet.cell(row=last_row + 4, column=1, value="利润总额")
            worksheet.cell(row=last_row + 4, column=2, value=f"¥{summary['total_profit']}")
            worksheet.cell(row=last_row + 5, column=1, value="利润率")
            worksheet.cell(row=last_row + 5, column=2, value=f"{summary['profit_rate']:.2f}%")
            worksheet.cell(row=last_row + 6, column=1, value="订单总数")
            worksheet.cell(row=last_row + 6, column=2, value=summary['order_count'])

            # 调整列宽
            for column in worksheet.columns:
                max_length = 0
                column_letter = column[0].column_letter
                for cell in column:
                    try:
                        if len(str(cell.value)) > max_length:
                            max_length = len(str(cell.value))
                    except Exception:
                        pass
                adjusted_width = min(max_length + 2, 50)
                worksheet.column_dimensions[column_letter].width = adjusted_width

        # 重置文件指针
        output.seek(0)

        # 返回文件流
        filename = f"ozon_order_report_{month}.xlsx"
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        logger.error(f"Failed to export order report: {e}")
        raise HTTPException(status_code=500, detail=f"导出报表失败: {str(e)}")