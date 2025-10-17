"""
订单管理 API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from decimal import Decimal
import logging

from ef_core.database import get_async_session
from ..models import OzonOrder, OzonPosting, OzonProduct
from ..utils.datetime_utils import utcnow, parse_date

router = APIRouter(tags=["ozon-orders"])
logger = logging.getLogger(__name__)


@router.get("/orders")
async def get_orders(
    offset: int = 0,
    limit: int = Query(50, le=1000),
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
    """获取 Ozon 订单列表，支持多种搜索条件（limit最大1000用于客户端分页）"""
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
    更新货件额外信息（进货价格、国内运单号、材料费用、备注）
    注意：这些字段是 posting 维度的数据，存储在 ozon_postings 表
    """
    from decimal import Decimal

    # 通过 posting_number 查找 posting
    posting_result = await db.execute(
        select(OzonPosting).where(OzonPosting.posting_number == posting_number)
    )
    posting = posting_result.scalar_one_or_none()

    if not posting:
        raise HTTPException(status_code=404, detail="Posting not found")

    # 更新字段（智能检测值变化，只在真正变化时更新时间戳）
    try:
        # purchase_price - 带时间戳，需要比较旧值
        if "purchase_price" in extra_info:
            new_value = extra_info["purchase_price"]
            old_value = posting.purchase_price

            # 标准化新值：空字符串或None → None，有效字符串 → Decimal
            if new_value and str(new_value).strip():
                new_value_normalized = Decimal(str(new_value).strip())
            else:
                new_value_normalized = None

            # 只有当值真正变化时才更新字段和时间戳
            if new_value_normalized != old_value:
                posting.purchase_price = new_value_normalized
                posting.purchase_price_updated_at = utcnow()

        # domestic_tracking_number - 带时间戳，需要比较旧值
        if "domestic_tracking_number" in extra_info:
            new_value = extra_info["domestic_tracking_number"]
            old_value = posting.domestic_tracking_number

            # 标准化新值：空字符串或None → None，有效字符串 → trim后的字符串
            if new_value and str(new_value).strip():
                new_value_normalized = str(new_value).strip()
            else:
                new_value_normalized = None

            # 只有当值真正变化时才更新字段和时间戳
            if new_value_normalized != old_value:
                posting.domestic_tracking_number = new_value_normalized
                posting.domestic_tracking_updated_at = utcnow()

        # material_cost - 无时间戳，直接更新
        if "material_cost" in extra_info:
            value = extra_info["material_cost"]
            if value and str(value).strip():
                posting.material_cost = Decimal(str(value).strip())
            else:
                posting.material_cost = None

        # order_notes - 无时间戳，直接更新
        if "order_notes" in extra_info:
            value = extra_info["order_notes"]
            posting.order_notes = str(value).strip() if value and str(value).strip() else None

        # source_platform - 无时间戳，直接更新
        if "source_platform" in extra_info:
            value = extra_info["source_platform"]
            posting.source_platform = str(value).strip() if value and str(value).strip() else None

        # 更新全局时间戳
        posting.updated_at = utcnow()

        await db.commit()
        await db.refresh(posting)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"更新货件信息失败: {str(e)}")

    from ..utils.serialization import format_currency

    return {
        "success": True,
        "message": "Posting extra info updated successfully",
        "data": {
            "posting_number": posting.posting_number,
            "purchase_price": format_currency(posting.purchase_price),
            "domestic_tracking_number": posting.domestic_tracking_number,
            "material_cost": format_currency(posting.material_cost),
            "order_notes": posting.order_notes,
            "source_platform": posting.source_platform,
            "purchase_price_updated_at": posting.purchase_price_updated_at.isoformat() if posting.purchase_price_updated_at else None,
            "domestic_tracking_updated_at": posting.domestic_tracking_updated_at.isoformat() if posting.domestic_tracking_updated_at else None
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
    # current_user: User = Depends(get_current_user)  # Временно отключено для разработки
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


@router.post("/orders/{posting_number}/sync")
async def sync_single_order(
    posting_number: str,
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    同步单个订单
    通过posting_number从OZON API拉取最新的订单数据并更新到数据库
    """
    from ..api.client import OzonAPIClient
    from ..models import OzonShop
    from ..services.order_sync import OrderSyncService

    try:
        # 1. 获取店铺信息
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            raise HTTPException(status_code=404, detail=f"店铺 {shop_id} 不存在")

        # 2. 创建API客户端
        api_client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop_id
        )

        # 3. 从OZON获取posting详情
        logger.info(f"同步单个订单: posting_number={posting_number}, shop_id={shop_id}")
        detail_response = await api_client.get_posting_details(
            posting_number=posting_number,
            with_analytics_data=True,
            with_financial_data=True
        )

        if not detail_response.get("result"):
            raise HTTPException(
                status_code=404,
                detail=f"在OZON中未找到货件 {posting_number}"
            )

        posting_data = detail_response["result"]

        # 4. 使用订单同步服务处理数据
        sync_service = OrderSyncService(shop_id=shop_id, api_client=api_client)
        await sync_service._process_single_posting(db, posting_data)
        await db.commit()

        # 5. 关闭API客户端
        await api_client.close()

        logger.info(f"订单同步成功: posting_number={posting_number}")

        return {
            "success": True,
            "message": "订单同步成功",
            "data": {
                "posting_number": posting_number,
                "status": posting_data.get("status"),
                "synced_at": utcnow().isoformat()
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"同步订单失败: posting_number={posting_number}, error={e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"同步失败: {str(e)}"
        )
