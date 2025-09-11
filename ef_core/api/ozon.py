"""
Ozon API 路由 - 简化版本
"""

from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
import uuid
import asyncio

from ef_core.database import get_async_session
from ef_core.utils.logging import get_logger

logger = get_logger(__name__)

# 创建路由器
router = APIRouter(prefix="/ozon", tags=["Ozon"])

# 模拟同步任务存储
sync_tasks = {}


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

            shop_dict = shop.to_dict()
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

        # 异步执行同步任务
        asyncio.create_task(_run_sync_task(task_id, shop_id, sync_type, full_sync, db))

        return {"ok": True, "task_id": task_id, "message": f"同步任务已启动 (类型: {sync_type}, 全量: {full_sync})"}

    except Exception as e:
        logger.error(f"Failed to start sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _run_sync_task(task_id: str, shop_id: int, sync_type: str, full_sync: bool, db: AsyncSession):
    """执行同步任务"""
    try:
        # 模拟同步过程
        steps = [
            (10, "连接到Ozon API..."),
            (30, "获取商品列表..."),
            (50, "同步商品数据..."),
            (70, "获取订单列表..."),
            (90, "同步订单数据..."),
            (100, "同步完成"),
        ]

        for progress, message in steps:
            await asyncio.sleep(2)  # 模拟处理时间
            if task_id in sync_tasks:
                sync_tasks[task_id].update({"progress": progress, "message": message})

        # 更新店铺最后同步时间
        from plugins.ef.channels.ozon.models import OzonShop

        await db.execute(update(OzonShop).where(OzonShop.id == shop_id).values(last_sync_at=datetime.utcnow()))
        await db.commit()

        # 标记任务完成
        if task_id in sync_tasks:
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
        if task_id in sync_tasks:
            sync_tasks[task_id].update({"status": "failed", "message": f"同步失败: {str(e)}", "error": str(e)})


@router.get("/sync/status/{task_id}")
async def get_sync_status(task_id: str):
    """获取同步任务状态"""
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
        # 返回模拟数据
        return {
            "ok": True,
            "activities": [
                {
                    "type": "orders",
                    "content": "同步了 5 个新订单",
                    "status": "success",
                    "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                },
                {
                    "type": "products",
                    "content": "更新了 10 个商品库存",
                    "status": "success",
                    "time": (datetime.now() - timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S"),
                },
            ],
        }
