"""
批量财务费用同步任务
前端手动触发，同步已签收但 OZON 佣金为 0 的订单
"""
import asyncio
import logging
from typing import Dict, Any
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal
import redis

from ef_core.tasks.celery_app import celery_app
from ef_core.database import get_db_manager
from sqlalchemy import select, or_

from ..models.orders import OzonPosting
from ..models.ozon_shops import OzonShop
from ..api.client import OzonAPIClient

logger = logging.getLogger(__name__)

# 创建线程池用于运行异步任务
_thread_pool = ThreadPoolExecutor(max_workers=2)

# Redis 客户端用于存储进度信息
_redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)


@celery_app.task(bind=True, name="ef.ozon.batch_finance_sync")
def batch_finance_sync_task(self):
    """
    批量财务费用同步任务（前端手动触发）
    
    查询所有已签收但 OZON 佣金为 0 的订单，调用财务交易 API 同步费用
    """
    task_id = self.request.id if self.request.id else "unknown"
    logger.info(f"Batch finance sync task started, task_id: {task_id}")

    # 初始化进度
    _update_progress(task_id, {
        "status": "running",
        "current": 0,
        "total": 0,
        "message": "正在查询需要同步的订单..."
    })

    def run_async_in_thread():
        """在新线程中运行异步代码，显式管理 event loop"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(_batch_finance_sync_async(task_id))
        finally:
            loop.close()
            asyncio.set_event_loop(None)

    try:
        future = _thread_pool.submit(run_async_in_thread)
        result = future.result(timeout=7200)  # 2小时超时

        # 更新最终进度
        _update_progress(task_id, {
            "status": "completed",
            "current": result.get("updated", 0) + result.get("skipped", 0) + result.get("errors", 0),
            "total": result.get("total_found", 0),
            "message": result.get("message", "同步完成"),
            "result": result
        })

        return result
    except Exception as e:
        logger.error(f"Batch finance sync task execution error: {e}", exc_info=True)
        error_result = {
            "success": False,
            "error": str(e)
        }

        _update_progress(task_id, {
            "status": "failed",
            "message": f"同步失败: {str(e)}",
            "result": error_result
        })

        return error_result
    finally:
        # 释放 Redis 锁
        try:
            lock_key = "batch_finance_sync:lock"
            _redis_client.delete(lock_key)
            logger.info(f"Released lock: {lock_key}")
        except Exception as e:
            logger.error(f"Failed to release lock: {e}")


async def _batch_finance_sync_async(task_id: str) -> Dict[str, Any]:
    """
    批量财务同步的异步实现

    Args:
        task_id: 任务ID

    Returns:
        同步结果统计
    """
    stats = {
        "total_found": 0,
        "processed": 0,
        "updated": 0,
        "skipped": 0,
        "errors": 0,
        "error_details": []
    }

    # 在当前 event loop 中重新创建 db_manager（避免 loop 冲突）
    from ef_core.database import DatabaseManager
    db_manager = DatabaseManager()

    async with db_manager.get_session() as session:
        # 1. 查询所有已签收但佣金为0的订单（不依赖 OzonOrder）
        postings_result = await session.execute(
            select(OzonPosting)
            .where(OzonPosting.status == 'delivered')
            .where(
                or_(
                    OzonPosting.ozon_commission_cny == None,
                    OzonPosting.ozon_commission_cny == 0
                )
            )
            .where(OzonPosting.posting_number != None)
            .where(OzonPosting.posting_number != '')
            .order_by(OzonPosting.delivered_at.desc())
        )
        postings = postings_result.scalars().all()
        stats["total_found"] = len(postings)

        if not postings:
            logger.info("No postings need finance sync (delivered but commission=0)")
            return {
                **stats,
                "success": True,
                "message": "没有需要同步的订单（已签收且佣金为0）"
            }

        logger.info(f"Found {len(postings)} postings to sync")
        
        # 更新进度
        _update_progress(task_id, {
            "status": "running",
            "current": 0,
            "total": len(postings),
            "message": f"找到 {len(postings)} 个订单，开始同步..."
        })

        # 2. 提取 posting 信息到字典（避免懒加载）
        postings_data = []
        for posting in postings:
            postings_data.append({
                'id': posting.id,
                'shop_id': posting.shop_id,
                'posting_number': posting.posting_number
            })

        # 3. 按店铺分组
        from collections import defaultdict
        postings_by_shop = defaultdict(list)
        for posting_data in postings_data:
            postings_by_shop[posting_data['shop_id']].append(posting_data)

        logger.info(f"Grouped into {len(postings_by_shop)} shop(s)")

        # 4. 遍历每个店铺
        for shop_id, shop_postings in postings_by_shop.items():
            # 获取店铺配置
            shop_result = await session.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop_orm = shop_result.scalar_one_or_none()

            if not shop_orm:
                logger.error(f"Shop {shop_id} not found, skipping {len(shop_postings)} postings")
                stats["errors"] += len(shop_postings)
                for posting_data in shop_postings:
                    stats["error_details"].append({
                        "posting_number": posting_data['posting_number'],
                        "error": f"店铺{shop_id}不存在"
                    })
                continue

            shop_name = shop_orm.shop_name
            client_id = shop_orm.client_id
            api_key_enc = shop_orm.api_key_enc

            logger.info(f"Processing {len(shop_postings)} postings for shop: {shop_name}")

            # 5. 批量预加载该店铺的所有 posting（不需要加载 order）
            shop_posting_ids = [p['id'] for p in shop_postings]
            postings_result = await session.execute(
                select(OzonPosting).where(OzonPosting.id.in_(shop_posting_ids))
            )
            postings_map = {p.id: p for p in postings_result.scalars()}

            # 6. 创建 API 客户端
            async with OzonAPIClient(client_id, api_key_enc, shop_id=shop_id) as client:
                # 7. 处理每个货件
                for idx, posting_data in enumerate(shop_postings):
                    posting_id = posting_data['id']
                    posting_number = posting_data['posting_number']
                    logger.info(f"Processing {idx+1}/{len(shop_postings)}: {posting_number}")
                    stats["processed"] += 1

                    # 更新进度
                    _update_progress(task_id, {
                        "status": "running",
                        "current": stats["processed"],
                        "total": stats["total_found"],
                        "message": f"正在同步 {posting_number}..."
                    })

                    # 从预加载的 map 中获取 posting（避免 N+1 查询）
                    posting = postings_map.get(posting_id)

                    if not posting:
                        logger.error(f"Posting {posting_id} not found")
                        stats["skipped"] += 1
                        continue

                    try:
                        # 8. 调用财务交易 API
                        response = await client.get_finance_transaction_list(
                            posting_number=posting_number,
                            transaction_type="all",
                            page=1,
                            page_size=1000
                        )

                        result = response.get("result", {})
                        operations = result.get("operations", [])

                        if not operations:
                            logger.warning(f"No finance transactions for {posting_number}")
                            stats["skipped"] += 1
                            continue

                        # 9. 计算汇率（不依赖 order，使用 posting.order_total_price）
                        exchange_rate = _calculate_exchange_rate(posting, operations)

                        if exchange_rate is None or exchange_rate <= 0:
                            logger.warning(f"Invalid exchange rate for {posting_number}")
                            stats["skipped"] += 1
                            continue

                        logger.info(f"Exchange rate for {posting_number}: {exchange_rate:.6f}")

                        # 10. 提取并转换费用
                        fees = _extract_and_convert_fees(operations, exchange_rate)

                        # 11. 更新 posting 记录
                        posting.last_mile_delivery_fee_cny = fees["last_mile_delivery"]

                        # 国际物流费用保护逻辑
                        if posting.international_logistics_fee_cny and posting.international_logistics_fee_cny != 0:
                            if fees["international_logistics"] == 0:
                                logger.warning(f"Skip updating international_logistics for {posting_number} (protection)")
                            else:
                                posting.international_logistics_fee_cny = fees["international_logistics"]
                        else:
                            posting.international_logistics_fee_cny = fees["international_logistics"]

                        # OZON 佣金（关键字段）
                        posting.ozon_commission_cny = fees["ozon_commission"]
                        posting.finance_synced_at = datetime.now(timezone.utc)

                        # 12. 计算利润（使用 posting.order_total_price）
                        _calculate_profit(posting)

                        await session.commit()
                        stats["updated"] += 1
                        logger.info(f"Updated {posting_number}: commission={fees['ozon_commission']:.2f}")

                        # 每个订单间隔5秒（避免API限流）
                        if idx < len(shop_postings) - 1:
                            await asyncio.sleep(5)

                    except Exception as e:
                        logger.error(f"Error processing {posting_number}: {e}", exc_info=True)
                        stats["errors"] += 1
                        stats["error_details"].append({
                            "posting_number": posting_number,
                            "error": str(e)
                        })
                        await session.rollback()
                        continue

    logger.info(f"Batch finance sync completed: {stats}")
    return {
        **stats,
        "success": True,
        "message": f"同步完成：处理 {stats['processed']} 个订单，更新 {stats['updated']} 个，跳过 {stats['skipped']} 个，错误 {stats['errors']} 个"
    }


def _calculate_exchange_rate(posting: OzonPosting, operations: list) -> float:
    """计算历史汇率（RUB -> CNY）- 不依赖 OzonOrder"""
    from decimal import Decimal, InvalidOperation

    # 方法1: 从 accruals_for_sale 提取汇率（首选）
    for op in operations:
        if op.get("operation_type") == "OperationAgentDeliveredToCustomer":
            services = op.get("services", [])
            for service in services:
                if service.get("name") == "MarketplaceServiceItemFulfillment":
                    price_rub = Decimal(str(service.get("price", 0)))
                    price_cny = Decimal(str(service.get("price_cny", 0)))
                    if price_rub > 0 and price_cny > 0:
                        return float(price_cny / price_rub)

    # 方法2: 默认汇率（order.total_price 实际为0，无法用于推算）
    return 0.073  # 默认汇率


def _extract_and_convert_fees(operations: list, exchange_rate: float) -> Dict[str, Decimal]:
    """提取并转换费用（RUB -> CNY）"""
    from decimal import Decimal

    fees = {
        "ozon_commission": Decimal('0'),
        "last_mile_delivery": Decimal('0'),
        "international_logistics": Decimal('0')
    }

    for op in operations:
        services = op.get("services", [])

        for service in services:
            service_name = service.get("name", "")
            price_rub = Decimal(str(service.get("price", 0)))

            # Ozon 佣金
            if service_name in ["MarketplaceServiceItemFulfillment", "MarketplaceServiceItemPickup"]:
                fees["ozon_commission"] += price_rub * Decimal(str(exchange_rate))

            # 尾程派送
            elif service_name in ["MarketplaceServiceItemDeliveryToCustomer"]:
                fees["last_mile_delivery"] += price_rub * Decimal(str(exchange_rate))

            # 国际物流
            elif service_name in ["MarketplaceServiceItemDirectFlowTrans"]:
                fees["international_logistics"] += price_rub * Decimal(str(exchange_rate))

    # 取绝对值（费用都是正数）
    for key in fees:
        fees[key] = abs(fees[key])

    return fees


def _calculate_profit(posting: OzonPosting) -> None:
    """计算利润 - 使用 posting.order_total_price，不依赖 OzonOrder"""
    from decimal import Decimal

    # 订单金额（取消订单不计销售额）- 使用 posting.order_total_price
    if posting.status == 'cancelled':
        order_amount = Decimal('0')
    else:
        order_amount = Decimal(str(posting.order_total_price or '0'))

    # 成本汇总
    purchase_price = posting.purchase_price or Decimal('0')
    ozon_commission = posting.ozon_commission_cny or Decimal('0')
    intl_logistics = posting.international_logistics_fee_cny or Decimal('0')
    last_mile = posting.last_mile_delivery_fee_cny or Decimal('0')
    material_cost = posting.material_cost or Decimal('0')

    # 利润
    profit = order_amount - (purchase_price + ozon_commission + intl_logistics + last_mile + material_cost)
    posting.profit = profit

    # 利润率
    if posting.status == 'cancelled':
        posting.profit_rate = Decimal('0')
    else:
        posting.profit_rate = (profit / order_amount * 100) if order_amount > 0 else Decimal('0')


def _update_progress(task_id: str, progress: Dict[str, Any]):
    """更新任务进度到 Redis"""
    try:
        key = f"batch_finance_sync:{task_id}"
        _redis_client.setex(key, 3600, str(progress))  # 1小时过期
    except Exception as e:
        logger.error(f"Failed to update progress: {e}")
