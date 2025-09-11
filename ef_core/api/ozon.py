"""
Ozon API 路由 - 简化版本
"""

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import uuid
import asyncio

from ef_core.database import get_async_session
from ef_core.utils.logging import get_logger
from pydantic import BaseModel, Field
from typing import Dict, Any

logger = get_logger(__name__)

# 创建路由器
router = APIRouter(prefix="/ozon", tags=["Ozon"])

# 同步任务存储（内存缓存）
sync_tasks = {}


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


@router.get("/shops")
async def get_shops(db: AsyncSession = Depends(get_async_session), owner_user_id: int = 1):  # 默认用户ID
    """获取店铺列表"""
    try:
        # 导入模型
        from plugins.ef.channels.ozon.models import OzonShop, OzonProduct, OzonOrder

        # 查询店铺
        result = await db.execute(select(OzonShop).where(OzonShop.owner_user_id == owner_user_id))
        shops = result.scalars().all()

        # 获取统计信息
        shop_list = []
        for shop in shops:
            # 统计商品数量
            product_count_result = await db.execute(
                select(func.count(OzonProduct.id)).where(OzonProduct.shop_id == shop.id)
            )
            product_count = product_count_result.scalar() or 0

            # 统计详细的商品状态
            # 现在我们有了正确的status字段
            product_stats_result = await db.execute(
                select(
                    func.count(OzonProduct.id).filter(OzonProduct.status == "active").label("active_count"),
                    func.count(OzonProduct.id).filter(OzonProduct.status == "inactive").label("inactive_count"),
                    func.count(OzonProduct.id).filter(OzonProduct.status == "out_of_stock").label("out_of_stock_count"),
                    func.count(OzonProduct.id).filter(OzonProduct.is_archived.is_(True)).label("archived_count"),
                    func.count(OzonProduct.id).filter(OzonProduct.visibility.is_(True)).label("visible_count"),
                ).where(OzonProduct.shop_id == shop.id)
            )
            product_stats = product_stats_result.first()

            # 统计订单数量
            order_count_result = await db.execute(select(func.count(OzonOrder.id)).where(OzonOrder.shop_id == shop.id))
            order_count = order_count_result.scalar() or 0

            shop_dict = shop.to_dict(include_credentials=True)
            shop_dict["stats"] = {
                "total_products": product_count,
                "active_products": product_stats.active_count if product_stats else 0,
                "inactive_products": product_stats.inactive_count if product_stats else 0,
                "out_of_stock_products": product_stats.out_of_stock_count if product_stats else 0,
                "archived_products": product_stats.archived_count if product_stats else 0,
                "visible_products": product_stats.visible_count if product_stats else 0,
                "total_orders": order_count,
                "last_sync_at": shop.last_sync_at.isoformat() if shop.last_sync_at else None,
                "sync_status": "success",
            }
            shop_list.append(shop_dict)

        return {"ok": True, "data": shop_list}

    except Exception as e:
        logger.error(f"Failed to get shops: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/shops")
async def create_shop(shop_data: ShopCreateDTO, db: AsyncSession = Depends(get_async_session)):
    """创建新的 Ozon 店铺"""
    try:
        from plugins.ef.channels.ozon.models import OzonShop

        # 创建新店铺
        new_shop = OzonShop(
            shop_name=shop_data.shop_name,
            platform="ozon",
            status="active",
            owner_user_id=1,  # 临时硬编码
            client_id=shop_data.api_credentials.get("client_id", ""),
            api_key_enc=shop_data.api_credentials.get("api_key", ""),  # 实际应该加密
            config=shop_data.config or {},
        )

        db.add(new_shop)
        await db.commit()
        await db.refresh(new_shop)

        # 返回店铺数据（使用内置的 to_dict 方法，它会处理凭证）
        shop_dict = new_shop.to_dict(include_credentials=True)
        return {"ok": True, "data": shop_dict}

    except Exception as e:
        logger.error(f"Failed to create shop: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/shops/{shop_id}")
async def update_shop(shop_id: int, shop_data: ShopUpdateDTO, db: AsyncSession = Depends(get_async_session)):
    """更新 Ozon 店铺配置"""
    try:
        from plugins.ef.channels.ozon.models import OzonShop

        # 查找店铺
        result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
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
            # 只有当提供了非掩码的API key时才更新
            api_key = shop_data.api_credentials.get("api_key")
            if api_key and api_key != "******":
                shop.api_key_enc = api_key  # 实际应该加密
        if shop_data.config is not None:
            # 合并配置
            # 确保config是可变的字典
            current_config = dict(shop.config) if shop.config else {}
            current_config.update(shop_data.config)
            shop.config = current_config

        shop.updated_at = datetime.utcnow()

        await db.commit()
        await db.refresh(shop)

        # 返回店铺数据（使用内置的 to_dict 方法，它会处理凭证）
        shop_dict = shop.to_dict(include_credentials=True)
        return {"ok": True, "data": shop_dict}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update shop: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/shops/{shop_id}")
async def delete_shop(shop_id: int, db: AsyncSession = Depends(get_async_session)):
    """删除 Ozon 店铺"""
    try:
        from plugins.ef.channels.ozon.models import OzonShop

        result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
        shop = result.scalar_one_or_none()

        if not shop:
            raise HTTPException(status_code=404, detail="Shop not found")

        await db.delete(shop)
        await db.commit()

        return {"ok": True, "message": "Shop deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete shop: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/shops/{shop_id}/test-connection")
async def test_connection(shop_id: int, db: AsyncSession = Depends(get_async_session)):
    """测试店铺 API 连接"""
    try:
        from plugins.ef.channels.ozon.models import OzonShop
        from plugins.ef.channels.ozon.api.client import OzonAPIClient

        # 获取店铺信息
        result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
        shop = result.scalar_one_or_none()

        if not shop:
            raise HTTPException(status_code=404, detail="Shop not found")

        # 验证API凭证是否存在
        if not shop.client_id or not shop.api_key_enc:
            return {
                "ok": True,
                "success": False,
                "message": "API credentials not configured",
                "details": {"error": "Missing client_id or api_key"},
            }

        # 测试连接
        try:
            async with OzonAPIClient(client_id=shop.client_id, api_key=shop.api_key_enc) as client:
                result = await client.test_connection()

                if result["success"]:
                    # 直接返回result的内容，避免嵌套
                    return {
                        "ok": True,
                        "success": True,
                        "message": result.get("message", "Connection successful"),
                        "details": result.get("details", {}),
                    }
                else:
                    return {
                        "ok": True,
                        "success": False,
                        "message": result.get("message", "Connection failed"),
                        "details": result.get("details", {}),
                    }

        except Exception as api_error:
            logger.error(f"API connection test failed: {api_error}")
            return {
                "ok": True,
                "success": False,
                "message": f"Connection failed: {str(api_error)}",
                "details": {"error": str(api_error)},
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to test connection: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/shops/{shop_id}/sync")
async def sync_shop(
    shop_id: int,
    sync_type: str = Query("all", regex="^(all|products|orders)$"),
    full_sync: bool = Query(False),
    db: AsyncSession = Depends(get_async_session),
):
    """触发店铺同步"""
    try:
        # 创建同步任务
        task_id = str(uuid.uuid4())
        sync_tasks[task_id] = {
            "id": task_id,
            "shop_id": shop_id,
            "sync_type": sync_type,
            "full_sync": full_sync,
            "status": "running",
            "progress": 0,
            "message": "正在启动同步...",
            "created_at": datetime.utcnow().isoformat(),
        }

        # 异步执行同步任务（不传递db会话，让任务自己创建）
        asyncio.create_task(_run_sync_task(task_id, shop_id, sync_type, full_sync))

        return {"ok": True, "task_id": task_id, "message": f"同步任务已启动 (类型: {sync_type}, 全量: {full_sync})"}

    except Exception as e:
        logger.error(f"Failed to start sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _run_sync_task(task_id: str, shop_id: int, sync_type: str, full_sync: bool):
    """执行同步任务 - 调用真正的同步服务"""
    try:
        # 导入真正的同步服务
        from plugins.ef.channels.ozon.services import OzonSyncService

        # 更新任务状态
        sync_tasks[task_id] = {
            "id": task_id,
            "shop_id": shop_id,
            "sync_type": sync_type,
            "full_sync": full_sync,
            "status": "running",
            "progress": 0,
            "message": "正在启动同步...",
            "created_at": datetime.utcnow().isoformat(),
        }

        # 创建新的数据库会话用于异步任务
        async for db in get_async_session():
            try:
                # 执行真正的同步
                if sync_type in ["all", "products"]:
                    logger.info(f"Starting products sync for shop {shop_id}, task {task_id}")
                    await OzonSyncService.sync_products(shop_id, db, task_id)

                if sync_type in ["all", "orders"]:
                    logger.info(f"Starting orders sync for shop {shop_id}, task {task_id}")
                    # 如果是全部同步，为订单生成新的任务ID
                    order_task_id = task_id if sync_type == "orders" else f"task_{uuid.uuid4().hex[:12]}"
                    await OzonSyncService.sync_orders(shop_id, db, order_task_id)

                await db.commit()
            finally:
                await db.close()
            break  # 只需要一个会话

        # 获取最终的任务状态
        final_status = OzonSyncService.get_task_status(task_id)
        if final_status:
            sync_tasks[task_id] = final_status
        else:
            # 如果没有状态，设置为完成
            sync_tasks[task_id].update(
                {
                    "status": "completed",
                    "progress": 100,
                    "message": "同步完成",
                    "completed_at": datetime.utcnow().isoformat(),
                }
            )

    except Exception as e:
        logger.error(f"Sync task failed: {e}")
        import traceback

        logger.error(traceback.format_exc())
        if task_id in sync_tasks:
            sync_tasks[task_id].update(
                {
                    "status": "failed",
                    "message": f"同步失败: {str(e)}",
                    "error": str(e),
                    "failed_at": datetime.utcnow().isoformat(),
                }
            )


@router.get("/sync/status/{task_id}")
async def get_sync_status(task_id: str):
    """获取同步任务状态"""
    # 先尝试从真正的同步服务获取状态
    from plugins.ef.channels.ozon.services import OzonSyncService

    real_status = OzonSyncService.get_task_status(task_id)
    if real_status:
        # 更新本地缓存
        sync_tasks[task_id] = real_status
        return {"ok": True, "data": real_status}

    # 如果真正的服务没有，从本地缓存获取
    if task_id not in sync_tasks:
        raise HTTPException(status_code=404, detail="任务不存在")

    return {"ok": True, "data": sync_tasks[task_id]}


@router.get("/products")
async def get_products(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    shop_id: Optional[int] = None,
    db: AsyncSession = Depends(get_async_session),
):
    """获取商品列表"""
    try:
        from plugins.ef.channels.ozon.models import OzonProduct

        # 构建查询 - 按创建时间倒序排序，显示最新商品
        query = select(OzonProduct)
        if shop_id:
            query = query.where(OzonProduct.shop_id == shop_id)

        # 按创建时间倒序排序，最新的商品在前
        query = query.order_by(OzonProduct.created_at.desc())

        # 分页
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        # 执行查询
        result = await db.execute(query)
        products = result.scalars().all()

        # 获取总数
        count_query = select(func.count(OzonProduct.id))
        if shop_id:
            count_query = count_query.where(OzonProduct.shop_id == shop_id)
        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0

        # 获取统计信息
        stats_query = select(
            func.count(OzonProduct.id).filter(OzonProduct.status == "active").label("active"),
            func.count(OzonProduct.id).filter(OzonProduct.status == "inactive").label("inactive"),
            func.count(OzonProduct.id).filter(OzonProduct.status == "out_of_stock").label("out_of_stock"),
        )
        if shop_id:
            stats_query = stats_query.where(OzonProduct.shop_id == shop_id)

        stats_result = await db.execute(stats_query)
        stats = stats_result.first()

        return {
            "ok": True,
            "data": [p.to_dict() for p in products],
            "total": total,
            "page": page,
            "page_size": page_size,
            "stats": {
                "active": stats.active if stats else 0,
                "inactive": stats.inactive if stats else 0,
                "out_of_stock": stats.out_of_stock if stats else 0,
            },
        }

    except Exception as e:
        logger.error(f"Failed to get products: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/orders")
async def get_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    shop_id: Optional[int] = None,
    db: AsyncSession = Depends(get_async_session),
):
    """获取订单列表"""
    try:
        from plugins.ef.channels.ozon.models import OzonOrder

        # 构建查询
        query = select(OzonOrder)
        if shop_id:
            query = query.where(OzonOrder.shop_id == shop_id)

        # 排序和分页
        query = query.order_by(OzonOrder.created_at.desc())
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        # 执行查询
        result = await db.execute(query)
        orders = result.scalars().all()

        # 获取总数
        count_query = select(func.count(OzonOrder.id))
        if shop_id:
            count_query = count_query.where(OzonOrder.shop_id == shop_id)
        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0

        return {"ok": True, "data": [o.to_dict() for o in orders], "total": total, "page": page, "page_size": page_size}

    except Exception as e:
        logger.error(f"Failed to get orders: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sync-logs")
async def get_sync_logs(
    shop_id: Optional[int] = None, limit: int = Query(10, ge=1, le=100), db: AsyncSession = Depends(get_async_session)
):
    """获取同步日志"""
    try:
        from plugins.ef.channels.ozon.models import OzonSyncLog

        # 构建查询
        query = select(OzonSyncLog)
        if shop_id:
            query = query.where(OzonSyncLog.shop_id == shop_id)
        query = query.order_by(OzonSyncLog.created_at.desc()).limit(limit)

        # 执行查询
        result = await db.execute(query)
        logs = result.scalars().all()

        # 转换为活动格式
        activities = []
        for log in logs:
            # 解析同步类型
            sync_type = log.sync_type or "sync"
            type_map = {"products": "products", "orders": "orders", "inventory": "inventory", "full": "sync"}

            # 解析状态
            status_map = {"success": "success", "failed": "failed", "partial": "partial", "running": "started"}

            activities.append(
                {
                    "type": type_map.get(sync_type, "sync"),
                    "content": log.message or f"{sync_type} 同步",
                    "status": status_map.get(log.status, "success"),
                    "time": log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else "",
                }
            )

        return {"ok": True, "activities": activities}

    except Exception as e:
        logger.error(f"Failed to get sync logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))
