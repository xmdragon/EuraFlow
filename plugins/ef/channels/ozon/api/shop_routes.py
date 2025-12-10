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
from ef_core.api.auth import get_current_user_flexible, get_current_user_from_api_key
from ef_core.middleware.auth import require_role
from ..models import OzonShop, OzonProduct, OzonPosting
from ..utils.datetime_utils import utcnow

router = APIRouter(tags=["ozon-shops"])
logger = logging.getLogger(__name__)


# DTO 模型
class ShopCreateDTO(BaseModel):
    """创建店铺DTO - 匹配前端扁平结构"""
    shop_name: str  # 店铺名称（俄文）
    shop_name_cn: Optional[str] = None  # 店铺中文名称
    client_id: str  # OZON Client ID
    api_key: str  # OZON API Key
    platform: str = "ozon"
    config: Optional[Dict[str, Any]] = None


class ShopUpdateDTO(BaseModel):
    shop_name: Optional[str] = None
    shop_name_cn: Optional[str] = None
    status: Optional[str] = None
    api_credentials: Optional[Dict[str, str]] = None
    config: Optional[Dict[str, Any]] = None


class ShopResponseDTO(BaseModel):
    id: int
    shop_name: str
    shop_name_cn: Optional[str] = None
    display_name: Optional[str] = None
    platform: str
    status: str
    api_credentials: Optional[Dict[str, str]]
    config: Dict[str, Any]
    stats: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime


@router.get("/shops/management")
async def get_shops_for_management(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取店铺列表（用于店铺管理页面）

    权限控制：
    - admin: 可以看到所有店铺，都可以编辑
    - manager/sub_account: 可以看到自己创建的店铺（可编辑）和有权限的店铺（只读）
    """
    from ef_core.models.users import user_shops

    # 获取用户关联的店铺ID
    user_shop_stmt = select(user_shops.c.shop_id).where(user_shops.c.user_id == current_user.id)
    user_shop_result = await db.execute(user_shop_stmt)
    user_shop_ids = set(row[0] for row in user_shop_result.fetchall())

    if current_user.role == "admin":
        # admin 返回所有店铺
        stmt = select(OzonShop)
    else:
        # 其他用户：获取自己创建的店铺 + 有权限的店铺
        stmt = select(OzonShop).where(
            (OzonShop.owner_user_id == current_user.id) | (OzonShop.id.in_(user_shop_ids))
        )

    result = await db.execute(stmt.order_by(OzonShop.created_at.desc()))
    shops = result.scalars().all()

    if not shops:
        return {"data": []}

    # 获取店铺统计数据
    shop_ids = [shop.id for shop in shops]

    # 获取所有店铺的商品数量
    products_stmt = (
        select(OzonProduct.shop_id, func.count(OzonProduct.id).label('count'))
        .where(OzonProduct.shop_id.in_(shop_ids))
        .group_by(OzonProduct.shop_id)
    )
    products_result = await db.execute(products_stmt)
    products_count_map = {row.shop_id: row.count for row in products_result}

    # 获取所有店铺的订单数量
    postings_stmt = (
        select(OzonPosting.shop_id, func.count(OzonPosting.id).label('count'))
        .where(OzonPosting.shop_id.in_(shop_ids))
        .group_by(OzonPosting.shop_id)
    )
    postings_result = await db.execute(postings_stmt)
    orders_count_map = {row.shop_id: row.count for row in postings_result}

    # 获取所有创建者信息
    owner_ids = list(set(shop.owner_user_id for shop in shops if shop.owner_user_id))
    owner_map = {}
    if owner_ids:
        owner_stmt = select(User.id, User.username).where(User.id.in_(owner_ids))
        owner_result = await db.execute(owner_stmt)
        owner_map = {row.id: row.username for row in owner_result}

    # 组装响应数据
    shops_data = []
    for shop in shops:
        # 判断是否可编辑：admin可编辑所有，其他用户只能编辑自己创建的
        can_edit = current_user.role == "admin" or shop.owner_user_id == current_user.id

        shop_dict = shop.to_dict(include_credentials=can_edit)  # 只有可编辑的店铺才返回凭证

        shop_dict["owner_user_id"] = shop.owner_user_id
        shop_dict["owner_username"] = owner_map.get(shop.owner_user_id, "-")
        shop_dict["can_edit"] = can_edit

        shop_dict["stats"] = {
            "total_products": products_count_map.get(shop.id, 0),
            "total_orders": orders_count_map.get(shop.id, 0),
            "last_sync_at": shop.last_sync_at.isoformat() if shop.last_sync_at else None,
            "sync_status": "success" if shop.last_sync_at else "pending"
        }

        shops_data.append(shop_dict)

    return {"data": shops_data}


@router.get("/shops")
async def get_shops(
    include_stats: bool = Query(False, description="是否包含统计数据（商品数、订单数）"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取 Ozon 店铺列表（只返回用户关联的店铺）

    参数：
    - include_stats: 是否包含统计数据（默认 false，用于下拉选择等场景）
      - false: 只返回基本信息（id, shop_name, shop_name_cn, status, platform）
      - true: 返回完整信息（包含统计数据、API凭证等）
    """
    from ef_core.models.users import user_shops

    # 根据用户角色过滤店铺
    if current_user.role == "admin":
        # admin 返回所有店铺
        stmt = select(OzonShop)
    else:
        # 其他用户通过 user_shops 关联表获取授权的店铺
        stmt = select(OzonShop).join(
            user_shops, OzonShop.id == user_shops.c.shop_id
        ).where(user_shops.c.user_id == current_user.id)

    result = await db.execute(stmt.order_by(OzonShop.created_at.desc()))
    shops = result.scalars().all()

    # 如果没有店铺，直接返回空列表
    if not shops:
        return {"data": []}

    # 简化模式：只返回基本信息（用于下拉选择等场景）
    if not include_stats:
        shops_data = []
        for shop in shops:
            shops_data.append({
                "id": shop.id,
                "shop_name": shop.shop_name,
                "shop_name_cn": shop.shop_name_cn,
                "display_name": shop.shop_name_cn or shop.shop_name,
                "platform": shop.platform,
                "status": shop.status
            })
        return {"data": shops_data}

    # 完整模式：包含统计数据（用于店铺管理页面）
    # 优化：使用 GROUP BY 一次性获取所有店铺的统计数据（避免 N+1 查询）
    shop_ids = [shop.id for shop in shops]

    # 获取所有店铺的商品数量
    products_stmt = (
        select(OzonProduct.shop_id, func.count(OzonProduct.id).label('count'))
        .where(OzonProduct.shop_id.in_(shop_ids))
        .group_by(OzonProduct.shop_id)
    )
    products_result = await db.execute(products_stmt)
    products_count_map = {row.shop_id: row.count for row in products_result}

    # 获取所有店铺的订单数量（使用 OzonPosting 统计，不查 OzonOrder）
    postings_stmt = (
        select(OzonPosting.shop_id, func.count(OzonPosting.id).label('count'))
        .where(OzonPosting.shop_id.in_(shop_ids))
        .group_by(OzonPosting.shop_id)
    )
    postings_result = await db.execute(postings_stmt)
    orders_count_map = {row.shop_id: row.count for row in postings_result}

    # 组装响应数据
    shops_data = []
    for shop in shops:
        shop_dict = shop.to_dict(include_credentials=True)

        # 从预加载的统计数据中获取数量（默认为 0）
        shop_dict["stats"] = {
            "total_products": products_count_map.get(shop.id, 0),
            "total_orders": orders_count_map.get(shop.id, 0),
            "last_sync_at": shop.last_sync_at.isoformat() if shop.last_sync_at else None,
            "sync_status": "success" if shop.last_sync_at else "pending"
        }

        shops_data.append(shop_dict)

    return {"data": shops_data}


@router.post("/shops")
async def create_shop(
    shop_data: ShopCreateDTO,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """创建新的 Ozon 店铺（需要操作员权限）"""
    from ef_core.models.users import user_shops
    from sqlalchemy import insert
    from sqlalchemy.orm import selectinload

    # 检查店铺数量限额（仅对 manager 角色）
    if current_user.role == "manager":
        # 加载 manager_level 关系
        stmt = select(User).options(selectinload(User.manager_level)).where(User.id == current_user.id)
        result = await db.execute(stmt)
        manager = result.scalar_one_or_none()

        if manager and manager.manager_level:
            # 查询当前用户拥有的店铺数量
            shop_count_stmt = select(func.count()).select_from(OzonShop).where(OzonShop.owner_user_id == current_user.id)
            shop_count_result = await db.execute(shop_count_stmt)
            current_shop_count = shop_count_result.scalar()

            max_shops = manager.manager_level.max_shops
            if current_shop_count >= max_shops:
                if max_shops == 0:
                    error_msg = "您的账号级别不允许创建店铺"
                else:
                    error_msg = f"不能创建更多店铺，已达上限（{max_shops}个）"
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "QUOTA_EXCEEDED",
                        "message": error_msg
                    }
                )

    new_shop = OzonShop(
        shop_name=shop_data.shop_name,
        shop_name_cn=shop_data.shop_name_cn,
        platform=shop_data.platform,
        status="active",
        owner_user_id=current_user.id,
        client_id=shop_data.client_id,
        api_key_enc=shop_data.api_key,  # 实际应该加密
        config=shop_data.config or {}
    )

    db.add(new_shop)
    await db.flush()  # 先flush获取shop ID

    # 关联所有 admin 用户到新店铺（使用关联表直接插入，避免greenlet错误）
    admin_users_result = await db.execute(
        select(User.id).where(User.role == "admin")
    )
    admin_user_ids = admin_users_result.scalars().all()

    # 使用关联表直接插入，避免访问关系属性
    for admin_id in admin_user_ids:
        await db.execute(
            insert(user_shops).values(user_id=admin_id, shop_id=new_shop.id)
        )

    await db.commit()
    await db.refresh(new_shop)

    return new_shop.to_dict(include_credentials=True)


@router.put("/shops/{shop_id}")
async def update_shop(
    shop_id: int,
    shop_data: ShopUpdateDTO,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
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
    if shop_data.shop_name_cn is not None:
        shop.shop_name_cn = shop_data.shop_name_cn
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
    current_user: User = Depends(require_role("sub_account"))
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
    current_user: User = Depends(require_role("sub_account"))
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
    current_user: User = Depends(require_role("sub_account"))
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
    current_user: User = Depends(require_role("sub_account"))
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
    current_user: User = Depends(require_role("sub_account"))
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
    current_user: User = Depends(require_role("sub_account"))
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


@router.get("/shops/{shop_id}/warehouses")
async def get_warehouses(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取店铺仓库列表（从数据库读取）
    """
    from ..models import OzonWarehouse

    # 查询店铺的仓库
    stmt = select(OzonWarehouse).where(
        OzonWarehouse.shop_id == shop_id
    ).order_by(OzonWarehouse.warehouse_id)

    result = await db.execute(stmt)
    warehouses = result.scalars().all()

    return {
        "success": True,
        "data": [wh.to_dict() for wh in warehouses]
    }


@router.post("/shops/{shop_id}/sync-warehouses")
async def sync_warehouses(
    shop_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
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
    current_user: User = Depends(require_role("sub_account"))
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


# ============================================================
# 浏览器扩展 Cookie 上传和同步状态 API
# ============================================================

class CookieItem(BaseModel):
    """Cookie 项"""
    name: str
    value: str
    domain: Optional[str] = None


class SessionUploadRequest(BaseModel):
    """Session 上传请求"""
    cookies: list[CookieItem] = Field(..., description="Cookie 列表")
    user_agent: Optional[str] = Field(None, description="User-Agent")


class SyncStatusResponse(BaseModel):
    """同步状态响应"""
    promo_cleaner: Dict[str, Any]
    invoice_sync: Dict[str, Any]
    balance_sync: Dict[str, Any]


@router.post("/session/upload")
async def upload_session(
    request: SessionUploadRequest,
    db: AsyncSession = Depends(get_async_session),
    api_key_user: Optional[User] = Depends(get_current_user_from_api_key)
):
    """
    上传浏览器 Session Cookie（API Key 认证）

    浏览器扩展定期调用此接口上传最新的 OZON Cookie，
    后端使用这些 Cookie 访问 OZON 页面执行同步任务。

    **认证方式**：在 Header 中传递 `X-API-Key`
    """
    import json

    # 验证 API Key
    if not api_key_user:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "UNAUTHORIZED",
                "message": "需要有效的 API Key（请在 Header 中传递 X-API-Key）"
            }
        )

    # 验证 Cookie 列表
    if not request.cookies:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "EMPTY_COOKIES",
                "message": "Cookie 列表不能为空"
            }
        )

    # 将 Cookie 转换为 JSON 字符串
    cookies_data = {
        "cookies": [c.model_dump() for c in request.cookies],
        "user_agent": request.user_agent,
        "uploaded_at": utcnow().isoformat()
    }
    cookies_json = json.dumps(cookies_data, ensure_ascii=False)

    # 直接更新用户的 Cookie（用户登录 OZON 后可以切换多个店铺）
    from ef_core.models.users import User

    stmt = select(User).where(User.id == api_key_user.id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "USER_NOT_FOUND",
                "message": "用户不存在"
            }
        )

    # 更新用户的 OZON Session
    user.ozon_session_enc = cookies_json  # TODO: 加密存储
    user.ozon_session_updated_at = utcnow()

    await db.commit()

    logger.info(
        f"Session uploaded for user {api_key_user.id} ({api_key_user.username})"
    )

    return {
        "ok": True,
        "data": {
            "message": f"Cookie 已保存到用户 {api_key_user.username}",
            "shops_updated": 1  # 保持接口兼容
        }
    }


@router.get("/sync-status")
async def get_sync_status(
    db: AsyncSession = Depends(get_async_session),
    api_key_user: Optional[User] = Depends(get_current_user_from_api_key)
):
    """
    查询后端同步任务执行状态（API Key 认证）

    浏览器扩展在执行任务前调用此接口，检查后端是否已成功执行。
    如果后端已成功，扩展可以跳过执行。

    **认证方式**：在 Header 中传递 `X-API-Key`

    返回三个任务的执行状态：
    - promo_cleaner: 促销清理（检查今天是否已执行）
    - invoice_sync: 账单同步（检查当前窗口期是否已执行）
    - balance_sync: 余额同步（检查当前小时是否已执行）
    """
    from ..models import OzonWebSyncLog
    from datetime import timedelta

    # 验证 API Key
    if not api_key_user:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "UNAUTHORIZED",
                "message": "需要有效的 API Key（请在 Header 中传递 X-API-Key）"
            }
        )

    now = utcnow()

    # 查询各任务的最近成功记录
    async def get_last_success(task_type: str) -> Optional[OzonWebSyncLog]:
        stmt = select(OzonWebSyncLog).where(
            OzonWebSyncLog.user_id == api_key_user.id,
            OzonWebSyncLog.task_type == task_type,
            OzonWebSyncLog.status == "success"
        ).order_by(OzonWebSyncLog.completed_at.desc()).limit(1)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    # 1. 促销清理状态（检查今天是否已执行）
    promo_log = await get_last_success("promo_cleaner")
    promo_today_executed = False
    if promo_log and promo_log.completed_at:
        # 检查是否在今天执行（UTC+8 北京时间）
        beijing_now = now + timedelta(hours=8)
        beijing_completed = promo_log.completed_at + timedelta(hours=8)
        promo_today_executed = beijing_now.date() == beijing_completed.date()

    # 2. 账单同步状态（检查当前窗口期是否已执行）
    invoice_log = await get_last_success("invoice_sync")
    invoice_window_executed = False
    if invoice_log and invoice_log.completed_at:
        # 账单同步窗口期：每月 18-20 号和 3-5 号
        beijing_now = now + timedelta(hours=8)
        day = beijing_now.day
        # 简化检查：7天内执行过即认为当前窗口已执行
        days_since_last = (now - invoice_log.completed_at).days
        invoice_window_executed = days_since_last < 7

    # 3. 余额同步状态（检查当前小时是否已执行）
    balance_log = await get_last_success("balance_sync")
    balance_hour_executed = False
    if balance_log and balance_log.completed_at:
        # 检查是否在当前小时执行
        hours_since_last = (now - balance_log.completed_at).total_seconds() / 3600
        balance_hour_executed = hours_since_last < 1

    return {
        "promo_cleaner": {
            "last_success_at": promo_log.completed_at.isoformat() if promo_log and promo_log.completed_at else None,
            "today_executed": promo_today_executed
        },
        "invoice_sync": {
            "last_success_at": invoice_log.completed_at.isoformat() if invoice_log and invoice_log.completed_at else None,
            "current_window_executed": invoice_window_executed
        },
        "balance_sync": {
            "last_success_at": balance_log.completed_at.isoformat() if balance_log and balance_log.completed_at else None,
            "current_hour_executed": balance_hour_executed
        }
    }
