"""
店铺管理 API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime
from pydantic import BaseModel, Field
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from ef_core.middleware.auth import require_role
from ..models import OzonShop, OzonProduct, OzonOrder
from ..utils.datetime_utils import utcnow

router = APIRouter(tags=["ozon-shops"])
logger = logging.getLogger(__name__)


# DTO 模型
class ShopCreateDTO(BaseModel):
    """创建店铺DTO - 匹配前端扁平结构"""
    name: str  # 店铺名称（前端使用name）
    client_id: str  # OZON Client ID
    api_key: str  # OZON API Key
    platform: str = "ozon"
    config: Optional[Dict[str, Any]] = None


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


@router.get("/shops")
async def get_shops(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """获取 Ozon 店铺列表（只返回用户关联的店铺）"""
    from ef_core.models.users import user_shops

    # 根据用户角色过滤店铺
    if current_user.role == "admin":
        # admin 返回所有店铺
        stmt = select(OzonShop)
    else:
        # 其他用户只返回关联的店铺
        stmt = select(OzonShop).join(
            user_shops, OzonShop.id == user_shops.c.shop_id
        ).where(user_shops.c.user_id == current_user.id)

    result = await db.execute(stmt.order_by(OzonShop.created_at.desc()))
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """创建新的 Ozon 店铺（需要操作员权限）"""
    new_shop = OzonShop(
        shop_name=shop_data.name,  # 使用前端的name字段
        platform=shop_data.platform,
        status="active",
        owner_user_id=current_user.id,
        client_id=shop_data.client_id,
        api_key_enc=shop_data.api_key,  # 实际应该加密
        config=shop_data.config or {}
    )

    db.add(new_shop)
    await db.flush()  # 先flush获取shop ID

    # 关联所有 admin 用户到新店铺
    admin_users_result = await db.execute(
        select(User).where(User.role == "admin")
    )
    admin_users = admin_users_result.scalars().all()

    for admin in admin_users:
        admin.shops.append(new_shop)

    await db.commit()
    await db.refresh(new_shop)

    return new_shop.to_dict(include_credentials=True)


@router.put("/shops/{shop_id}")
async def update_shop(
    shop_id: int,
    shop_data: ShopUpdateDTO,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """更新 Ozon 店铺配置（需要操作员权限）"""
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """删除 Ozon 店铺（需要操作员权限）"""
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """测试店铺 API 连接（需要操作员权限）"""
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """配置店铺 Webhook（需要操作员权限）"""
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """测试 Webhook 配置（需要操作员权限）"""
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
        "timestamp": datetime.now().replace(tzinfo=None).isoformat() + "Z",
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
        "X-Event-Id": f"test-{datetime.now().timestamp()}",
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """删除店铺 Webhook 配置（需要操作员权限）"""
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """触发店铺同步（需要操作员权限）"""
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
        "started_at": datetime.now().isoformat(),
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
                    "completed_at": datetime.now().isoformat(),
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


@router.post("/shops/{shop_id}/sync-warehouses")
async def sync_warehouses(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    同步店铺仓库信息（需要操作员权限）

    从OZON API获取FBS/rFBS仓库列表并同步到数据库。
    """
    from ..api.client import OzonAPIClient
    from ..models import OzonWarehouse

    # 获取店铺信息
    result = await db.execute(
        select(OzonShop).where(OzonShop.id == shop_id)
    )
    shop = result.scalar_one_or_none()

    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    # 验证API凭证
    if not shop.client_id or not shop.api_key_enc:
        raise HTTPException(
            status_code=400,
            detail="API credentials not configured"
        )

    try:
        # 创建OZON API客户端
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop_id
        )

        # 调用仓库列表API
        response = await client.get_warehouses()
        warehouses_data = response.get("result", [])

        if not warehouses_data:
            return {
                "success": True,
                "message": "未找到仓库",
                "data": {
                    "total": 0,
                    "created": 0,
                    "updated": 0,
                    "warehouses": []
                }
            }

        # 统计
        created_count = 0
        updated_count = 0
        warehouses_list = []

        for wh_data in warehouses_data:
            # 查找已存在的仓库
            stmt = select(OzonWarehouse).where(
                OzonWarehouse.shop_id == shop_id,
                OzonWarehouse.warehouse_id == wh_data.get("warehouse_id")
            )
            existing = await db.execute(stmt)
            warehouse = existing.scalar_one_or_none()

            if warehouse:
                # 更新已存在的仓库
                warehouse.name = wh_data.get("name", "")
                warehouse.is_rfbs = wh_data.get("is_rfbs", False)
                warehouse.status = wh_data.get("status", "")
                warehouse.has_entrusted_acceptance = wh_data.get("has_entrusted_acceptance", False)
                warehouse.postings_limit = wh_data.get("postings_limit", -1)
                warehouse.min_postings_limit = wh_data.get("min_postings_limit")
                warehouse.has_postings_limit = wh_data.get("has_postings_limit", False)
                warehouse.min_working_days = wh_data.get("min_working_days")
                warehouse.working_days = wh_data.get("working_days")
                warehouse.can_print_act_in_advance = wh_data.get("can_print_act_in_advance", False)
                warehouse.is_karantin = wh_data.get("is_karantin", False)
                warehouse.is_kgt = wh_data.get("is_kgt", False)
                warehouse.is_timetable_editable = wh_data.get("is_timetable_editable", False)
                warehouse.first_mile_type = wh_data.get("first_mile_type")
                warehouse.raw_data = wh_data
                warehouse.updated_at = datetime.now()
                updated_count += 1
            else:
                # 创建新仓库
                warehouse = OzonWarehouse(
                    shop_id=shop_id,
                    warehouse_id=wh_data.get("warehouse_id"),
                    name=wh_data.get("name", ""),
                    is_rfbs=wh_data.get("is_rfbs", False),
                    status=wh_data.get("status", ""),
                    has_entrusted_acceptance=wh_data.get("has_entrusted_acceptance", False),
                    postings_limit=wh_data.get("postings_limit", -1),
                    min_postings_limit=wh_data.get("min_postings_limit"),
                    has_postings_limit=wh_data.get("has_postings_limit", False),
                    min_working_days=wh_data.get("min_working_days"),
                    working_days=wh_data.get("working_days"),
                    can_print_act_in_advance=wh_data.get("can_print_act_in_advance", False),
                    is_karantin=wh_data.get("is_karantin", False),
                    is_kgt=wh_data.get("is_kgt", False),
                    is_timetable_editable=wh_data.get("is_timetable_editable", False),
                    first_mile_type=wh_data.get("first_mile_type"),
                    raw_data=wh_data
                )
                db.add(warehouse)
                created_count += 1

            warehouses_list.append(warehouse.to_dict())

        # 提交数据库事务
        await db.commit()

        logger.info(
            f"Warehouse sync completed for shop {shop_id}: "
            f"total={len(warehouses_data)}, created={created_count}, updated={updated_count}"
        )

        return {
            "success": True,
            "message": "仓库同步成功",
            "data": {
                "total": len(warehouses_data),
                "created": created_count,
                "updated": updated_count,
                "warehouses": warehouses_list
            }
        }

    except Exception as e:
        logger.error(f"Warehouse sync failed for shop {shop_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"同步失败: {str(e)}"
        )


@router.post("/shops/sync-all-warehouses")
async def sync_all_warehouses(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    批量同步所有店铺的仓库信息（需要操作员权限）

    遍历所有活跃店铺，调用OZON API获取仓库列表并同步到数据库。
    """
    from ..api.client import OzonAPIClient
    from ..models import OzonWarehouse

    # 获取所有活跃店铺
    result = await db.execute(
        select(OzonShop).where(OzonShop.status == "active")
    )
    shops = result.scalars().all()

    if not shops:
        return {
            "success": True,
            "message": "没有活跃的店铺",
            "data": {
                "total_shops": 0,
                "success_count": 0,
                "failed_count": 0,
                "total_warehouses": 0,
                "results": []
            }
        }

    # 统计
    success_count = 0
    failed_count = 0
    total_warehouses = 0
    results = []

    for shop in shops:
        # 跳过未配置API凭证的店铺
        if not shop.client_id or not shop.api_key_enc:
            results.append({
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "message": "API凭证未配置",
                "warehouses": 0
            })
            failed_count += 1
            continue

        try:
            # 创建OZON API客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            # 调用仓库列表API
            response = await client.get_warehouses()
            warehouses_data = response.get("result", [])

            # 统计当前店铺的仓库数
            created_count = 0
            updated_count = 0

            for wh_data in warehouses_data:
                # 查找已存在的仓库
                stmt = select(OzonWarehouse).where(
                    OzonWarehouse.shop_id == shop.id,
                    OzonWarehouse.warehouse_id == wh_data.get("warehouse_id")
                )
                existing = await db.execute(stmt)
                warehouse = existing.scalar_one_or_none()

                if warehouse:
                    # 更新已存在的仓库
                    warehouse.name = wh_data.get("name", "")
                    warehouse.is_rfbs = wh_data.get("is_rfbs", False)
                    warehouse.status = wh_data.get("status", "")
                    warehouse.has_entrusted_acceptance = wh_data.get("has_entrusted_acceptance", False)
                    warehouse.postings_limit = wh_data.get("postings_limit", -1)
                    warehouse.min_postings_limit = wh_data.get("min_postings_limit")
                    warehouse.has_postings_limit = wh_data.get("has_postings_limit", False)
                    warehouse.min_working_days = wh_data.get("min_working_days")
                    warehouse.working_days = wh_data.get("working_days")
                    warehouse.can_print_act_in_advance = wh_data.get("can_print_act_in_advance", False)
                    warehouse.is_karantin = wh_data.get("is_karantin", False)
                    warehouse.is_kgt = wh_data.get("is_kgt", False)
                    warehouse.is_timetable_editable = wh_data.get("is_timetable_editable", False)
                    warehouse.first_mile_type = wh_data.get("first_mile_type")
                    warehouse.raw_data = wh_data
                    warehouse.updated_at = datetime.now()
                    updated_count += 1
                else:
                    # 创建新仓库
                    warehouse = OzonWarehouse(
                        shop_id=shop.id,
                        warehouse_id=wh_data.get("warehouse_id"),
                        name=wh_data.get("name", ""),
                        is_rfbs=wh_data.get("is_rfbs", False),
                        status=wh_data.get("status", ""),
                        has_entrusted_acceptance=wh_data.get("has_entrusted_acceptance", False),
                        postings_limit=wh_data.get("postings_limit", -1),
                        min_postings_limit=wh_data.get("min_postings_limit"),
                        has_postings_limit=wh_data.get("has_postings_limit", False),
                        min_working_days=wh_data.get("min_working_days"),
                        working_days=wh_data.get("working_days"),
                        can_print_act_in_advance=wh_data.get("can_print_act_in_advance", False),
                        is_karantin=wh_data.get("is_karantin", False),
                        is_kgt=wh_data.get("is_kgt", False),
                        is_timetable_editable=wh_data.get("is_timetable_editable", False),
                        first_mile_type=wh_data.get("first_mile_type"),
                        raw_data=wh_data
                    )
                    db.add(warehouse)
                    created_count += 1

            # 提交当前店铺的变更
            await db.commit()

            total_warehouses += len(warehouses_data)
            success_count += 1

            results.append({
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": True,
                "message": f"同步成功：共{len(warehouses_data)}个仓库，新建{created_count}个，更新{updated_count}个",
                "warehouses": len(warehouses_data),
                "created": created_count,
                "updated": updated_count
            })

            logger.info(
                f"Warehouse sync completed for shop {shop.id}: "
                f"total={len(warehouses_data)}, created={created_count}, updated={updated_count}"
            )

        except Exception as e:
            failed_count += 1
            results.append({
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "message": f"同步失败: {str(e)}",
                "warehouses": 0
            })
            logger.error(f"Warehouse sync failed for shop {shop.id}: {e}")
            # 继续处理下一个店铺，不抛出异常

    return {
        "success": True,
        "message": f"批量同步完成：成功{success_count}个店铺，失败{failed_count}个店铺",
        "data": {
            "total_shops": len(shops),
            "success_count": success_count,
            "failed_count": failed_count,
            "total_warehouses": total_warehouses,
            "results": results
        }
    }
